#!/bin/bash
# Record real Ink components directly
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

cd "$SCRIPT_DIR"

cat > /tmp/ink-demo.sh << 'DEMO'
#!/bin/bash
clear
sleep 0.3

printf "\033[0;90m# Real termos components\033[0m\n\n"
sleep 0.5

printf "$ termos run confirm --prompt \"Deploy?\"\n"
sleep 0.3

# Use the ink-runner directly (bypassing pane host)
cd /Users/burakemre/Code/ai-experiments/mcp-sidecar
node packages/ink-runner/dist/index.js confirm --prompt "Deploy to production?" --timeout 3000 2>/dev/null || true

sleep 0.5
printf "\n"
printf "$ termos run progress --steps \"Build,Test,Deploy\"\n"  
sleep 0.3

# Show progress (will need to kill after a moment)
timeout 3 node packages/ink-runner/dist/index.js progress --title "Deployment" --steps "Build,Test,Deploy" 2>/dev/null || true

printf "\n\033[32m✓ Real ink components!\033[0m\n"
sleep 2
DEMO
chmod +x /tmp/ink-demo.sh

echo "Recording real ink components..."
asciinema rec \
    --overwrite \
    --cols 80 \
    --rows 30 \
    -f asciicast-v2 \
    -c "/tmp/ink-demo.sh" \
    "$SCRIPT_DIR/real-ink-demo.cast"

rm -f /tmp/ink-demo.sh
echo "✓ Done"
