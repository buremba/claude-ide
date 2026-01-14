import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function requireZellijSession(): string {
  const name = process.env.ZELLIJ_SESSION_NAME;
  if (!name) {
    throw new Error("termos must be run inside a Zellij session.");
  }
  return name;
}

export interface FloatingPaneOptions {
  name?: string;
  width?: string;
  height?: string;
  x?: string;
  y?: string;
  closeOnExit?: boolean;
  cwd?: string;
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

export async function runFloatingPane(
  command: string,
  options: FloatingPaneOptions = {},
  env?: Record<string, string>
): Promise<void> {
  const args = ["run", "--floating"];

  if (options.closeOnExit) args.push("--close-on-exit");
  if (options.name) args.push("--name", options.name);
  if (options.cwd) args.push("--cwd", options.cwd);
  if (options.width) args.push("--width", options.width);
  if (options.height) args.push("--height", options.height);
  if (options.x) args.push("--x", options.x);
  if (options.y) args.push("--y", options.y);

  const shellCommand = buildShellCommand(command, env);
  args.push("--", "sh", "-c", shellCommand);

  await execFileAsync("zellij", args);
}
