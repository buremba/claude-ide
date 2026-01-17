#!/bin/bash
# Record Claude Code + Termos in tmux split view
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SESSION="termos-demo"

# Kill existing session
tmux kill-session -t $SESSION 2>/dev/null || true

# Create new session with split panes
tmux new-session -d -s $SESSION -x 120 -y 30

# Create a vertical split - left for "claude", right for "termos popup"
tmux split-window -h -t $SESSION

# Left pane (0): simulates claude CLI
tmux send-keys -t $SESSION:0.0 'clear && echo "~/project $ claude \"deploy this\"" && sleep 1 && echo "" && echo "╭──────────────────────────────────────────╮" && echo "│  Claude Code                             │" && echo "╰──────────────────────────────────────────╯" && echo "" && sleep 0.5 && echo "⠋ Analyzing project..." && sleep 0.3 && echo "✓ Found deployment config" && sleep 0.3 && echo "✓ Build successful" && echo "" && sleep 0.5 && echo "I need to confirm deployment with you..." && sleep 1 && echo "" && echo "Waiting for confirmation..." && sleep 3 && echo "" && echo "✓ User confirmed!" && echo "" && echo "⠋ Deploying..." && sleep 3 && echo "" && echo "✓ Deployed to https://prod.example.com"' Enter

# Right pane (1): shows real termos confirm
sleep 3
tmux send-keys -t $SESSION:0.1 'sleep 2 && termos run confirm --prompt "Deploy to production?"' Enter

# Attach and record
echo "Starting recording..."
asciinema rec \
    --overwrite \
    --cols 120 \
    --rows 30 \
    -f asciicast-v2 \
    -c "tmux attach -t $SESSION" \
    "$SCRIPT_DIR/real-demo.cast"

# Cleanup
tmux kill-session -t $SESSION 2>/dev/null || true

