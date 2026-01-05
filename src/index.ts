#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as path from "path";
import { loadConfig, configExists, BrowserConfig } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { BrowserManager, TabInfo } from "./browser-manager.js";
import { ConfigWatcher } from "./config-watcher.js";
import { EnvFileWatcher } from "./env-file-watcher.js";
import {
  IpcEndpoint,
  callIpc,
  canConnect,
  cleanupIpcEndpoint,
  getIpcEndpoint,
  isAddrInUse,
  startIpcServer,
} from "./ipc.js";
import { logger } from "./logger.js";

// Parse CLI arguments
function parseArgs(): { configPath?: string } {
  const args = process.argv.slice(2);
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      configPath = args[++i];
    } else if (arg.startsWith("--config=")) {
      configPath = arg.split("=")[1];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
mcp-sidecar - MCP server for managing background processes

Usage:
  mcp-sidecar [options]

Options:
  -c, --config <path>  Path to sidecar.yaml config file
  -h, --help           Show this help message

The server will auto-detect sidecar.yaml in the current directory.
If no config is found, it starts with no processes (tools still available).
`);
      process.exit(0);
    }
  }

  return { configPath };
}

// Tool schemas
const ListProcessesSchema = z.object({});

const GetLogsSchema = z.object({
  name: z.string().describe("Process name"),
  tail: z.number().optional().describe("Number of lines to return (default: 100)"),
  stream: z.enum(["stdout", "stderr", "combined"]).optional().describe("Log stream (default: combined)"),
});

const GetUrlSchema = z.object({
  name: z.string().describe("Process name"),
});

const RestartProcessSchema = z.object({
  name: z.string().describe("Process name to restart"),
});

const StopProcessSchema = z.object({
  name: z.string().describe("Process name to stop"),
});

const StartProcessSchema = z.object({
  name: z.string().describe("Process name to start"),
  args: z.string().optional().describe("Extra arguments to append to the command"),
  env: z.record(z.string()).optional().describe("Environment variables to override for this start"),
  force: z.boolean().optional().describe("Kill any process using the configured port before starting"),
});

const GetStatusSchema = z.object({
  name: z.string().describe("Process name"),
});

// Browser tool schemas
const BrowserListSchema = z.object({
  processName: z.string().optional().describe("Filter by process name"),
});

const BrowserOpenSchema = z.object({
  processName: z.string().describe("Process name for browser context"),
  url: z.string().describe("URL to open"),
});

const BrowserCloseSchema = z.object({
  processName: z.string().describe("Process name"),
  tabId: z.string().describe("Tab ID to close"),
});

const BrowserFocusSchema = z.object({
  processName: z.string().describe("Process name"),
  tabId: z.string().describe("Tab ID to focus"),
});

const BrowserReloadSchema = z.object({
  processName: z.string().describe("Process name"),
  tabId: z.string().describe("Tab ID to reload"),
});

const BrowserScreenshotSchema = z.object({
  processName: z.string().describe("Process name"),
  tabId: z.string().describe("Tab ID to screenshot"),
});

const BrowserEvalSchema = z.object({
  processName: z.string().describe("Process name"),
  tabId: z.string().describe("Tab ID"),
  script: z.string().describe("JavaScript code to execute"),
});

const BrowserSaveAuthSchema = z.object({
  processName: z.string().describe("Process name to save auth state for"),
});

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "list_processes",
    description: "List all configured background processes with their status, PID, port, and URL",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_logs",
    description: "Get log output from a background process",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Process name",
        },
        tail: {
          type: "number",
          description: "Number of lines to return (default: 100)",
        },
        stream: {
          type: "string",
          enum: ["stdout", "stderr", "combined"],
          description: "Log stream to read (default: combined)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_url",
    description: "Get the preview URL for a background process",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Process name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "restart_process",
    description: "Restart a background process",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Process name to restart",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "stop_process",
    description: "Stop a background process (it will not auto-restart until manually started again)",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Process name to stop",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "start_process",
    description: "Start a background process (optionally with extra args/env). Use force=true to kill any process using the configured port.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Process name to start",
        },
        args: {
          type: "string",
          description: "Extra arguments to append to the command",
        },
        env: {
          type: "object",
          description: "Environment variables to override for this start",
          additionalProperties: { type: "string" },
        },
        force: {
          type: "boolean",
          description: "Kill any process using the configured port before starting",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_status",
    description: "Get detailed status of a single background process",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Process name",
        },
      },
      required: ["name"],
    },
  },
];

// Browser tools (added dynamically when browser is enabled)
const BROWSER_TOOLS: Tool[] = [
  {
    name: "browser_list",
    description: "List all open browser tabs (optionally filter by process)",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Filter by process name",
        },
      },
      required: [],
    },
  },
  {
    name: "browser_open",
    description: "Open a URL in the browser context for a process",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name for browser context",
        },
        url: {
          type: "string",
          description: "URL to open",
        },
      },
      required: ["processName", "url"],
    },
  },
  {
    name: "browser_close",
    description: "Close a browser tab",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name",
        },
        tabId: {
          type: "string",
          description: "Tab ID to close",
        },
      },
      required: ["processName", "tabId"],
    },
  },
  {
    name: "browser_focus",
    description: "Bring a browser tab to front",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name",
        },
        tabId: {
          type: "string",
          description: "Tab ID to focus",
        },
      },
      required: ["processName", "tabId"],
    },
  },
  {
    name: "browser_reload",
    description: "Reload a browser tab",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name",
        },
        tabId: {
          type: "string",
          description: "Tab ID to reload",
        },
      },
      required: ["processName", "tabId"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of a browser tab",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name",
        },
        tabId: {
          type: "string",
          description: "Tab ID to screenshot",
        },
      },
      required: ["processName", "tabId"],
    },
  },
  {
    name: "browser_eval",
    description: "Execute JavaScript in a browser tab",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name",
        },
        tabId: {
          type: "string",
          description: "Tab ID",
        },
        script: {
          type: "string",
          description: "JavaScript code to execute",
        },
      },
      required: ["processName", "tabId", "script"],
    },
  },
  {
    name: "browser_save_auth",
    description: "Save browser auth state (cookies, localStorage) to disk for a process",
    inputSchema: {
      type: "object",
      properties: {
        processName: {
          type: "string",
          description: "Process name to save auth state for",
        },
      },
      required: ["processName"],
    },
  },
];

function formatToolError(message: string): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`,
      },
    ],
    isError: true,
  };
}

