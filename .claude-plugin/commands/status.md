---
allowed-tools: mcp__ide__list_processes, mcp__ide__get_status
---

List all processes and their current status using the IDE MCP tools.

Show a formatted table with columns: Name, Port, Status, Health.

Use these status indicators:
- Running/Ready: green checkmark
- Crashed: red X
- Starting: yellow spinner
- Pending: gray circle

If a process has a health check configured, show its health status.
