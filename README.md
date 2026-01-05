# mcp-sidecar

An MCP server that runs alongside your code - managing dev servers, providing preview URLs, and keeping logs accessible to AI agents.

## Quick Install

### Claude Code (Full Plugin - Recommended)

```bash
/plugin marketplace add buremba/mcp-sidecar && /plugin install sidecar@buremba-mcp-sidecar
```

This gives you:
- **MCP tools** - `list_processes`, `get_logs`, `restart_process`, etc.
- **Slash commands** - `/sidecar:status`, `/sidecar:logs`, `/sidecar:restart`
- **Skills** - Claude auto-uses sidecar for process-related tasks
- **Statusline** - Live process status: `api:3000 ✓ | web:5173 ✗`

### Other MCP Clients

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "sidecar": {
      "command": "npx",
      "args": ["-y", "mcp-sidecar"]
    }
  }
}
```

Or via Claude CLI:

```bash
claude mcp add sidecar -- npx -y mcp-sidecar
```

## Features

- **Config-based**: Define processes in `sidecar.yaml` (no arbitrary command execution)
- **Auto-start**: All processes boot when MCP server connects
- **Reuse mode**: Share one process manager across multiple sessions in the same directory
- **Port allocation**: Auto-allocate ports (3000-4000 range) or use fixed ports
- **Preview URLs**: Get `http://localhost:PORT` URLs for each process
- **Dependencies**: Wait for a process to be ready before starting another
- **Health checks**: Optional HTTP endpoint polling
- **Auto-restart**: Configurable restart-on-crash with exponential backoff
- **Env file reloads**: Restart processes when their env files change
- **Logs**: Circular buffer of last 1000 lines per process
- **Statusline**: Live process status in Claude Code's status bar
- **Browser automation**: Optional Playwright browser with auto-open tabs and MCP tools

## Installation

```bash
npm install -g mcp-sidecar
```

Or use directly with npx:

```bash
npx mcp-sidecar
```

### CLI Options

```
mcp-sidecar [options]

Options:
  -c, --config <path>  Path to sidecar.yaml config file
  -h, --help           Show help message
```

**Behavior:**
- Auto-detects `sidecar.yaml` in current directory
- If no config found, starts with no processes (MCP tools still available)
- With `--config`, loads from specified path

## Configuration

Create `sidecar.yaml` in your project root:

```yaml
reuse: true
processes:
  frontend:
    command: npm run dev
    cwd: ./frontend
    # Port auto-detected from output like "Local: http://localhost:5173"

  backend:
    command: python manage.py runserver 0.0.0.0:$PORT
    cwd: ./backend
    port: 8000                    # Fixed port, injected as $PORT
    envFile: .env                 # Load environment from file
    restartPolicy: always         # Always restart (daemon-style)
    env:
      DEBUG: "true"               # Explicit vars override envFile

  # One-shot build step
  build:
    command: npm run build
    cwd: ./packages/api
    restartPolicy: never          # Runs once, then done

  api:
    command: go run .
    cwd: ./api
    healthCheck: /health          # Optional health endpoint
    dependsOn: build              # Wait for build to complete
```

### Top-level Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `reuse` | boolean or string | false | Reuse a single process manager per config directory (`true`) or provide a custom reuse key |

### Process Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `command` | string | required | Shell command to run |
| `cwd` | string | config dir | Working directory (relative to config) |
| `port` | number | (detected) | Fixed port, injected as `$PORT` env var |
| `autoStart` | boolean | true | Start the process automatically on boot |
| `stdoutPatternVars` | object | none | Map of variable names to regex patterns (capture group 1) to extract from stdout/stderr |
| `readyVars` | string[] | none | Variables that must be present before the process is considered ready |
| `env` | object | {} | Environment variables |
| `envFile` | string | none | Path to .env file (relative to config dir) |
| `restartPolicy` | string | `onFailure` | `always`, `onFailure`, or `never` |
| `maxRestarts` | number | 5 | Max restart attempts (with exponential backoff) |
| `healthCheck` | string | none | HTTP path or full URL to poll (e.g., `/health` or `https://localhost:3000/health`) |
| `dependsOn` | string | none | Wait for another process to be ready |

### Browser Options

Browser automation requires `reuse: true`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | false | Enable browser automation |
| `headless` | boolean | false | Run browser in headless mode |
| `storageStateDir` | string | none | Directory to persist browser auth state (relative to config dir) |
| `persistByDefault` | boolean | false | Persist storageState by default for all contexts |
| `autoOpen` | boolean or string[] | true | Auto-open tabs for ready processes: true (all), false (none), or list of process names |
| `userDataDir` | string | temp dir | Persistent browser profile directory (relative to config dir) |
| `copyProfileFrom` | string or null | `auto` | `auto` to copy default Chrome profile, null for a fresh profile, or a custom profile path (relative to config dir) |