async function main() {
  const { configPath } = parseArgs();

  // Check if config exists
  let config;
  let configDir: string;
  let resolvedConfigPath: string | undefined;
  let hasConfig = false;
  let reuseEnabled = false;
  let reuseKey: string | undefined;

  if (configPath) {
    // Explicit config path provided
    try {
      const result = await loadConfig(configPath);
      config = result.config;
      configDir = result.configDir;
      resolvedConfigPath = path.resolve(configPath);
      hasConfig = true;
      reuseEnabled = Boolean(config.reuse);
      reuseKey = typeof config.reuse === "string" ? config.reuse : undefined;
      console.error(`[sidecar] Loaded config from ${configPath}`);
    } catch (err) {
      console.error(`[sidecar] Failed to load config from ${configPath}:`, err);
      process.exit(1);
    }
  } else if (configExists()) {
    // Auto-detect config in cwd
    try {
      const result = await loadConfig();
      config = result.config;
      configDir = result.configDir;
      // Find the actual config file path
      const fs = await import("fs");
      for (const filename of ["sidecar.yaml", "sidecar.yml"]) {
        const candidate = path.join(process.cwd(), filename);
        if (fs.existsSync(candidate)) {
          resolvedConfigPath = candidate;
          break;
        }
      }
      hasConfig = true;
      reuseEnabled = Boolean(config.reuse);
      reuseKey = typeof config.reuse === "string" ? config.reuse : undefined;
      console.error(`[sidecar] Found config in ${configDir}`);
    } catch (err) {
      console.error("[sidecar] Failed to load config:", err);
      process.exit(1);
    }
  } else {
    // No config found - start without processes
    configDir = process.cwd();
    console.error("[sidecar] No sidecar.yaml found - starting without processes");
    console.error("[sidecar] Create sidecar.yaml to define processes");
  }

  // Parse status writer options from environment
  const statusEnabled = process.env.MCP_SIDECAR_STATUS_ENABLED === "true" ||
                        process.env.MCP_SIDECAR_STATUS_ENABLED === "1";
  const statusOptions = {
    enabled: statusEnabled,
    filePath: process.env.MCP_SIDECAR_STATUS_FILE,
  };

  // Create browser manager if enabled
  let browserManager: BrowserManager | undefined;
  const browserEnabled = hasConfig && config?.browser?.enabled && reuseEnabled;
  if (browserEnabled && config?.browser) {
    browserManager = new BrowserManager({
      config: config.browser as BrowserConfig,
      configDir,
    });
  }

  // Create process manager with settings from config
  const processManager = new ProcessManager(configDir, {
    events: {
      onProcessReady: async (name) => {
        logger.info(`Process "${name}" is ready`);

        // Auto-open browser tab if enabled
        if (browserManager && browserManager.shouldAutoOpen(name)) {
          const url = processManager.getUrl(name);
          if (url) {
            try {
              const tabId = await browserManager.openTab(name, url);
              logger.info(`Opened browser tab for "${name}" (${tabId})`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error(`Failed to open browser tab for "${name}": ${msg}`);
            }
          }
        }
      },
      onProcessCrash: (name, exitCode) => {
        logger.warn(`Process "${name}" crashed (exit code: ${exitCode})`);
      },
      onHealthChange: (name, healthy) => {
        logger.debug(`Process "${name}" health: ${healthy}`);
      },
    },
    statusOptions,
    reuseEnabled,
    settings: config?.settings,
  });

  const handleToolCall = async (name: string, args: unknown): Promise<ToolResponse> => {
    try {
      switch (name) {
        case "list_processes": {
          const processes = processManager.listProcesses();
          const formatted = processes.map((p) => {
            const parts = [`${p.name}: ${p.status}`];
            if (p.pid) parts.push(`pid=${p.pid}`);
            if (p.port) parts.push(`port=${p.port}`);
            if (p.url) parts.push(`url=${p.url}`);
            if (p.healthy !== undefined) parts.push(`healthy=${p.healthy}`);
            if (p.restartCount > 0) parts.push(`restarts=${p.restartCount}`);
            if (p.error) parts.push(`error="${p.error}"`);
            return parts.join(" | ");
          });
          return {
            content: [
              {
                type: "text",
                text: formatted.length > 0 ? formatted.join("\n") : "No processes configured",
              },
            ],
          };
        }

        case "get_logs": {
          const parsed = GetLogsSchema.parse(args);
          const logs = processManager.getLogs(
            parsed.name,
            parsed.stream ?? "combined",
            parsed.tail ?? 100
          );
          return {
            content: [
              {
                type: "text",
                text: logs.length > 0 ? logs.join("\n") : "(no logs)",
              },
            ],
          };
        }

        case "get_url": {
          const parsed = GetUrlSchema.parse(args);
          const url = processManager.getUrl(parsed.name);
          return {
            content: [
              {
                type: "text",
                text: url ?? "(no URL - process has no port configured)",
              },
            ],
          };
        }

        case "restart_process": {
          const parsed = RestartProcessSchema.parse(args);
          await processManager.restartProcess(parsed.name);
          const status = processManager.getStatus(parsed.name);
          return {
            content: [
              {
                type: "text",
                text: `Process "${parsed.name}" restarted. Status: ${status.status}`,
              },
            ],
          };
        }

        case "stop_process": {
          const parsed = StopProcessSchema.parse(args);
          await processManager.stopProcess(parsed.name);
          return {
            content: [
              {
                type: "text",
                text: `Process "${parsed.name}" stopped. Use start_process to start it again.`,
              },
            ],
          };
        }

        case "start_process": {
          const parsed = StartProcessSchema.parse(args);
          await processManager.startProcess(parsed.name, {
            args: parsed.args,
            env: parsed.env,
            force: parsed.force,
          });
          const status = processManager.getStatus(parsed.name);
          return {
            content: [
              {
                type: "text",
                text: `Process "${parsed.name}" started. Status: ${status.status}`,
              },
            ],
          };
        }

        case "get_status": {
          const parsed = GetStatusSchema.parse(args);
          const status = processManager.getStatus(parsed.name);
          const lines = [
            `Name: ${status.name}`,
            `Status: ${status.status}`,
            `PID: ${status.pid ?? "N/A"}`,
            `Port: ${status.port ?? "N/A"}`,
            `URL: ${status.url ?? "N/A"}`,
            `Healthy: ${status.healthy ?? "N/A"}`,
            `Restart Count: ${status.restartCount}`,
          ];
          if (status.lastRestartTime) {
            lines.push(`Last Restart: ${status.lastRestartTime.toISOString()}`);
          }
          if (status.exitCode !== undefined) {
            lines.push(`Exit Code: ${status.exitCode}`);
          }
          if (status.error) {
            lines.push(`Error: ${status.error}`);
          }
          return {
            content: [
              {
                type: "text",
                text: lines.join("\n"),
              },
            ],
          };
        }

        // Browser tools
        case "browser_list": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserListSchema.parse(args);
          const tabs = await browserManager.listTabs(parsed.processName);
          if (tabs.length === 0) {
            return {
              content: [{ type: "text", text: "No browser tabs open" }],
            };
          }
          const formatted = tabs.map(
            (t) => `${t.tabId} | ${t.processName} | ${t.url} | ${t.title}`
          );
          return {
            content: [{ type: "text", text: formatted.join("\n") }],
          };
        }

        case "browser_open": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserOpenSchema.parse(args);
          const tabId = await browserManager.openTab(parsed.processName, parsed.url);
          return {
            content: [
              {
                type: "text",
                text: `Opened tab ${tabId} for process "${parsed.processName}" at ${parsed.url}`,
              },
            ],
          };
        }

        case "browser_close": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserCloseSchema.parse(args);
          await browserManager.closeTab(parsed.processName, parsed.tabId);
          return {
            content: [
              { type: "text", text: `Closed tab ${parsed.tabId}` },
            ],
          };
        }

        case "browser_focus": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserFocusSchema.parse(args);
          await browserManager.focusTab(parsed.processName, parsed.tabId);
          return {
            content: [
              { type: "text", text: `Focused tab ${parsed.tabId}` },
            ],
          };
        }

        case "browser_reload": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserReloadSchema.parse(args);
          await browserManager.reloadTab(parsed.processName, parsed.tabId);
          return {
            content: [
              { type: "text", text: `Reloaded tab ${parsed.tabId}` },
            ],
          };
        }

        case "browser_screenshot": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserScreenshotSchema.parse(args);
          const buffer = await browserManager.screenshot(parsed.processName, parsed.tabId);
          const base64 = buffer.toString("base64");
          return {
            content: [
              {
                type: "text",
                text: `Screenshot captured (${buffer.length} bytes, base64 encoded):\ndata:image/png;base64,${base64}`,
              },
            ],
          };
        }

        case "browser_eval": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserEvalSchema.parse(args);
          const result = await browserManager.evaluate(
            parsed.processName,
            parsed.tabId,
            parsed.script
          );
          return {
            content: [
              {
                type: "text",
                text: `Result: ${JSON.stringify(result, null, 2)}`,
              },
            ],
          };
        }

        case "browser_save_auth": {
          if (!browserManager) {
            return formatToolError("Browser automation is not enabled");
          }
          const parsed = BrowserSaveAuthSchema.parse(args);
          await browserManager.saveStorageState(parsed.processName);
          return {
            content: [
              {
                type: "text",
                text: `Saved auth state for process "${parsed.processName}"`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return formatToolError(message);
    }
  };

  let ipcEndpoint: IpcEndpoint | null = null;
  let ipcServer: Awaited<ReturnType<typeof startIpcServer>> | null = null;
  let reuseMode: "disabled" | "daemon" | "proxy" = "disabled";

  if (reuseEnabled && hasConfig) {
    ipcEndpoint = getIpcEndpoint(configDir, reuseKey);
    const reachable = await canConnect(ipcEndpoint);
    if (reachable) {
      reuseMode = "proxy";
      console.error(`[sidecar] Reusing running sidecar for ${configDir}`);
    } else {
      try {
        ipcServer = await startIpcServer(ipcEndpoint, async (method, params) => {
          return handleToolCall(method, params);
        });
        reuseMode = "daemon";
        console.error(`[sidecar] Started reuse daemon for ${configDir}`);
      } catch (err) {
        if (isAddrInUse(err)) {
          if (await canConnect(ipcEndpoint)) {
            reuseMode = "proxy";
            console.error(`[sidecar] Reusing running sidecar for ${configDir}`);
          } else {
            cleanupIpcEndpoint(ipcEndpoint);
            ipcServer = await startIpcServer(ipcEndpoint, async (method, params) => {
              return handleToolCall(method, params);
            });
            reuseMode = "daemon";
            console.error(`[sidecar] Started reuse daemon for ${configDir}`);
          }
        } else {
          throw err;
        }
      }
    }
  }

  // Start all processes if config exists
  if (hasConfig && config && reuseMode !== "proxy") {
    try {
      await processManager.startAll(config);
      const count = Object.keys(config.processes).length;
      console.error(`[sidecar] Started ${count} process(es)`);
    } catch (err) {
      console.error("[sidecar] Failed to start processes:", err);
      if (ipcEndpoint && reuseMode === "daemon") {
        cleanupIpcEndpoint(ipcEndpoint);
      }
      process.exit(1);
    }
  }

  // Watch env files referenced by processes
  let envFileWatcher: EnvFileWatcher | undefined;
  if (hasConfig && config && reuseMode !== "proxy") {
    envFileWatcher = new EnvFileWatcher({
      onEnvFileChange: async (processNames, envFilePath) => {
        const uniqueNames = Array.from(new Set(processNames));
        console.error(
          `[sidecar] Env file changed (${envFilePath}), restarting: ${uniqueNames.join(", ")}`
        );
        await Promise.all(
          uniqueNames.map(async (name) => {
            try {
              const restarted = await processManager.restartIfRunning(name);
              if (restarted) {
                console.error(`[sidecar] Restarted "${name}" after env change`);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`[sidecar] Failed to restart "${name}": ${message}`);
            }
          })
        );
      },
      onError: (error) => {
        console.error(`[sidecar] Env file watcher error: ${error.message}`);
      },
    });
    envFileWatcher.updateConfig(config, configDir);
  }

  // Set up config file watcher for hot reload
  let configWatcher: ConfigWatcher | undefined;
  if (resolvedConfigPath && reuseMode !== "proxy") {
    configWatcher = new ConfigWatcher(resolvedConfigPath, {
      onConfigChange: async (newConfig) => {
        try {
          const result = await processManager.reload(newConfig);
          const changes = [
            result.added.length > 0 ? `added: ${result.added.join(", ")}` : null,
            result.removed.length > 0 ? `removed: ${result.removed.join(", ")}` : null,
            result.changed.length > 0 ? `changed: ${result.changed.join(", ")}` : null,
          ].filter(Boolean);
          if (changes.length > 0) {
            console.error(`[sidecar] Config reloaded (${changes.join("; ")})`);
          } else {
            console.error("[sidecar] Config reloaded (no changes)");
          }
          envFileWatcher?.updateConfig(newConfig, configDir);
        } catch (err) {
          console.error("[sidecar] Failed to reload config:", err);
        }
      },
      onError: (error) => {
        console.error(`[sidecar] Config watcher error: ${error.message}`);
      },
    });
    configWatcher.start();
  }

  // Create MCP server
  const server = new Server(
    {
      name: "mcp-sidecar",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = browserEnabled ? [...TOOLS, ...BROWSER_TOOLS] : TOOLS;
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (reuseMode === "proxy") {
      if (!ipcEndpoint) {
        return formatToolError("IPC endpoint not available");
      }
      try {
        const response = await callIpc(ipcEndpoint, name, args);
        if (response.ok) {
          return response.result as ToolResponse;
        }
        return formatToolError(response.error ?? "IPC error");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return formatToolError(message);
      }
    }

    return handleToolCall(name, args);
  });

  // Handle shutdown
  async function shutdown() {
    console.error("[sidecar] Shutting down...");

    // Stop watchers first to prevent any new changes being processed
    if (configWatcher) {
      await configWatcher.stop();
    }
    if (envFileWatcher) {
      await envFileWatcher.stop();
    }

    // Stop browser before processes (may need process URLs)
    if (browserManager) {
      await browserManager.shutdown();
    }

    // Stop all processes and wait for completion
    await processManager.stopAll();

    // Cleanup status file after processes are stopped
    processManager.cleanupStatus();

    // Close IPC server after processes are stopped
    if (ipcServer) {
      await new Promise<void>((resolve) => {
        ipcServer!.close(() => resolve());
      });
      ipcServer = null;
    }

    // Cleanup IPC socket file
    if (ipcEndpoint && reuseMode === "daemon") {
      cleanupIpcEndpoint(ipcEndpoint);
    }

    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[sidecar] MCP server running");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
