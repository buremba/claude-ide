#!/bin/bash
# mcp-sidecar statusline script
# Reads process status from JSON and formats for Claude Code's statusline
#
# Only shows output if sidecar.yaml exists in the current directory
# and there's a valid status file from the MCP server

# Read stdin (Claude Code passes session context as JSON)
cat > /dev/null

# Check if sidecar.yaml exists in current directory
if [ ! -f "sidecar.yaml" ] && [ ! -f "sidecar.yml" ]; then
  # No sidecar config, output nothing
  echo ""
  exit 0
fi

# Find the most recent status file
STATUS_FILE=$(ls -t /tmp/mcp-sidecar-status-*.json 2>/dev/null | head -1)

# Check if file exists
if [ ! -f "$STATUS_FILE" ]; then
  echo ""
  exit 0
fi

# Check if file is stale (older than 30 seconds = sidecar not running)
if [ "$(uname)" = "Darwin" ]; then
  FILE_AGE=$(($(date +%s) - $(stat -f %m "$STATUS_FILE")))
else
  FILE_AGE=$(($(date +%s) - $(stat -c %Y "$STATUS_FILE")))
fi

if [ "$FILE_AGE" -gt 30 ]; then
  echo ""
  exit 0
fi

# ANSI colors
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
RESET='\033[0m'

# Parse JSON and format output
if command -v jq &>/dev/null; then
  OUTPUT=$(jq -r '
    .processes | map(
      .name +
      (if .port then ":" + (.port | tostring) else "" end) +
      " " +
      (if .status == "ready" or .status == "running" or .status == "completed" then
        (if .healthy == false then "!" else "✓" end)
      elif .status == "crashed" then "✗"
      elif .status == "starting" then "…"
      else "○" end)
    ) | join(" │ ")
  ' "$STATUS_FILE" 2>/dev/null || echo "")
else
  # Node.js fallback
  OUTPUT=$(node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync('$STATUS_FILE', 'utf8'));
      const parts = data.processes.map(p => {
        let part = p.name;
        if (p.port) part += ':' + p.port;
        if (['ready', 'running', 'completed'].includes(p.status)) {
          part += p.healthy === false ? ' !' : ' ✓';
        } else if (p.status === 'crashed') {
          part += ' ✗';
        } else if (p.status === 'starting') {
          part += ' …';
        } else {
          part += ' ○';
        }
        return part;
      });
      console.log(parts.join(' │ '));
    } catch { console.log(''); }
  " 2>/dev/null || echo "")
fi

# Add colors
if [ -n "$OUTPUT" ]; then
  OUTPUT=$(echo "$OUTPUT" | sed \
    -e "s/✓/${GREEN}✓${RESET}/g" \
    -e "s/✗/${RED}✗${RESET}/g" \
    -e "s/!/${YELLOW}!${RESET}/g" \
    -e "s/…/${YELLOW}…${RESET}/g")
  echo -e "$OUTPUT"
else
  echo ""
fi
