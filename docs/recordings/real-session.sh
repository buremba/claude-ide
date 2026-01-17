#!/bin/bash
cd /Users/burakemre/Code/ai-experiments/mcp-sidecar

clear
sleep 0.3

printf "\033[0;90m~/my-project $\033[0m termos run confirm --prompt \"Deploy?\"\n"
sleep 0.5

# Run REAL confirm component - user will interact
node packages/ink-runner/dist/index.js confirm --prompt "Deploy to production?"

printf "\n"
printf "\033[0;90m~/my-project $\033[0m termos run progress --steps \"Build,Test,Deploy\"\n"
sleep 0.5

# Run REAL progress component
node packages/ink-runner/dist/index.js progress --title "Deployment" --steps "Build,Test,Push,Deploy" --step 1 &
PID=$!

sleep 1.5
# Simulate progress by creating state file
mkdir -p /tmp/termos-state
echo '{"step": 2}' > /tmp/termos-state/progress.json
sleep 1
echo '{"step": 3}' > /tmp/termos-state/progress.json  
sleep 1
echo '{"step": 4, "done": true}' > /tmp/termos-state/progress.json
sleep 0.5

wait $PID 2>/dev/null || true

printf "\n"
printf "\033[32m✓ Deployed to https://prod.example.com\033[0m\n"
sleep 2
