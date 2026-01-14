import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { normalizeSessionName } from "./runtime.js";
import { runFloatingPane } from "./zellij.js";

const execFileAsync = promisify(execFile);

export interface PaneRunOptions {
  name?: string;
  cwd?: string;
  width?: string;
  height?: string;
  x?: string;
  y?: string;
  closeOnExit?: boolean;
}

export interface PaneHost {
  kind: "zellij" | "ghostty" | "mac-terminal";
  sessionName: string;
  supportsGeometry: boolean;
  run(command: string, options: PaneRunOptions, env?: Record<string, string>): Promise<void>;
  close?(name?: string): Promise<void>;
}

function resolveSessionName(cwd: string, override?: string): { name: string; inZellij: boolean } {
  const zellijName = process.env.ZELLIJ_SESSION_NAME;
  if (zellijName && zellijName.trim().length > 0) {
    return { name: zellijName.trim(), inZellij: true };
  }

  const explicit = override ?? process.env.TERMOS_SESSION_NAME;
  if (explicit && explicit.trim().length > 0) {
    return { name: explicit.trim(), inZellij: false };
  }

  const base = path.basename(cwd || process.cwd()) || "session";
  return { name: normalizeSessionName(base), inZellij: false };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(command: string, env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) {
    return command;
  }
  const envParts = Object.entries(env).map(([key, value]) => `${key}=${shellEscape(value)}`);
  return `env ${envParts.join(" ")} ${command}`;
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function findExecutable(name: string): string | undefined {
  const envPath = process.env.PATH ?? "";
  const entries = envPath.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const fullPath = path.join(entry, name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && (stat.mode & 0o111)) {
        return fullPath;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function resolveGhosttyApp(): string | undefined {
  const appCandidates = [
    "/Applications/Ghostty.app",
    path.join(os.homedir(), "Applications", "Ghostty.app"),
  ];
  for (const candidate of appCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function createZellijHost(sessionName: string): PaneHost {
  return {
    kind: "zellij",
    sessionName,
    supportsGeometry: true,
    async run(command, options, env) {
      await runFloatingPane(command, options, env);
    },
  };
}

function createGhosttyHost(sessionName: string): PaneHost {
  const ghosttyApp = resolveGhosttyApp() ?? "Ghostty.app";
  return {
    kind: "ghostty",
    sessionName,
    supportsGeometry: false,
    async run(command, options, env) {
      const cwd = options.cwd ?? process.cwd();
      const name = options.name ?? "termos";
      const clearCommand = `printf '\\033[3J\\033[H\\033[2J'`;
      const titleCommand = `printf '\\033]0;termos:${name}\\007'`;
      const closeNote = options.closeOnExit
        ? `; printf '\\n[termos] Pane closed. Please close this tab/window.\\n'`
        : "";
      const shellCommand = buildShellCommand(
        `cd ${shellEscape(cwd)}; ${clearCommand}; ${titleCommand}; ${command}${closeNote}`,
        env
      );
      await execFileAsync("open", ["-na", ghosttyApp, "--args", "-e", "sh", "-lc", shellCommand]);
    },
  };
}

function createMacTerminalHost(sessionName: string): PaneHost {
  const host: PaneHost = {
    kind: "mac-terminal",
    sessionName,
    supportsGeometry: false,
    async run(command, options, env) {
      const cwd = options.cwd ?? process.cwd();
      const name = options.name ?? "termos";
      const clearCommand = `printf '\\033[3J\\033[H\\033[2J'`;
      const titleCommand = `printf '\\033]0;termos:${name}\\007'`;
      const closeNote = options.closeOnExit
        ? `; printf '\\n[termos] Pane closed. Please close this tab/window.\\n'`
        : "";
      const shellCommand = buildShellCommand(
        `cd ${shellEscape(cwd)}; ${clearCommand}; ${titleCommand}; ${command}${closeNote}`,
        env
      );
      const scriptLines = [
        "tell application \"Terminal\"",
        "activate",
        "if (count of windows) is 0 then",
        "  do script \"\"",
        "end if",
        `set newTab to do script \"${escapeAppleScript(shellCommand)}\" in front window`,
        `set custom title of newTab to \"${escapeAppleScript(`termos:${name}`)}\"`,
        "set title displays custom title of newTab to true",
      ];
      scriptLines.push("end tell");
      await execFileAsync("osascript", ["-e", scriptLines.join("\n")]);
    },
  };
  return host;
}

export function selectPaneHost(cwd: string, sessionNameOverride?: string): PaneHost {
  const resolved = resolveSessionName(cwd, sessionNameOverride);
  if (resolved.inZellij) {
    return createZellijHost(resolved.name);
  }

  if (process.platform === "darwin") {
    if (findExecutable("ghostty") || resolveGhosttyApp()) {
      return createGhosttyHost(resolved.name);
    }
    return createMacTerminalHost(resolved.name);
  }

  throw new Error("termos must be run inside a Zellij session on this platform.");
}
