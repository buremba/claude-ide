#!/bin/bash
# Record real Claude + Termos in Zellij
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SESSION="termos-recording"

# Check if already in Zellij
if [ -n "$ZELLIJ" ]; then
    echo "Already in Zellij - run this outside Zellij"
    exit 1
fi

# Create demo project
DEMO_DIR="/tmp/deploy-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/termos.md" << 'TERMOS'
# Termos Configuration
Use termos for all confirmations and progress.
TERMOS

cat > "$DEMO_DIR/deploy.sh" << 'DEPLOY'
#!/bin/bash
echo "Deploying..."
sleep 1
echo "Done!"
DEPLOY
chmod +x "$DEMO_DIR/deploy.sh"

# Create the Zellij layout
cat > /tmp/demo-layout.kdl << 'LAYOUT'
layout {
    pane size=1 borderless=true {
        plugin location="zellij:tab-bar"
    }
    pane {
        name "claude"
    }
    pane size=2 borderless=true {
        plugin location="zellij:status-bar"
    }
}
LAYOUT

echo "Starting Zellij session for recording..."
echo "In the session:"
echo "1. Run: claude 'deploy the project, ask me to confirm first'"
echo "2. Press Ctrl+Q when done"
echo ""
echo "Recording will start in 3 seconds..."
sleep 3

# Start recording
asciinema rec \
    --overwrite \
    --cols 100 \
    --rows 35 \
    -f asciicast-v2 \
    -c "cd $DEMO_DIR && zellij --session $SESSION --layout /tmp/demo-layout.kdl" \
    "$SCRIPT_DIR/zellij-demo.cast"

echo ""
echo "✓ Recording saved"
