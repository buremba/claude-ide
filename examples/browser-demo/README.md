# Browser Demo

Demonstrates MCP Sidecar's browser automation features.

## Prerequisites

```bash
# Install dependencies (from project root)
npm install

# Install Playwright browser
npx playwright install chromium

# Build the project
npm run build
```

## Running the Demo

### Option 1: Run Tests

```bash
# Basic browser manager test
node test-browser.js

# Tab operations test
node test-crash-recovery.js
```

### Option 2: Run with MCP Sidecar

```bash
# Start sidecar (will launch browser and open tab when server is ready)
npx mcp-sidecar
```

Then use MCP tools:
- `browser_list` - List open tabs
- `browser_open` - Open new tab
- `browser_eval` - Execute JavaScript
- `browser_screenshot` - Capture screenshot

## Files

- `sidecar.yaml` - MCP Sidecar configuration with browser enabled
- `server.cjs` - Simple HTTP server for testing
- `test-browser.js` - BrowserManager unit tests
- `test-crash-recovery.js` - Tab operation tests

## Configuration

```yaml
reuse: true  # Required for browser features

browser:
  enabled: true       # Enable browser automation
  headless: false     # Show browser window (set true for CI)
  autoOpen: true      # Auto-open tabs when processes ready
```
