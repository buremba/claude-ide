#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ZodError } from "zod";
import { loadConfig, configExists, expandEnvVars, type Config } from "./config.js";
import { ProcessManager } from "./process-manager.js";
import { TmuxManager, listIdeSessions, cleanupStaleSession } from "./tmux-manager.js";
import { InteractionManager, type InteractionResult } from "./interaction-manager.js";
import { emitReloadEvent, emitStatusEvent, getLatestStatus } from "./events.js";
import { generateFullHelp } from "@termosdev/shared";

function formatError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map(i => i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message).join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

async function loadConfigAndTmux(): Promise<{
  config: Awaited<ReturnType<typeof loadConfig>>;
  tmux: TmuxManager;
}> {
  const loaded = await loadConfig();
  const defaultName = path.basename(loaded.configDir);
  const sessionName = loaded.config.settings?.sessionName
    ? expandEnvVars(loaded.config.settings.sessionName)
    : defaultName;
  const tmux = TmuxManager.createOwned(sessionName, {
    sessionPrefix: loaded.config.settings?.tmuxSessionPrefix,
  }, loaded.configDir);
  return { config: loaded, tmux };
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function showRunHelp(): void {
  console.log(generateFullHelp());
}

function showHelp(): void {
  console.log(`
termos - Interactive Development Environment for Claude Code

Usage:
  termos up                     Start services and attach (foreground)
  termos up -d                  Start services in background (detached)
  termos up --stream            Start and stream events (for agents, use run_in_background)
  termos connect                Attach to existing session
  termos connect --stream       Stream events from existing session
  termos down                   Stop session
  termos sessions               List active sessions

  termos ls                     List tabs and services
  termos start <service>        Start a service
  termos stop <service>         Stop a service
  termos restart <service>      Restart a service
  termos reload                 Reload config (hot-reload)

  termos pane <name> <cmd>      Create a terminal pane
  termos rm <name>              Remove a pane

  termos status "msg"           Set LLM status (shown in welcome page + tmux title)
  termos status "msg" --prompt "suggestion"  Set status with suggested prompts
  termos status --clear         Clear status
  termos status                 Show current status

  termos run <component>        Run an Ink component (built-in or custom .tsx)
  termos run -- <command>       Run a shell command in Canvas

Built-in components: ask, confirm, checklist, code, diff, table, progress, mermaid, markdown

  Run 'termos run --help' for detailed component documentation and schemas.

Options:
  -d, --detach    Run in background (don't attach)
  --stream        Stream events continuously (requires run_in_background)
  --json          Output as JSON (auto-enabled when no TTY)
  -h, --help      Show this help
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    showHelp();
    process.exit(0);
  }

  // Sessions command - no config needed
  if (cmd === "sessions") {
    const sessions = await listIdeSessions();
    if (sessions.length === 0) {
      console.log("No active sessions. Run 'termos up' to start.");
    } else {
      console.log("SESSIONS\n");
      for (const s of sessions) {
        const status = s.isStale ? "[STALE]" : "[ACTIVE]";
        console.log(`  ${s.name.padEnd(25)} ${s.windows} win  ${formatAge(s.created).padEnd(4)}  ${status}`);
      }
      console.log("\nUse: termos connect <name> | termos gc");
    }
    process.exit(0);
  }

  // GC command - no config needed
  if (cmd === "gc") {
    const sessions = await listIdeSessions();
    const stale = sessions.filter(s => s.isStale);
    if (stale.length === 0) {
      console.log("No stale sessions.");
    } else {
      for (const s of stale) {
        await cleanupStaleSession(s.name);
        console.log(`Cleaned: ${s.name}`);
      }
    }
    process.exit(0);
  }

  // Up command
  if (cmd === "up") {
    const detach = args.includes("-d") || args.includes("--detach");
    // Auto-enable JSON mode when no TTY (agent/script context)
    const json = args.includes("--json") || !process.stdout.isTTY;
    // Only stream if explicitly requested with --stream (requires run_in_background)
    const stream = args.includes("--stream") && !detach;

    // Load config if exists, otherwise use empty default
    const { config: loaded, tmux } = configExists()
      ? await loadConfigAndTmux()
      : {
          config: { configDir: process.cwd(), config: {} as Config },
          tmux: TmuxManager.createOwned(path.basename(process.cwd())),
        };
    const sessionExists = await tmux.sessionExists();

    if (!sessionExists) {
      await tmux.createSession();
      if (!json) console.log(`Created: ${tmux.sessionName}`);
    }

    const pm = new ProcessManager(loaded.configDir, {
      settings: loaded.config.settings,
      tmuxManager: tmux,
    });

    if (!sessionExists) {
      await pm.startAll(loaded.config);
    } else {
      await pm.loadProcesses(loaded.config);
    }

    const formatStatus = () => {
      const tabs = pm.listTabs();
      const services = tabs.filter(t => t.type === "service");
      const ready = services.filter(s => s.status === "running" || s.status === "ready");

      if (json) {
        return JSON.stringify({
          session: tmux.sessionName,
          status: ready.length === services.length ? "ready" : "starting",
          services: services.map(s => ({ name: s.name, status: s.status ?? "unknown", port: s.port })),
        });
      }
      const lines = [`Session: ${tmux.sessionName}`, `Status: ${ready.length}/${services.length} ready`, ""];
      for (const s of services) {
        const icon = s.status === "running" ? "✓" : s.status === "crashed" ? "✗" : "○";
        lines.push(`  ${icon} ${s.name}${s.port ? `:${s.port}` : ""} - ${s.status ?? "unknown"}`);
      }
      lines.push("", `Events: ${tmux.getEventsFile()}`);
      return lines.join("\n");
    };

    // Wait for services to be ready
    if (!json) console.log("Waiting for services...");
    const start = Date.now();
    let allReady = false;
    let hasCrashed = false;

    while (Date.now() - start < 60000) {
      const tabs = pm.listTabs();
      const services = tabs.filter(t => t.type === "service");
      const done = services.filter(s => s.status === "running" || s.status === "crashed");
      if (done.length === services.length) {
        allReady = true;
        hasCrashed = done.some(s => s.status === "crashed");
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!allReady) {
      console.error(json ? JSON.stringify({ error: "timeout" }) : "Timeout waiting for services");
    }

    // Always select window 0 before exiting (even on timeout)
    try {
      await tmux.selectWindow(0);
    } catch {
      // Ignore
    }

    if (!allReady && !stream) {
      // Exit on timeout unless streaming
      console.log(formatStatus());
      process.exit(1);
    }

    console.log(formatStatus());

    // -d means detached (background), otherwise attach (foreground like docker compose)
    if (detach) {
      process.exit(hasCrashed ? 1 : 0);
    }

    // Foreground mode: attach to session
    if (!process.stdout.isTTY) {
      // No TTY available
      if (stream) {
        // Streaming mode (--stream): output events continuously (requires run_in_background)
        const eventsFile = tmux.getEventsFile();
        let lastSize = 0;

        // Read existing events
        try {
          const content = fs.readFileSync(eventsFile, "utf-8");
          for (const line of content.split("\n")) {
            if (line.trim()) console.log(line);
          }
          lastSize = fs.statSync(eventsFile).size;
        } catch { /* file may not exist yet */ }

        // Tail events file, output new lines to stdout
        setInterval(() => {
          try {
            const stat = fs.statSync(eventsFile);
            if (stat.size > lastSize) {
              const fd = fs.openSync(eventsFile, "r");
              const buffer = Buffer.alloc(stat.size - lastSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastSize);
              fs.closeSync(fd);
              for (const line of buffer.toString().split("\n")) {
                if (line.trim()) {
                  console.log(line);
                  // Auto-cleanup successful interaction panes
                  try {
                    const event = JSON.parse(line);
                    if (event.type === "result" && event.action === "accept" && event.id) {
                      tmux.killPane(event.id).catch(() => { /* ignore */ });
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
              lastSize = stat.size;
            }
          } catch { /* ignore errors */ }
        }, 500);

        // Handle graceful shutdown
        const shutdown = () => {
          console.log(JSON.stringify({ type: "shutdown", ts: Date.now() }));
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return; // Keep process alive
      }

      // Default: output status and exit (safe for agents without run_in_background)
      process.exit(hasCrashed ? 1 : 0);
    }

    process.exit(await tmux.attach());
  }

  // Down command
  if (cmd === "down") {
    const tmux = configExists() ? (await loadConfigAndTmux()).tmux : TmuxManager.createOwned(path.basename(process.cwd()));
    if (await tmux.sessionExists()) {
      await tmux.destroySession();
      console.log(`Stopped: ${tmux.sessionName}`);
    } else {
      console.log("No active session");
    }
    process.exit(0);
  }

  // Connect command - attach to existing session only
  if (cmd === "connect" || cmd === "attach") {
    // Auto-enable JSON mode when no TTY (agent/script context)
    const json = args.includes("--json") || !process.stdout.isTTY;
    const stream = args.includes("--stream");
    const { config: loaded, tmux } = configExists()
      ? await loadConfigAndTmux()
      : { config: null, tmux: TmuxManager.createOwned(path.basename(process.cwd())) };

    if (!(await tmux.sessionExists())) {
      console.error(json ? JSON.stringify({ error: "No active session" }) : "No active session. Run: termos up");
      process.exit(1);
    }

    // No TTY - output status or stream events
    if (!process.stdout.isTTY) {
      if (stream) {
        // Streaming mode (--stream): output events continuously (requires run_in_background)
        const eventsFile = tmux.getEventsFile();
        let lastSize = 0;

        // Read existing events
        try {
          const content = fs.readFileSync(eventsFile, "utf-8");
          for (const line of content.split("\n")) {
            if (line.trim()) console.log(line);
          }
          lastSize = fs.statSync(eventsFile).size;
        } catch { /* file may not exist yet */ }

        // Tail events file
        setInterval(() => {
          try {
            const stat = fs.statSync(eventsFile);
            if (stat.size > lastSize) {
              const fd = fs.openSync(eventsFile, "r");
              const buffer = Buffer.alloc(stat.size - lastSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastSize);
              fs.closeSync(fd);
              for (const line of buffer.toString().split("\n")) {
                if (line.trim()) {
                  console.log(line);
                  // Auto-cleanup successful interaction panes
                  try {
                    const event = JSON.parse(line);
                    if (event.type === "result" && event.action === "accept" && event.id) {
                      tmux.killPane(event.id).catch(() => { /* ignore */ });
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
              lastSize = stat.size;
            }
          } catch { /* ignore errors */ }
        }, 500);

        // Handle graceful shutdown
        const shutdown = () => {
          console.log(JSON.stringify({ type: "shutdown", ts: Date.now() }));
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return; // Keep process alive
      }

      // Default: output status JSON and exit (safe for agents)
      console.log(JSON.stringify({
        session: tmux.sessionName,
      }));
      process.exit(0);
    }

    console.log(`Attaching to ${tmux.sessionName}...`);
    process.exit(await tmux.attach());
  }

  // Commands that require active session
  let loaded: Awaited<ReturnType<typeof loadConfigAndTmux>>["config"];
  let tmux: TmuxManager;
  if (configExists()) {
    try {
      const result = await loadConfigAndTmux();
      loaded = result.config;
      tmux = result.tmux;
    } catch (err) {
      if (cmd === "reload") {
        console.error(`Reload failed: ${formatError(err)}`);
        process.exit(1);
      }
      throw err;
    }
  } else {
    // No config - use default empty config
    loaded = { configDir: process.cwd(), config: {} as Config };
    tmux = TmuxManager.createOwned(path.basename(process.cwd()));
  }

  // Handle run --help before session check (doesn't need active session)
  if (cmd === "run") {
    const runArgs = args.slice(1);
    if (runArgs.includes("--help") || runArgs.includes("-h") || runArgs.length === 0) {
      showRunHelp();
      process.exit(0);
    }
  }

  if (!(await tmux.sessionExists())) {
    console.error(`No active session. Run: termos up`);
    process.exit(1);
  }

  const pm = new ProcessManager(loaded.configDir, { settings: loaded.config.settings, tmuxManager: tmux });
  await pm.loadProcesses(loaded.config);

  // ls
  if (cmd === "ls") {
    const tabs = pm.listTabs();
    if (tabs.length === 0) {
      console.log("No tabs defined");
    } else {
      for (const t of tabs) {
        const parts = [t.name, t.type];
        if (t.type === "service") {
          parts.push(t.status ?? "unknown");
          if (t.port) parts.push(`port=${t.port}`);
          parts.push(`log=${tmux.getServiceLog(t.name)}`);
        }
        console.log(parts.join(" | "));
      }
      console.log(`\nEvents: ${tmux.getEventsFile()}`);
    }
    process.exit(0);
  }

  // start/stop/restart
  if (cmd === "start" || cmd === "stop" || cmd === "restart") {
    const name = args[1];
    if (!name) { console.error(`Usage: termos ${cmd} <service>`); process.exit(1); }
    if (pm.isLayoutTab(name)) { console.error(`"${name}" is a layout tab`); process.exit(1); }
    if (cmd === "start") await pm.startProcess(name);
    else if (cmd === "stop") await pm.stopProcess(name);
    else await pm.restartProcess(name);
    console.log(`${cmd}: ${name}`);
    process.exit(0);
  }

  // reload
  if (cmd === "reload") {
    try {
      const newLoaded = await loadConfig();
      const result = await pm.reload(newLoaded.config);
      emitReloadEvent(tmux.configDir, result.added, result.removed, result.changed, result.tabsReloaded);
      console.log(`Reload: +${result.added.length} -${result.removed.length} ~${result.changed.length}`);
      process.exit(0);
    } catch (err) {
      console.error(`Reload failed: ${formatError(err)}`);
      process.exit(1);
    }
  }

  // pane
  if (cmd === "pane") {
    const [, name, ...rest] = args;
    if (!name || rest.length === 0) { console.error("Usage: termos pane <name> <command>"); process.exit(1); }
    const terminal = await pm.createDynamicTerminal(name, rest.join(" "));
    console.log(`Created: ${terminal.name} (${terminal.paneId})`);
    process.exit(0);
  }

  // rm
  if (cmd === "rm") {
    const name = args[1];
    if (!name) { console.error("Usage: termos rm <name>"); process.exit(1); }
    await pm.removeDynamicTerminal(name);
    console.log(`Removed: ${name}`);
    process.exit(0);
  }

  // status - set/get LLM status with optional prompts
  if (cmd === "status") {
    const clearIdx = args.indexOf("--clear");
    if (clearIdx > 0) {
      emitStatusEvent(tmux.configDir, null);
      await tmux.setSessionTitle(tmux.sessionName);
      await pm.showWelcomeComponent();
      console.log("Status cleared");
      process.exit(0);
    }

    // Parse --prompt flags
    const prompts: string[] = [];
    let message: string | undefined;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--prompt" && args[i + 1]) {
        prompts.push(args[++i]);
      } else if (!args[i].startsWith("--") && !message) {
        message = args[i];
      }
    }

    // No args = show current status
    if (!message) {
      const status = getLatestStatus(tmux.configDir);
      if (status && status.message) {
        console.log(`Status: ${status.message}`);
        if (status.prompts?.length) {
          console.log("Prompts:");
          for (const p of status.prompts) console.log(`  - ${p}`);
        }
      } else {
        console.log("No status set");
      }
      process.exit(0);
    }

    // Set status
    emitStatusEvent(tmux.configDir, message, prompts.length > 0 ? prompts : undefined);
    await tmux.setSessionTitle(`${tmux.sessionName} - ${message}`);
    await pm.showWelcomeComponent();
    console.log(`Status: ${message}`);
    if (prompts.length > 0) {
      console.log("Prompts:");
      for (const p of prompts) console.log(`  - ${p}`);
    }
    process.exit(0);
  }

  // run
  if (cmd === "run") {
    const restArgs = args.slice(1);
    const wait = restArgs[0] === "--wait" ? (restArgs.shift(), true) : false;


    const sepIdx = restArgs.indexOf("--");

    let inkFile: string | undefined;
    let inkArgs: Record<string, string> | undefined;
    let command: string | undefined;

    // Built-in components (resolve from ink-runner/components)
    const builtinComponents: Record<string, string> = {
      "markdown": "markdown.tsx",
      "markdown.tsx": "markdown.tsx",
      "plan-viewer": "plan-viewer.tsx",
      "plan-viewer.tsx": "plan-viewer.tsx",
      "welcome": "welcome.tsx",
      "welcome.tsx": "welcome.tsx",
      "confirm": "confirm.tsx",
      "confirm.tsx": "confirm.tsx",
      "checklist": "checklist.tsx",
      "checklist.tsx": "checklist.tsx",
      "code": "code.tsx",
      "code.tsx": "code.tsx",
      "diff": "diff.tsx",
      "diff.tsx": "diff.tsx",
      "table": "table.tsx",
      "table.tsx": "table.tsx",
      "progress": "progress.tsx",
      "progress.tsx": "progress.tsx",
      "mermaid": "mermaid.tsx",
      "mermaid.tsx": "mermaid.tsx",
    };

    // Special handling for `ask` - uses SchemaForm directly instead of a component file
    const component = restArgs[0]?.toLowerCase();
    if (component === "ask") {
      // Parse args to get --questions or --file
      const cmdArgs: Record<string, string> = {};
      for (let i = 1; i < restArgs.length; i++) {
        const arg = restArgs[i];
        if (arg.startsWith("--")) {
          const key = arg.slice(2);
          const eqIdx = key.indexOf("=");
          if (eqIdx > 0) cmdArgs[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
          else if (restArgs[i + 1]?.charAt(0) !== "-") cmdArgs[key] = restArgs[++i];
        }
      }

      // Support --file to read questions from JSON file (avoids shell escaping issues)
      let questionsArg = cmdArgs["questions"];
      if (!questionsArg && cmdArgs["file"]) {
        try {
          questionsArg = fs.readFileSync(cmdArgs["file"], "utf-8");
        } catch (err) {
          console.error(`Error: Could not read file: ${cmdArgs["file"]}`);
          process.exit(1);
        }
      }

      if (!questionsArg) {
        console.error("Error: --questions or --file is required for ask component");
        console.error("Usage: termos run ask --questions '<json>'");
        console.error("       termos run ask --file /path/to/questions.json");
        process.exit(1);
      }

      let schema;
      try {
        const parsed = JSON.parse(questionsArg);
        schema = Array.isArray(parsed) ? { questions: parsed } : parsed;
      } catch {
        console.error("Error: Invalid JSON in --questions or --file");
        process.exit(1);
      }

      const im = new InteractionManager({ tmuxManager: tmux, cwd: loaded.configDir, configDir: loaded.configDir });
      const id = await im.create({ schema, title: cmdArgs["title"], timeoutMs: wait ? 300000 : 0 });

      // Async by default - return immediately with ID
      if (!wait) {
        console.log(JSON.stringify({ id, status: "started" }));
        process.exit(0);
      }

      const result = await new Promise<InteractionResult>(resolve => {
        im.on("interactionComplete", (iid: string, r: InteractionResult) => { if (iid === id) resolve(r); });
      });
      console.log(JSON.stringify(result));
      process.exit(0);
    }

    if (sepIdx !== -1) {
      command = restArgs.slice(sepIdx + 1).join(" ");
      if (!command) { console.error("Usage: termos run -- <command>"); process.exit(1); }
    } else {
      inkFile = restArgs[0];

      // Check if it's a built-in component
      const builtinFile = builtinComponents[inkFile?.toLowerCase() ?? ""];
      if (builtinFile) {
        // Resolve to bundled component path
        // In dist: dist/ink-runner/components/
        // In dev: packages/ink-runner/components/
        const distPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ink-runner", "components", builtinFile);
        const devPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "packages", "ink-runner", "components", builtinFile);
        inkFile = fs.existsSync(distPath) ? distPath : devPath;
      } else if (!inkFile?.endsWith(".tsx") && !inkFile?.endsWith(".jsx")) {
        console.error("Usage: termos run <component> or termos run -- <command>");
        console.error("\nBuilt-in components:");
        console.error("  ask, confirm, checklist, code, diff, table, progress, mermaid");
        console.error("  markdown, plan-viewer, welcome");
        console.error("\nExamples:");
        console.error("  termos run ask --questions '{\"questions\":[...]}'");
        console.error("  termos run confirm --prompt 'Continue?'");
        process.exit(1);
      }
      // Parse --key value, --key=value, or --arg key=value
      inkArgs = {};

      // Support positional arguments for specific components (LLM-friendly)
      // e.g., `termos run confirm "Are you sure?"` → --prompt "Are you sure?"
      const positionalArgMap: Record<string, string> = {
        "confirm": "prompt",
        "confirm.tsx": "prompt",
        "checklist": "items",
        "checklist.tsx": "items",
        "progress": "steps",
        "progress.tsx": "steps",
        "markdown": "content",
        "markdown.tsx": "content",
      };
      const positionalKey = positionalArgMap[component ?? ""];

      for (let i = 1; i < restArgs.length; i++) {
        const arg = restArgs[i];
        if (arg === "--arg" && restArgs[i + 1]) {
          const [k, ...v] = restArgs[++i].split("=");
          if (k) inkArgs[k] = v.join("=");
        } else if (arg.startsWith("--")) {
          const key = arg.slice(2);
          const eqIdx = key.indexOf("=");
          if (eqIdx > 0) inkArgs[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
          else if (restArgs[i + 1]?.charAt(0) !== "-") inkArgs[key] = restArgs[++i];
        } else if (positionalKey && !inkArgs[positionalKey]) {
          // Treat as positional argument for the component's primary field
          inkArgs[positionalKey] = arg;
        }
      }
      if (!Object.keys(inkArgs).length) inkArgs = undefined;
    }

    const im = new InteractionManager({ tmuxManager: tmux, cwd: loaded.configDir, configDir: loaded.configDir });
    const id = await im.create({ inkFile, inkArgs, command, timeoutMs: wait ? 300000 : 0 });

    // Async mode: return immediately with ID (default for all components)
    // Use --wait to block until interaction completes
    if (!wait) {
      console.log(JSON.stringify({ id, status: "started" }));
      process.exit(0);
    }

    const result = await new Promise<InteractionResult>(resolve => {
      im.on("interactionComplete", (iid: string, r: InteractionResult) => { if (iid === id) resolve(r); });
    });
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}\nRun 'termos help' for usage`);
  process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
