#!/bin/bash
# =====================================================
# REAL TERMOS RECORDING
# Run this manually in your terminal (not from Claude)
# =====================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

cd "$PROJECT_DIR"

echo "╭─────────────────────────────────────────────────────────────╮"
echo "│  Termos Real Recording                                      │"
echo "╰─────────────────────────────────────────────────────────────╯"
echo ""
echo "This will record REAL termos components."
echo "You'll interact with actual confirm/progress components."
echo ""
echo "Press Enter to start recording..."
read

# Start recording
asciinema rec \
    --overwrite \
    --cols 80 \
    --rows 30 \
    -c "bash $SCRIPT_DIR/real-session.sh" \
    "$SCRIPT_DIR/real-termos.cast"

echo ""
echo "✓ Recording saved to: docs/recordings/real-termos.cast"
