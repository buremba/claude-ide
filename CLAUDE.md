# MCP Sidecar Project Instructions

## Testing Examples

When asked to test an "example" (e.g., "vscode example", "nextjs example"):
1. The example refers to the folder at `examples/<name>/`
2. Run the MCP sidecar server from that directory, NOT the underlying process directly
3. Test via Claude Code with the sidecar plugin, or launch Claude Code in tmux targeting the example folder

### How to Test an Example

Option 1 - Launch Claude Code in the example folder via tmux:
```bash
tmux new-session -d -s <example>-test -c examples/<example> "claude"
```

Option 2 - Run the MCP server directly:
```bash
cd examples/<example>
npx mcp-sidecar
# or: node ../../dist/index.js
```

Then use the sidecar tools (start_process, get_logs, etc.) to manage the configured processes.

## Screenshots

Never change window focus to take screenshots - this disrupts the user's workflow.

Use window-specific capture instead:
```bash
# List windows to find the window ID
osascript -e 'tell app "System Events" to get {name, id} of every window of every process'

# Capture specific window by ID (doesn't change focus)
screencapture -l <window_id> /tmp/screenshot.png
```

For Playwright/Chromium windows managed by sidecar, use the `browser_screenshot` tool instead.

## Direct Testing

You can test examples directly by running the MCP server and calling tools based on the `sidecar.yaml` configuration:

```bash
# Run MCP server in example folder
cd examples/<name>
node ../../dist/index.js

# Or use Claude Code - the sidecar plugin auto-loads from sidecar.yaml
cd examples/<name>
claude
```

The sidecar.yaml defines available processes. Use sidecar tools (`start_process`, `browser_open`, etc.) to interact with them.
