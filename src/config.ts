import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

// Restart policy enum (Kubernetes-style)
export const RestartPolicySchema = z.enum(["always", "onFailure", "never"]).default("onFailure");
export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

// Schema for a single process configuration
export const ProcessConfigSchema = z.object({
  command: z.string().describe("Shell command to run"),
  cwd: z.string().optional().describe("Working directory, relative to config file"),
  port: z.number().optional().describe("Fixed port (injected as $PORT env var)"),
  force: z.boolean().default(false).describe("Kill any process using the configured port before starting"),
  autoStart: z.boolean().default(true).describe("Start process automatically on boot"),
  stdoutPatternVars: z
    .record(z.string())
    .optional()
    .describe("Map of variable names to regex patterns to extract from stdout/stderr"),
  readyVars: z
    .array(z.string())
    .optional()
    .describe("Variables that must be present before the process is considered ready"),
  env: z.record(z.string()).optional().describe("Environment variables"),
  envFile: z.string().optional().describe("Path to .env file to load (relative to config file)"),
  restartPolicy: RestartPolicySchema.describe("Restart policy: always (restart on any exit), onFailure (restart on non-zero exit), never (don't restart)"),
  maxRestarts: z.number().default(5).describe("Max restart attempts before giving up (resets after stable period)"),
  healthCheck: z.string().optional().describe("HTTP path for health check"),
  dependsOn: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Wait for one or more processes to be ready before starting"),
});

export type ProcessConfig = z.infer<typeof ProcessConfigSchema>;

// Schema for browser configuration
export const BrowserConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable browser automation"),
  headless: z.boolean().default(false).describe("Run browser in headless mode"),
  storageStateDir: z
    .string()
    .optional()
    .describe("Directory to persist browser auth state (relative to config file)"),
  persistByDefault: z
    .boolean()
    .default(false)
    .describe("Persist storageState by default for all contexts"),
  autoOpen: z
    .union([z.boolean(), z.array(z.string())])
    .default(true)
    .describe("Auto-open tabs when processes become ready: true (all), false (none), or array of process names"),
  userDataDir: z
    .string()
    .optional()
    .describe("Browser user data directory (relative to config file). Default: OS temp dir"),
  copyProfileFrom: z
    .union([z.string(), z.null()])
    .default("auto")
    .describe(
      "Copy Chrome profile from path (relative to config file). 'auto' = detect default Chrome profile, null = fresh browser, string = custom path"
    ),
  bookmarks: z
    .array(
      z.object({
        name: z.string().describe("Bookmark name"),
        url: z.string().describe("Bookmark URL"),
      })
    )
    .optional()
    .describe("Bookmarks to add to the browser"),
  extensions: z
    .array(z.string())
    .optional()
    .describe("Chrome extension IDs to install from Chrome Web Store"),
});

export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;

// Schema for configurable settings
export const SettingsSchema = z.object({
  logBufferSize: z
    .number()
    .min(100)
    .max(100000)
    .default(1000)
    .describe("Number of log lines to keep per process (default: 1000)"),
  healthCheckInterval: z
    .number()
    .min(1000)
    .max(300000)
    .default(10000)
    .describe("Health check interval in milliseconds (default: 10000)"),
  dependencyTimeout: z
    .number()
    .min(1000)
    .max(600000)
    .default(60000)
    .describe("Timeout for waiting on dependencies in milliseconds (default: 60000)"),
  restartBackoffMax: z
    .number()
    .min(1000)
    .max(300000)
    .default(30000)
    .describe("Maximum restart backoff time in milliseconds (default: 30000)"),
  processStopTimeout: z
    .number()
    .min(1000)
    .max(60000)
    .default(5000)
    .describe("Timeout for graceful process stop in milliseconds (default: 5000)"),
});

export type Settings = z.infer<typeof SettingsSchema>;

