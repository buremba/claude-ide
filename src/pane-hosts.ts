import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { getSessionRuntimeDir, normalizeSessionName } from "./runtime.js";
import { runFloatingPane } from "./zellij.js";

const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  kind: "zellij" | "mac-terminal";
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
      const closeScriptLines = [
        "on run argv",
        "set target to item 1 of argv",
        "tell application \"Terminal\"",
        "repeat with w in windows",
        "repeat with t in tabs of w",
        "if (tty of t) contains target then",
        "close t",
        "return",
        "end if",
        "end repeat",
        "end repeat",
        "end tell",
        "end run",
      ];
      const osascriptArgs = closeScriptLines
        .map(line => `-e \"${escapeAppleScript(line)}\"`)
        .join(" ");
      const closeTrap = options.closeOnExit
        ? `__termos_close_tab() { __tty=$(tty); if [ -n \"$__tty\" ]; then osascript ${osascriptArgs} \"$__tty\" >/dev/null 2>&1; fi }; trap '__termos_close_tab' EXIT HUP INT TERM`
        : "";
      const shellCommand = buildShellCommand(
        `cd ${shellEscape(cwd)}; ${clearCommand}; ${titleCommand}; ${closeTrap}; ${command}`,
        env
      );
      const script = [
        "tell application \"Terminal\"",
        "activate",
        "if (count of windows) is 0 then",
        "  do script \"\"",
        "end if",
        `set newTab to do script \"${escapeAppleScript(shellCommand)}\" in front window`,
        `set custom title of newTab to \"${escapeAppleScript(`termos:${name}`)}\"`,
        "set title displays custom title of newTab to true",
        "end tell",
      ].join("\n");
      await execFileAsync("osascript", ["-e", script]);
    },
    async close(name) {
      if (!name) return;
      const ttyFile = path.join(getSessionRuntimeDir(sessionName), `tty-${name}.txt`);
      let tty: string | undefined;
      try {
        tty = fs.readFileSync(ttyFile, "utf-8").trim();
      } catch {
        tty = undefined;
      }
      const target = `termos:${name}`;
      const script = [
        "tell application \"Terminal\"",
        "set closed to false",
        "repeat with w in windows",
        "repeat with t in tabs of w",
        ...(tty ? [
          `if (tty of t) contains \"${escapeAppleScript(tty)}\" then`,
          "close t",
          "set closed to true",
          "exit repeat",
          "end if",
        ] : []),
        "set tabTitle to \"\"",
        "try",
        "set tabTitle to custom title of t",
        "end try",
        `if tabTitle is \"${escapeAppleScript(target)}\" then`,
        "close t",
        "set closed to true",
        "exit repeat",
        "end if",
        `if (name of t) contains \"${escapeAppleScript(target)}\" then`,
        "close t",
        "set closed to true",
        "exit repeat",
        "end if",
        "end repeat",
        "if closed then exit repeat",
        "end repeat",
        "if not closed then",
        "try",
        "set w to front window",
        "if (count of tabs of w) is 1 then",
        "set t to first tab of w",
        `if (name of t) contains \"${escapeAppleScript(target)}\" then`,
        "close w",
        "set closed to true",
        "end if",
        "end if",
        "end try",
        "end if",
        "if closed then return \"closed\"",
        "return \"not_closed\"",
        "end tell",
      ].join("\n");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { stdout } = await execFileAsync("osascript", ["-e", script]);
        if (stdout.trim() === "closed") return;
        await sleep(200);
      }
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
    return createMacTerminalHost(resolved.name);
  }

  throw new Error("termos must be run inside a Zellij session on this platform.");
}
