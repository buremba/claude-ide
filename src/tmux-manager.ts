import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type TmuxLayout = "tiled" | "even-horizontal" | "even-vertical" | "main-horizontal" | "main-vertical";

export type TerminalApp = "auto" | "ghostty" | "iterm" | "kitty" | "terminal";

/**
 * Detect the user's terminal application from environment
 * Note: Warp doesn't support running commands, so we skip it and use Terminal.app
 */
export function detectTerminal(): Exclude<TerminalApp, "auto" | "warp"> {
  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram === "ghostty") return "ghostty";
  if (termProgram === "iTerm.app") return "iterm";
  if (termProgram === "kitty") return "kitty";
  // Warp doesn't support running commands, fall back to Terminal.app
  return "terminal";
}

export interface PaneInfo {
  paneId: string;
  panePid: number;
  isDead: boolean;
  exitStatus?: number;
}

export interface TmuxManagerOptions {
  sessionPrefix?: string;
  layout?: TmuxLayout;
}

/**
 * Check if tmux is available on the system
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["tmux"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all active sidecar tmux sessions
 */
export async function listSidecarSessions(prefix = "sidecar"): Promise<Array<{ name: string; windows: number; created: Date }>> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}:#{session_windows}:#{session_created}",
    ]);

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => {
        const [name, windows, created] = line.split(":");
        return {
          name,
          windows: parseInt(windows, 10),
          created: new Date(parseInt(created, 10) * 1000),
        };
      });
  } catch {
    // No sessions or tmux not running
    return [];
  }
}

/**
 * Manages a tmux session for process orchestration
 */
export class TmuxManager {
  readonly sessionName: string;
  private layout: TmuxLayout;
  private paneMap = new Map<string, string>(); // processName -> paneId

  constructor(projectName: string, options: TmuxManagerOptions = {}) {
    const prefix = options.sessionPrefix ?? "sidecar";
    this.sessionName = `${prefix}-${this.sanitizeName(projectName)}`;
    this.layout = options.layout ?? "tiled";
  }

