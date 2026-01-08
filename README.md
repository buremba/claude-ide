# mcp-sidecar

MCP server for managing development processes. Start, stop, and monitor your dev servers through Claude Code.

## Installation

```bash
npm install -g mcp-sidecar
```

Or use with npx:
```bash
npx mcp-sidecar
```

## Quick Start

1. Create a `sidecar.yaml` in your project:

```yaml
processes:
  api:
    command: npm run dev
    port: 3000

  frontend:
    command: npm run dev
    cwd: ./frontend
```

2. Add to your Claude Code MCP config:

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

3. Use the tools in Claude Code:

```
> list_processes
api: ready | port=3000
frontend: ready | port=5173

> get_logs api --tail 20
[last 20 lines of api logs]

> restart_process api
Process "api" restarted
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_processes` | List all processes with status |
| `start_process(name)` | Start a process |
| `stop_process(name)` | Stop a process |
| `restart_process(name)` | Restart a process |
| `get_status(name)` | Get detailed status |
| `get_logs(name, tail?)` | Get process logs |
| `get_url(name)` | Get process URL |

## Configuration

### Process Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `command` | string | required | Shell command to run |
| `cwd` | string | config dir | Working directory (relative to config) |
| `port` | number | auto-detect | Fixed port (injected as `$PORT` env var) |
| `force` | boolean | false | Kill existing process on port |
| `autoStart` | boolean | true | Start automatically on boot |
| `env` | object | {} | Environment variables |
| `envFile` | string | none | Path to .env file |
| `restartPolicy` | string | "onFailure" | `always`, `onFailure`, or `never` |
| `maxRestarts` | number | 5 | Max restart attempts |
| `healthCheck` | string | none | HTTP path for health checks |
| `dependsOn` | string/array | none | Process dependencies |

### Settings

```yaml
settings:
  logBufferSize: 1000        # Log lines to keep per process
  healthCheckInterval: 10000  # Health check interval (ms)
  dependencyTimeout: 60000    # Dependency wait timeout (ms)
  restartBackoffMax: 30000    # Max restart backoff (ms)
  processStopTimeout: 5000    # Graceful stop timeout (ms)
```

### Port Detection

Ports are automatically detected from process output. Common patterns:
- `Local: http://localhost:5173`
- `Server listening on port 3000`
- `http://localhost:PORT`

### Restart Policies

- **`always`**: Restart on any exit (daemon-style)
- **`onFailure`**: Restart only on non-zero exit (default)
- **`never`**: Run once, don't restart (for build steps)

### Dependencies

```yaml
processes:
  db:
    command: docker compose up postgres
    port: 5432

  api:
    command: npm run dev
    dependsOn: db
```

## License

MIT
