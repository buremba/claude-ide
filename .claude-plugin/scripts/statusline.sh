#!/bin/bash
# mcp-sidecar statusline script
# Shows tmux session name and process status for easy attach
#
# Only shows output if sidecar.yaml exists in the current directory

# Read stdin (Claude Code passes session context as JSON)
INPUT=$(cat)

# Get workspace directory from JSON input, fallback to pwd
if command -v jq &>/dev/null; then
  WORKSPACE_DIR=$(echo "$INPUT" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null)
fi
if [ -z "$WORKSPACE_DIR" ]; then
  WORKSPACE_DIR=$(pwd)
fi

# Check if sidecar.yaml exists in workspace directory
if [ ! -f "$WORKSPACE_DIR/sidecar.yaml" ] && [ ! -f "$WORKSPACE_DIR/sidecar.yml" ]; then
  echo ""
  exit 0
fi

# Get project name for session lookup
PROJECT_NAME=$(basename "$WORKSPACE_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
SESSION_NAME="sidecar-${PROJECT_NAME}"

# Check if tmux session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  # Try with suffix
  SESSION_NAME=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^sidecar-${PROJECT_NAME}" | head -1)
  if [ -z "$SESSION_NAME" ]; then
    echo ""
    exit 0
  fi
fi

# ANSI colors
CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
GRAY='\033[90m'
RESET='\033[0m'

# Get pane info from tmux
PANE_INFO=$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_title}:#{pane_dead}' 2>/dev/null)

# Count panes and their status
TOTAL=0
RUNNING=0
DEAD=0

while IFS= read -r line; do
  if [ -n "$line" ]; then
    TOTAL=$((TOTAL + 1))
    if [[ "$line" == *":1" ]]; then
      DEAD=$((DEAD + 1))
    else
      RUNNING=$((RUNNING + 1))
    fi
  fi
done <<< "$PANE_INFO"

# Build status indicator
if [ "$DEAD" -gt 0 ]; then
  STATUS="${RED}${DEAD}✗${RESET}"
elif [ "$RUNNING" -gt 0 ]; then
  STATUS="${GREEN}${RUNNING}✓${RESET}"
else
  STATUS="${GRAY}○${RESET}"
fi

# Output: [session-name] status
SHORT_SESSION=$(echo "$SESSION_NAME" | sed 's/^sidecar-//')
echo -e "${CYAN}[${SHORT_SESSION}]${RESET} ${STATUS}"
