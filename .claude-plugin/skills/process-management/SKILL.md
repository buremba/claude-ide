---
name: process-management
description: Monitor and manage background dev processes. Use when user asks about process status, logs, ports, preview URLs, or needs to restart services.
allowed-tools: mcp__sidecar__*
---

# Process Management Skill

Use the sidecar MCP server for all process-related tasks. The sidecar manages background dev servers defined in `sidecar.yaml`.

## Available Tools

- `list_processes` - Get overview of all processes (name, status, port, health)
- `get_status` - Get detailed status of a single process
- `get_logs` - Get stdout/stderr logs for a process
- `get_url` - Get the preview URL for a process
- `restart_process` - Restart a crashed or stuck process

## When to Use

Use these tools when the user:
- Asks about running processes or dev servers
- Wants to see logs from a service
- Needs a preview URL or port number
- Reports a service is down or not responding
- Asks to restart or refresh a service

## Best Practices

1. Always check process status before suggesting restarts
2. When a user reports issues, check logs first to diagnose
3. If a process is crashed, offer to restart it
4. When showing URLs, use the `get_url` tool for accuracy

## Alternative: Direct tmux Access

Processes run in a tmux session. For interactive access (scrolling, real-time logs), users can attach directly:

```bash
# Find the session name
tmux list-sessions | grep sidecar

# Attach to the session
tmux attach -t sidecar-<project-name>
```

Inside tmux:
- Navigate panes with `Ctrl+b` then arrow keys
- Scroll with `Ctrl+b` then `[`, use arrow keys, press `q` to exit scroll mode
- Detach with `Ctrl+b` then `d`
