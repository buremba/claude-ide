---
allowed-tools: mcp__sidecar__restart_process, mcp__sidecar__list_processes, mcp__sidecar__get_status
---

Restart process: $ARGUMENTS

If no process name is specified, first list available processes with their current status and ask which one to restart.

After restarting, wait a moment and check the new status to confirm the process started successfully.

If the process was crashed, mention that it has been restarted and is now running.
