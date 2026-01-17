#!/bin/bash
# Record real ink components with pseudo-TTY
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

cd "$PROJECT_DIR"

# Create a simple test script
cat > /tmp/test-confirm.sh << 'TEST'
#!/bin/bash
cd /Users/burakemre/Code/ai-experiments/mcp-sidecar
echo ""
echo "Testing real confirm component..."
echo ""
# Auto-confirm after 2 seconds by sending 'y'
echo "y" | timeout 3 node packages/ink-runner/dist/index.js confirm --prompt "Deploy to production?" 2>&1 || true
echo ""
echo "Done!"
TEST
chmod +x /tmp/test-confirm.sh

# Use script command to provide PTY
echo "Testing with script command (provides PTY)..."
script -q /tmp/test-output.txt /tmp/test-confirm.sh

echo ""
echo "Output:"
cat /tmp/test-output.txt
