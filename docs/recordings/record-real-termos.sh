#!/bin/bash
# Record REAL termos components (not simulation)
set -e

clear
sleep 0.3

printf "\033[0;90m# Real termos components - exactly what Claude sees\033[0m\n"
printf "\n"
sleep 0.5

printf "$ termos run confirm --prompt \"Deploy to production?\"\n"
sleep 0.3

# Run the REAL confirm component
termos run confirm --prompt "Deploy to production?"

sleep 0.5
printf "\n"
printf "$ termos run progress --title \"Deployment\" --steps \"Build,Test,Push,Deploy\"\n"
sleep 0.3

# Run the REAL progress component 
termos run progress --title "Deployment" --steps "Build,Test,Push,Deploy" &
PROGRESS_PID=$!

sleep 2
# Kill it after a moment (since it waits for state file updates)
kill $PROGRESS_PID 2>/dev/null || true

printf "\n"
printf "\033[32m✓ These are the real components!\033[0m\n"
sleep 2

