#!/bin/bash
# Termos Interactive Components Demo
# Run this inside the Docker container to showcase all features

set -e
cd /home/test

DEMO_DIR=/workspace/demo

if [ -z "$ZELLIJ_SESSION_NAME" ]; then
  echo "This demo must be run inside a Zellij session."
  echo "Example: zellij attach --create termos-demo"
  exit 1
fi

termos up >/tmp/termos-events.log 2>&1 &

PANE_FLAGS="--width 80 --height 60 --x 10 --y 20"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           TERMOS INTERACTIVE COMPONENTS DEMO                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Tip: Keep `termos up` running in a separate pane if you're running this manually."
echo ""
sleep 1

# 1. Confirm Dialog
echo "━━━ 1. CONFIRM DIALOG ━━━"
sleep 1
termos run $PANE_FLAGS confirm --prompt "Would you like to proceed with the demo?" --yes "Let's Go!" --no "Maybe Later"
echo ""
sleep 1

# 2. Ask (Multi-question form)
echo "━━━ 2. MULTI-QUESTION FORM ━━━"
sleep 1
termos run $PANE_FLAGS ask --questions '[{"question":"Project name?","options":["Apollo","Zephyr","Atlas"]},{"question":"Primary language?","options":["TypeScript","Python","Go","Rust"]}]' --title "Project Setup"
echo ""
sleep 1

# 3. Checklist
echo "━━━ 3. INTERACTIVE CHECKLIST ━━━"
sleep 1
termos run $PANE_FLAGS checklist --items "Run tests,Build project,Deploy to staging,Notify team" --title "Deployment Checklist" --checked "0"
echo ""
sleep 1

# 4. Progress Indicator
echo "━━━ 4. PROGRESS INDICATOR ━━━"
sleep 1
termos run $PANE_FLAGS progress --steps "Initialize,Download dependencies,Compile,Bundle,Deploy" --title "Build Progress"
echo ""
sleep 1

# 5. Table View
echo "━━━ 5. TABLE VIEW ━━━"
sleep 1
termos run $PANE_FLAGS table --file $DEMO_DIR/data.json
echo ""
sleep 1

# 6. Code Viewer
echo "━━━ 6. CODE VIEWER ━━━"
sleep 1
termos run $PANE_FLAGS code --file $DEMO_DIR/sample-code.ts --highlight "12-18" --line 12
echo ""
sleep 1

# 7. Markdown Viewer
echo "━━━ 7. MARKDOWN VIEWER ━━━"
sleep 1
termos run $PANE_FLAGS markdown --file $DEMO_DIR/plan.md --title "Implementation Plan"
echo ""
sleep 1

# 8. Mermaid Diagram
echo "━━━ 8. MERMAID DIAGRAM ━━━"
sleep 1
termos run $PANE_FLAGS mermaid --file $DEMO_DIR/diagram.mmd
echo ""
sleep 1

# 9. Diff View (git diff of an existing file)
echo "━━━ 9. DIFF VIEW ━━━"
sleep 1
termos run $PANE_FLAGS diff --file /workspace/README.md
echo ""

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    DEMO COMPLETE!                               ║"
echo "╚════════════════════════════════════════════════════════════════╝"
