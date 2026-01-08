# MCP Sidecar Project Instructions

## Testing

Run the MCP server and test with Claude Code:

```bash
# Create a sidecar.yaml in any project directory
cd /path/to/project
npx mcp-sidecar

# Or run from this repo
node dist/index.js
```

Then use the sidecar tools (`start_process`, `stop_process`, `get_logs`, `get_status`, etc.) to manage processes.

## Screenshots

Never change window focus to take screenshots - this disrupts the user's workflow.

Use window-specific capture instead:
```bash
# List windows to find the window ID
osascript -e 'tell app "System Events" to get {name, id} of every window of every process'

# Capture specific window by ID (doesn't change focus)
screencapture -l <window_id> /tmp/screenshot.png
```
