---
allowed-tools: mcp__sidecar__get_logs, mcp__sidecar__list_processes
---

Get logs for process: $ARGUMENTS

If no process name is specified, first list available processes and ask which one.

Show the last 50 lines by default. Highlight any lines containing "error", "Error", or "ERROR" in red.

Options the user might provide:
- Process name as first argument
- "all" to show combined stdout and stderr
- A number to change the tail count (e.g., "100" for last 100 lines)
