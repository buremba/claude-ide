import * as fs from "fs";
import * as path from "path";

/**
 * Parse a .env file and return key-value pairs
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Parse KEY=value format
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * Load env file relative to a base directory
 * Includes path traversal protection to prevent accessing files outside the config directory
 */
export function loadEnvFile(envFilePath: string, baseDir: string): Record<string, string> {
  const resolvedPath = path.resolve(baseDir, envFilePath);
  const realBaseDir = fs.realpathSync(baseDir);

  // Check for path traversal: resolved path must be within baseDir
  // Use realpath to resolve any symlinks
  let realResolvedPath: string;
  try {
    realResolvedPath = fs.realpathSync(resolvedPath);
  } catch {
    // File doesn't exist yet, check the resolved path directly
    realResolvedPath = resolvedPath;
  }

  // Normalize paths for comparison
  const normalizedBase = path.normalize(realBaseDir) + path.sep;
  const normalizedResolved = path.normalize(realResolvedPath);

  if (!normalizedResolved.startsWith(normalizedBase) && normalizedResolved !== normalizedBase.slice(0, -1)) {
    throw new Error(
      `Security error: envFile path "${envFilePath}" resolves outside the config directory. ` +
      `Path traversal is not allowed.`
    );
  }

  return parseEnvFile(resolvedPath);
}

/**
 * Context for resolving environment variables
 */
export interface EnvContext {
  /** Map of process names to their allocated ports */
  processPorts: Map<string, number>;
  /** Map of process names to exported variables */
  processExports: Map<string, Record<string, string>>;
  /** Current process's allocated port (if any) */
  currentPort?: number;
  /** System environment variables */
  systemEnv: NodeJS.ProcessEnv;
}

/**
 * Resolve environment variable references in a string
 *
 * Supports:
 * - $VAR - reference to system env or PORT
 * - $processes.name.var - reference to another process's exported variable
 * - ${VAR} - explicit variable syntax
 */
export function resolveEnvString(value: string, context: EnvContext): string {
  let result = value;

  // Handle $processes.name.var references
  result = result.replace(/\$processes\.(\w+)\.(\w+)/g, (_, processName, varName) => {
    const processVars = context.processExports.get(processName);
    const exportValue = processVars?.[varName];
    if (exportValue !== undefined) {
      return exportValue;
    }

    if (varName === "port") {
      const port = context.processPorts.get(processName);
      if (port !== undefined) {
        return String(port);
      }
    }

    throw new Error(
      `Cannot resolve ${varName} for process "${processName}" - value not available`
    );
  });

  // Handle $PORT special variable
  result = result.replace(/\$\{?PORT\}?/g, () => {
    if (context.currentPort === undefined) {
      throw new Error("Cannot resolve $PORT - no port allocated for this process");
    }
    return String(context.currentPort);
  });

  // Handle ${VAR} syntax for other variables
  result = result.replace(/\$\{(\w+)\}/g, (_, varName) => {
    return context.systemEnv[varName] ?? "";
  });

  // Handle $VAR syntax for remaining variables
  result = result.replace(/\$(\w+)/g, (match, varName) => {
    // Skip if it looks like a reference we already handled
    if (varName === "processes") return match;
    return context.systemEnv[varName] ?? "";
  });

  return result;
}

/**
 * Resolve all environment variables in an env record
 */
export function resolveEnv(
  env: Record<string, string> | undefined,
  context: EnvContext
): Record<string, string> {
  if (!env) return {};

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveEnvString(value, context);
  }
  return resolved;
}

/**
 * Resolve environment variables in a command string
 */
export function resolveCommand(command: string, context: EnvContext): string {
  return resolveEnvString(command, context);
}

/**
 * Try resolving environment variables; returns null if unresolved
 */
export function tryResolveEnvString(value: string, context: EnvContext): string | null {
  try {
    return resolveEnvString(value, context);
  } catch {
    return null;
  }
}
