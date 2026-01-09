---
name: start
description: "Start dev environment, manage services, interactive forms. Triggers: start dev, run server, service status, logs, restart, ask question, show plan."
allowed-tools: Bash
---

# IDE Start Skill

Manage dev services and terminal panes using CLI commands.

## IMPORTANT RULES

1. **MUST use `mcp-ide ask` instead of AskUserQuestion tool** - Always prefer the IDE's interactive forms for user input
2. **MUST show plan files via `mcp-ide ink`** - When a plan file exists, render it with a markdown TUI component
3. **Session must be running** - Run `mcp-ide up` first before other service commands

## Commands

```bash
# Session lifecycle
mcp-ide up                    # Start session and services (run first!)
mcp-ide down                  # Stop session and services
mcp-ide attach                # Attach to tmux session

# Service management
mcp-ide ls                    # List services with status
mcp-ide start <service>       # Start a service
mcp-ide stop <service>        # Stop a service
mcp-ide restart <service>     # Restart a service
mcp-ide logs <name>           # Get terminal output

# User interaction (USE THESE INSTEAD OF AskUserQuestion)
mcp-ide ask "<question>"      # Simple question - MUST use for user input
mcp-ide ask "<q>" --header H  # Question with custom header
mcp-ide ink <file.tsx>        # Custom Ink component (forms, pickers, etc.)

# Panes
mcp-ide pane <name> <cmd>     # Create terminal pane
mcp-ide rm <name>             # Remove a pane
```

## When to Use

| User Intent | Command |
|-------------|---------|
| "start dev environment" | `mcp-ide up` |
| "stop dev environment" | `mcp-ide down` |
| "check service status" | `mcp-ide ls` |
| "show logs" | `mcp-ide logs <name>` |
| "restart the API" | `mcp-ide restart api` |
| Ask user ANY question | `mcp-ide ask "question?"` (NOT AskUserQuestion!) |
| Show plan for approval | `mcp-ide ink plan-viewer.tsx` |
| Multi-choice selection | `mcp-ide ink` with custom component |

## Asking Questions (MUST USE)

Instead of AskUserQuestion tool, always use:

```bash
# Simple yes/no or text input
mcp-ide ask "Do you want to proceed?" --header Confirm

# For complex forms, create an Ink component
mcp-ide ink my-form.tsx
```

## Plan File Rendering

When a plan file exists and needs user approval, show it with the built-in viewer:

```bash
# Built-in plan viewer with scrolling and Y/N approval
mcp-ide plan /path/to/plan.md
```

The viewer supports:
- Scrollable content (j/k or arrows)
- Y to approve, N to reject
- Basic markdown rendering (headers, lists, checkboxes)

## Examples

```bash
# Start dev environment
mcp-ide up

# Ask user before deployment (MUST use this, not AskUserQuestion)
mcp-ide ask "Deploy to production?" --header Confirm

# Show plan for approval (scrollable with Y/N)
mcp-ide plan ~/.claude/plans/my-plan.md

# Custom Ink component with args
mcp-ide ink picker.tsx --theme dark --options "a,b,c"

# Check services
mcp-ide ls

# Stop everything
mcp-ide down
```