// Schema for the full config file
export const ConfigSchema = z.object({
  reuse: z
    .union([z.boolean(), z.string().min(1)])
    .default(false)
    .describe("Reuse a single process manager per config directory (true) or with a custom key"),
  settings: SettingsSchema.optional().describe("Global settings for the sidecar"),
  browser: BrowserConfigSchema.optional().describe("Browser automation configuration"),
  processes: z.record(ProcessConfigSchema),
});

export type Config = z.infer<typeof ConfigSchema>;

// Resolved process config with computed values
export interface ResolvedProcessConfig extends Omit<ProcessConfig, 'dependsOn'> {
  name: string;
  resolvedCwd: string;
  allocatedPort?: number;
  // Normalized to always be an array (or undefined)
  dependsOn?: string[];
}

const CONFIG_FILENAMES = ["sidecar.yaml", "sidecar.yml"];

/**
 * Check if a config file exists in the current working directory
 */
export function configExists(): boolean {
  const cwd = process.cwd();
  for (const filename of CONFIG_FILENAMES) {
    if (fs.existsSync(path.join(cwd, filename))) {
      return true;
    }
  }
  return false;
}

/**
 * Find and load config file from the current working directory or specified path
 */
export async function loadConfig(configPath?: string): Promise<{ config: Config; configDir: string }> {
  let resolvedPath: string | undefined;
  let configDir: string;

  if (configPath) {
    resolvedPath = path.resolve(configPath);
    configDir = path.dirname(resolvedPath);
  } else {
    // Search for config file in cwd
    const cwd = process.cwd();
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(cwd, filename);
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
        configDir = cwd;
        break;
      }
    }
    if (!resolvedPath) {
      throw new Error(
        `Config file not found. Create one of: ${CONFIG_FILENAMES.join(", ")} in ${cwd}`
      );
    }
    configDir = path.dirname(resolvedPath);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(content);
  const config = ConfigSchema.parse(parsed);

  return { config, configDir };
}

/**
 * Normalize dependsOn to always be an array (or undefined)
 */
function normalizeDependsOn(dependsOn: string | string[] | undefined): string[] | undefined {
  if (!dependsOn) return undefined;
  if (Array.isArray(dependsOn)) return dependsOn.length > 0 ? dependsOn : undefined;
  return [dependsOn];
}

/**
 * Resolve process configs with absolute paths and validate dependencies
 */
export function resolveProcessConfigs(
  config: Config,
  configDir: string
): ResolvedProcessConfig[] {
  const resolved: ResolvedProcessConfig[] = [];

  for (const [name, processConfig] of Object.entries(config.processes)) {
    const resolvedCwd = processConfig.cwd
      ? path.resolve(configDir, processConfig.cwd)
      : configDir;

    resolved.push({
      ...processConfig,
      name,
      resolvedCwd,
      // Normalize dependsOn to array format
      dependsOn: normalizeDependsOn(processConfig.dependsOn),
    });
  }

  // Validate dependencies exist
  const processNames = new Set(resolved.map((p) => p.name));
  for (const process of resolved) {
    const deps = process.dependsOn;
    if (deps) {
      for (const dep of deps) {
        if (!processNames.has(dep)) {
          throw new Error(
            `Process "${process.name}" depends on "${dep}" which does not exist`
          );
        }
      }
    }
  }

  return resolved;
}

/**
 * Topological sort processes by dependencies
 * Supports multiple dependencies per process
 */
export function sortByDependencies(processes: ResolvedProcessConfig[]): ResolvedProcessConfig[] {
  const sorted: ResolvedProcessConfig[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const processMap = new Map(processes.map((p) => [p.name, p]));

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected involving "${name}"`);
    }

    visiting.add(name);
    const process = processMap.get(name);
    if (!process) return;

    // Visit all dependencies
    if (process.dependsOn) {
      for (const dep of process.dependsOn) {
        visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(process);
  }

  for (const process of processes) {
    visit(process.name);
  }

  return sorted;
}
