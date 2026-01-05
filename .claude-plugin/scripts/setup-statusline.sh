#!/bin/bash
# Auto-configure statusline on first session
# This hook runs on SessionStart and adds statusline config if not present

SETTINGS="$HOME/.claude/settings.json"
STATUSLINE_CMD="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/scripts/statusline.sh"

# Ensure .claude directory exists
mkdir -p "$HOME/.claude"

# Create settings.json if missing
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi

# Check if statusLine already configured
if grep -q '"statusLine"' "$SETTINGS" 2>/dev/null; then
  # Already configured, don't override
  exit 0
fi

# Add statusline config using jq (preferred) or node fallback
if command -v jq &>/dev/null; then
  jq --arg cmd "$STATUSLINE_CMD" '.statusLine = {"type": "command", "command": $cmd}' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
else
  # Node.js fallback
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));
    settings.statusLine = {
      type: 'command',
      command: '$STATUSLINE_CMD'
    };
    fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
  "
fi