Note: The browser uses a single persistent profile for all processes, so cookies/localStorage are shared.

### Restart Policies

- **`always`**: Restart on any exit (like a daemon). Uses exponential backoff.
- **`onFailure`**: Restart only on non-zero exit code (default).
- **`never`**: Run once and don't restart. Process is marked "ready" when it exits successfully. Use for build steps.

### Readiness

If `healthCheck` is set, a process is ready when the health check passes. Otherwise, readiness is based on `readyVars` (or `url`/`port` if those are exported) and falls back to immediate readiness when no readiness signals exist.

### Port Detection

Ports are **automatically detected** from process output. Common patterns supported:
- Vite: `Local: http://localhost:5173`
- Next.js: `- Local: http://localhost:3000`
- Express: `Server listening on port 3000`
- Generic: `http://localhost:PORT`

For frameworks that need a specific port, use `port: 8000` and reference `$PORT` in your command.

### VS Code in Browser

Run VS Code in your browser using [code-server](https://github.com/coder/code-server):

**Install code-server:**
```bash
brew install code-server
# or: npm install -g code-server
```

**Add to sidecar.yaml:**
```yaml
processes:
  vscode:
    command: code-server --bind-addr localhost:$PORT --auth none .
    port: 8443
    restartPolicy: onFailure
    autoStart: false
```

**Usage:**
```
> start_process vscode
> get_url vscode
http://localhost:8443
```

With `browser.enabled: true` and `browser.autoOpen: true`, the browser will automatically open VS Code when the process becomes ready.

**Alternative: VS Code Tunnel (Microsoft)**

For access via vscode.dev with full Microsoft extension marketplace:
```yaml
processes:
  vscode:
    command: code tunnel --accept-server-license-terms
    restartPolicy: onFailure
    autoStart: false
```
Note: Requires GitHub/Microsoft login and internet connection.

### Stdout Variable Capture

Use `stdoutPatternVars` to extract named variables from log lines. The first capture group is stored as the variable value.

```yaml
processes:
  api:
    command: pnpm dev
    stdoutPatternVars:
      url: "Server running at (https?://localhost:\\d+)"
```

### Manual Start

Set `autoStart: false` to prevent a process from starting automatically, then use the `start_process` tool when you want to launch it (optionally with extra args/env).

### Reuse Mode

When `reuse` is enabled, sidecar uses a per-directory IPC socket so multiple sessions attach to the same process manager. New sessions proxy tool calls to the existing daemon instead of starting duplicate processes. The socket path is derived from the real config directory (a stable hash) plus an optional custom reuse key and is created under `/tmp` on Unix or a named pipe on Windows.

```yaml
reuse: true
```

```yaml
reuse: api
```

### Environment Variable Interpolation

- `$PORT` - Fixed port for this process (only if `port` is set)
- `$VAR` - System environment variable
- `$processes.name.var` - Exported variable from another process (including `port`)

## Usage with Claude Code

### Option 1: Plugin (Recommended)

Use the [Quick Install](#quick-install) plugin approach for the best experience:
- Automatic statusline showing process status
- Slash commands like `/sidecar:status`
- Skills that make Claude smarter about your processes

### Option 2: Project-level MCP

Add `.mcp.json` to your project root (next to `sidecar.yaml`):

```json
{
  "mcpServers": {
    "sidecar": {
      "command": "npx",
      "args": ["-y", "mcp-sidecar"]
    }
  }
}
```

When Claude Code opens the project, it will:
1. Load the MCP server from `.mcp.json`
2. The server auto-detects `sidecar.yaml` in the same directory
3. All processes start automatically

**Project structure:**
```
my-project/
├── .mcp.json          # MCP server config (add this)
├── sidecar.yaml       # Process definitions (add this)
├── frontend/
├── backend/
└── ...
```

Then use in Claude Code:

```
> list_processes
frontend: ready | pid=12345 | port=3047 | url=http://localhost:3047
backend: ready | pid=12346 | port=8000 | url=http://localhost:8000

> get_logs frontend --tail 20
[last 20 lines of frontend logs]

> get_url frontend
http://localhost:3047

> restart_process frontend
Process "frontend" restarted. Status: starting
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_processes` | List all processes with status, PID, port, URL |
| `get_logs(name, tail?, stream?)` | Get stdout/stderr logs (default: last 100 lines) |
| `get_url(name)` | Get the preview URL for a process |
| `start_process(name, args?, env?)` | Start a process with optional args/env overrides |
| `restart_process(name)` | Restart a process |
| `get_status(name)` | Detailed status of a single process |

## Parallel Agents

When running multiple AI agents in parallel (each with their own MCP server instance), each server independently allocates ports from the 3000-4000 range. This ensures no port conflicts between agents unless `reuse: true` is enabled, in which case all sessions in the same directory share a single process manager.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with MCP inspector
npm run inspector
```

## License

MIT