  /**
   * Sanitize project name for use in tmux session name
   */
  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  }

  /**
   * Check if the session already exists
   */
  async sessionExists(): Promise<boolean> {
    try {
      await execFileAsync("tmux", ["has-session", "-t", this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new tmux session (detached)
   * Returns the final session name (may have suffix if collision)
   */
  async createSession(): Promise<string> {
    // Check for collision and find unique name
    let finalName = this.sessionName;
    let suffix = 0;

    while (true) {
      try {
        await execFileAsync("tmux", ["has-session", "-t", finalName]);
        // Session exists, try next suffix
        suffix++;
        finalName = `${this.sessionName}-${suffix}`;
      } catch {
        // Session doesn't exist, we can use this name
        break;
      }
    }

    // Create the session with a placeholder window (we'll replace it)
    await execFileAsync("tmux", [
      "new-session",
      "-d",
      "-s",
      finalName,
      "-n",
      "sidecar",
      // Keep pane alive after command exits to capture exit status
      "-x", "200", // Set initial width
      "-y", "50",  // Set initial height
    ]);

    // Configure session options
    await this.runTmux(["set-option", "-t", finalName, "remain-on-exit", "on"]);
    await this.runTmux(["set-option", "-t", finalName, "history-limit", "50000"]);

    // Update session name if we had to use suffix
    if (finalName !== this.sessionName) {
      (this as { sessionName: string }).sessionName = finalName;
    }

    return finalName;
  }

  /**
   * Destroy the tmux session and all panes
   */
  async destroySession(): Promise<void> {
    try {
      await execFileAsync("tmux", ["kill-session", "-t", this.sessionName]);
    } catch {
      // Session may already be gone
    }
    this.paneMap.clear();
  }

  /**
   * Create a new pane for a process
   * Returns the pane ID
   */
  async createPane(processName: string, command: string, cwd: string, env?: Record<string, string>): Promise<string> {
    // Build environment exports for only custom/process-specific vars
    let envExports = "";
    if (env) {
      const customVars: string[] = [];
      for (const [key, value] of Object.entries(env)) {
        // Only export PORT and custom vars not already in system env
        if (key === "PORT" || !process.env[key]) {
          customVars.push(`export ${key}=${this.shellEscape(value)}`);
        }
      }
      if (customVars.length > 0) {
        envExports = customVars.join("; ") + "; ";
      }
    }

    // Build the shell command
    const shellCommand = `cd ${this.shellEscape(cwd)} && ${envExports}${command}`;

    // Check if this is the first pane (use existing placeholder) or need to split
    const panes = await this.listPanes();
    let paneId: string;

    if (panes.length === 1 && !this.paneMap.size) {
      // First process - respawn the existing pane with our command
      paneId = panes[0].paneId;
      await execFileAsync("tmux", [
        "respawn-pane",
        "-t",
        paneId,
        "-k",  // Kill any existing process
        "sh", "-c", shellCommand,
      ]);
    } else {
      // Create new pane by splitting with the command
      const { stdout } = await execFileAsync("tmux", [
        "split-window",
        "-t",
        this.sessionName,
        "-P",
        "-F",
        "#{pane_id}",
        "-c", cwd,
        "sh", "-c", shellCommand,
      ]);
      paneId = stdout.trim();

      // Rebalance layout
      await this.applyLayout();
    }

    this.paneMap.set(processName, paneId);
    return paneId;
  }

  /**
   * Kill a specific pane
   */
  async killPane(processName: string): Promise<void> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return;

    try {
      await execFileAsync("tmux", ["kill-pane", "-t", paneId]);
    } catch {
      // Pane may already be gone
    }

    this.paneMap.delete(processName);
  }

  /**
   * Send keys to a pane (for commands or signals)
   */
  async sendKeys(paneIdOrName: string, keys: string): Promise<void> {
    const paneId = this.paneMap.get(paneIdOrName) ?? paneIdOrName;
    await execFileAsync("tmux", ["send-keys", "-t", paneId, keys, "Enter"]);
  }

  /**
   * Send interrupt signal (Ctrl+C) to a pane
   */
  async sendInterrupt(processName: string): Promise<void> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return;

    await execFileAsync("tmux", ["send-keys", "-t", paneId, "C-c"]);
  }

  /**
   * Capture pane output (logs)
   */
  async capturePane(processName: string, lines = 100): Promise<string> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return "";

    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t",
        paneId,
        "-p",        // Print to stdout
        "-S",        // Start line
        `-${lines}`, // Negative = from end
      ]);
      return stdout;
    } catch {
      return "";
    }
  }

  /**
   * List all panes in the session with their status
   */
  async listPanes(): Promise<PaneInfo[]> {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "list-panes",
        "-t",
        this.sessionName,
        "-F",
        "#{pane_id}:#{pane_pid}:#{pane_dead}:#{pane_dead_status}",
      ]);

      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [paneId, pid, dead, exitStatus] = line.split(":");
          return {
            paneId,
            panePid: parseInt(pid, 10),
            isDead: dead === "1",
            exitStatus: exitStatus ? parseInt(exitStatus, 10) : undefined,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get status of a specific process pane
   */
  async getPaneStatus(processName: string): Promise<PaneInfo | null> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return null;

    const panes = await this.listPanes();
    return panes.find((p) => p.paneId === paneId) ?? null;
  }

  /**
   * Check if a pane exists and is valid
   */
  async paneExists(processName: string): Promise<boolean> {
    const status = await this.getPaneStatus(processName);
    return status !== null;
  }

  /**
   * Apply layout to the session
   */
  async applyLayout(layout?: TmuxLayout): Promise<void> {
    const layoutToApply = layout ?? this.layout;
    try {
      await execFileAsync("tmux", [
        "select-layout",
        "-t",
        this.sessionName,
        layoutToApply,
      ]);
    } catch {
      // Layout may fail if only one pane
    }
  }

  /**
   * Respawn a command in an existing (dead) pane
   */
  async respawnPane(processName: string, command: string, cwd: string, env?: Record<string, string>): Promise<void> {
    const paneId = this.paneMap.get(processName);
    if (!paneId) return;

    // Build environment export prefix
    let envPrefix = "";
    if (env && Object.keys(env).length > 0) {
      const exports = Object.entries(env)
        .map(([k, v]) => `export ${k}=${this.shellEscape(v)}`)
        .join("; ");
      envPrefix = `${exports}; `;
    }

    const fullCommand = `cd ${this.shellEscape(cwd)} && ${envPrefix}${command}`;

    // Respawn the pane with new command
    try {
      await execFileAsync("tmux", [
        "respawn-pane",
        "-t",
        paneId,
        "-k", // Kill any existing process
        fullCommand,
      ]);
    } catch {
      // If respawn fails, send keys instead
      await this.sendKeys(paneId, fullCommand);
    }
  }

  /**
   * Get the pane ID for a process
   */
  getPaneId(processName: string): string | undefined {
    return this.paneMap.get(processName);
  }

  /**
   * Attach to the session (for CLI use)
   */
  attach(): void {
    // Use spawn with inherit to give user control
    const child = spawn("tmux", ["attach", "-t", this.sessionName], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }

  /**
   * Shell escape a string for safe use in tmux commands
   */
  private shellEscape(str: string): string {
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Run a tmux command
   */
  private async runTmux(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("tmux", args);
    return stdout;
  }

  /**
   * Open a terminal window attached to this tmux session
   * Supports multiple terminal applications: Ghostty, iTerm2, Kitty, Warp, Terminal.app
   */
  async openTerminal(terminalApp?: TerminalApp, cwd?: string): Promise<boolean> {
    if (process.platform !== "darwin") {
      console.error(`[sidecar] Auto-attach only supported on macOS. Run: tmux attach -t ${this.sessionName}`);
      return false;
    }

    const terminal = terminalApp === "auto" || !terminalApp ? detectTerminal() : terminalApp;
    const cmd = `tmux attach -t ${this.sessionName}`;

    console.error(`[sidecar] Opening terminal: ${terminal}`);

    switch (terminal) {
      case "ghostty":
        return this.openInGhostty(cmd);
      case "iterm":
        return this.openInITerm(cmd);
      case "kitty":
        return this.openInKitty(cmd);
      default:
        return this.openInTerminalApp(cmd);
    }
  }

  /**
   * Open Ghostty with command
   */
  private openInGhostty(command: string): boolean {
    try {
      spawn("open", ["-na", "Ghostty.app", "--args", "-e", "/bin/bash", "-c", command], {
        detached: true,
        stdio: "ignore",
      }).unref();
      console.error(`[sidecar] Opened Ghostty attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error(`[sidecar] Failed to open Ghostty: ${err}`);
      return false;
    }
  }

  /**
   * Open iTerm2 with command via AppleScript
   */
  private openInITerm(command: string): boolean {
    try {
      // Escape double quotes in command for AppleScript
      const escapedCommand = command.replace(/"/g, '\\"');
      const script = `
tell application "iTerm2"
  create window with default profile
  tell current session of current window
    write text "${escapedCommand}"
  end tell
end tell`;
      spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
      console.error(`[sidecar] Opened iTerm2 attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error(`[sidecar] Failed to open iTerm2: ${err}`);
      return false;
    }
  }

  /**
   * Open Kitty with command
   */
  private openInKitty(command: string): boolean {
    try {
      // Try kitty in PATH first, fall back to full path
      spawn("kitty", ["-e", "/bin/bash", "-c", command], {
        detached: true,
        stdio: "ignore",
      }).unref();
      console.error(`[sidecar] Opened Kitty attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      // Try full path as fallback
      try {
        spawn("/Applications/kitty.app/Contents/MacOS/kitty", ["-e", "/bin/bash", "-c", command], {
          detached: true,
          stdio: "ignore",
        }).unref();
        console.error(`[sidecar] Opened Kitty attached to ${this.sessionName}`);
        return true;
      } catch (err2) {
        console.error(`[sidecar] Failed to open Kitty: ${err2}`);
        return false;
      }
    }
  }

  /**
   * Open Terminal.app with command (fallback)
   */
  private async openInTerminalApp(command: string): Promise<boolean> {
    try {
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");

      // Create a temporary .command script
      const scriptPath = path.join(os.tmpdir(), `sidecar-attach-${this.sessionName}.command`);
      const script = `#!/bin/bash\n${command}\n`;
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });

      // Open it with default terminal
      spawn("open", [scriptPath], { detached: true, stdio: "ignore" }).unref();

      console.error(`[sidecar] Opened Terminal.app attached to ${this.sessionName}`);
      return true;
    } catch (err) {
      console.error(`[sidecar] Failed to open Terminal.app: ${err}`);
      return false;
    }
  }
}

