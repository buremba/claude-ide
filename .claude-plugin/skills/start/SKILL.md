---
name: start
description: "Start dev environment, manage services, create terminals. Triggers: start dev, run server, service status, logs, restart."
allowed-tools: Bash, mcp__plugin_ide_ide__*
---

# IDE Start Skill

Manage dev services and terminal panes. **Prefer CLI commands** over MCP tools - they're more composable and can be chained.

## CLI Commands (Recommended)

```bash
mcp-ide ls                    # List services with status
mcp-ide start <service>       # Start a service
mcp-ide stop <service>        # Stop a service
mcp-ide restart <service>     # Restart a service
mcp-ide logs <name>           # Get terminal output
mcp-ide pane <name> <cmd>     # Create terminal pane
mcp-ide rm <name>             # Remove a pane
mcp-ide ask <question>        # Ask user a question
mcp-ide ink <file.tsx>        # Run custom Ink component
mcp-ide attach [session]      # Attach to tmux session
```

## When to Use

| User Intent | Command |
|-------------|---------|
| "start dev environment" | `mcp-ide ls` |
| "check service status" | `mcp-ide ls` |
| "show logs" | `mcp-ide logs <name>` |
| "restart the API" | `mcp-ide restart api` |
| "run a command in background" | `mcp-ide pane <name> <cmd>` |
| "ask user a question" | `mcp-ide ask "question?"` |
| "show a picker/form" | `mcp-ide ink picker.tsx` |

## MCP Tools (Alternative)

MCP equivalents (use CLI when possible):

- `list_services`, `manage_service`, `capture_pane`, `create_pane`, `remove_pane`
- `show_user_interaction` - Forms/Ink components (CLI: `ask`, `ink`)
- `get_user_interaction` - Get async interaction result
- `set_status` - Update window title

## Examples

```bash
# Check all services
mcp-ide ls

# Restart crashed service
mcp-ide restart api

# View recent logs
mcp-ide logs api

# Run build in background
mcp-ide pane build "npm run build"

# Chain commands
mcp-ide restart api && mcp-ide logs api
```
