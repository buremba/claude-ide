#!/bin/bash
set -e

# Parse arguments
PROMPT=""
DEMO_MODE=false
RECORD_MODE=false
AUTO_MODE=false
AUTO_DURATION=40
OPEN_VIEWER=false
SERVE_DOCS=false
ATTACH_MODE=false
AGENT=""
SESSION_NAME="termos-demo"
while [[ $# -gt 0 ]]; do
  case $1 in
    -a|--agent)
      AGENT="$2"
      shift 2
      ;;
    -s|--session)
      SESSION_NAME="$2"
      shift 2
      ;;
    -p|--prompt)
      PROMPT="$2"
      shift 2
      ;;
    --demo)
      DEMO_MODE=true
      shift
      ;;
    --record)
      RECORD_MODE=true
      shift
      ;;
    --auto)
      AUTO_MODE=true
      shift
      ;;
    --duration)
      AUTO_DURATION="$2"
      shift 2
      ;;
    --open)
      OPEN_VIEWER=true
      shift
      ;;
    --serve)
      SERVE_DOCS=true
      shift
      ;;
    --attach)
      ATTACH_MODE=true
      shift
      ;;
    *)
      PROMPT="$1"
      shift
      ;;
  esac
done

if [ -z "$AGENT" ]; then
  echo "ERROR: --agent is required. Use --agent claude or --agent codex"
  exit 1
fi

if [ "$AGENT" != "claude" ] && [ "$AGENT" != "codex" ]; then
  echo "ERROR: --agent must be 'claude' or 'codex'"
  exit 1
fi

# Demo prompt that showcases all interactive components
DEMO_PROMPT_FILE="./demo/claude-demo.txt"
if [ -f "$DEMO_PROMPT_FILE" ]; then
  DEMO_PROMPT="$(cat "$DEMO_PROMPT_FILE")"
else
  DEMO_PROMPT="Run a comprehensive demo of all termos interactive components."
fi

if [ "$DEMO_MODE" = true ]; then
  PROMPT="$DEMO_PROMPT"
fi

# Load credentials from .env
if [ -f .env ]; then
  source .env
fi

# Check for required credentials (Claude only)
if [ "$AGENT" = "claude" ]; then
  if [ -z "$ANTHROPIC_AUTH_TOKEN" ] || [ -z "$ANTHROPIC_BASE_URL" ]; then
    echo "ERROR: Missing credentials. Create .env file with:"
    echo "  ANTHROPIC_AUTH_TOKEN=your-token"
    echo "  ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic"
    exit 1
  fi
fi

# Build the test image
echo "Building test image..."
docker build -f Dockerfile.test -t termos-test .

# Clean up any existing container
docker rm -f termos-test 2>/dev/null || true

# Start container with credentials as env vars
echo "Starting container..."
docker run -d \
  -e ANTHROPIC_AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN" \
  -e ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -v "$(pwd)":/workspace \
  -v /workspace/node_modules \
  -v /workspace/packages/ink-runner/node_modules \
  -v /workspace/packages/shared/node_modules \
  -w /workspace \
  --name termos-test \
  termos-test \
  sleep infinity

docker exec termos-test mkdir -p /workspace/docs/recordings
docker exec termos-test mkdir -p /home/test/.claude /home/test/.codex
docker exec termos-test bash -c 'mkdir -p /home/test/.config/zellij && zellij setup --dump-config > /home/test/.config/zellij/config.kdl && sed -i "s/welcome_screen true/welcome_screen false/" /home/test/.config/zellij/config.kdl && echo \"theme \\\"default\\\"\" >> /home/test/.config/zellij/config.kdl'
docker exec termos-test chown -R test:test /workspace /home/test >/dev/null 2>&1 || true

# Install node_modules for Linux
echo "Installing dependencies for Linux..."
docker exec termos-test bash -c 'cd /workspace && npm install --silent 2>&1' | tail -3

echo "Building Termos..."
docker exec termos-test bash -c 'cd /workspace && npm run build --silent 2>&1' | tail -3

# Link termos globally so `termos` command works
docker exec termos-test bash -c 'cd /workspace && npm link --silent 2>&1' | tail -1

if [ "$AGENT" = "claude" ]; then
  docker exec termos-test mkdir -p /home/test/.claude

  # Create settings.json to auto-approve termos commands
  docker exec termos-test bash -c 'cat > /home/test/.claude/settings.json << EOF
{
  "permissions": {
    "allow": [
      "Bash(termos *)",
      "Bash(which termos *)"
    ]
  }
}
EOF'
  docker exec termos-test chown -R test:test /home/test/.claude >/dev/null 2>&1 || true
fi

if [ "$AGENT" = "codex" ]; then
  echo "Installing Codex CLI..."
  docker exec termos-test bash -c 'npm install -g @openai/codex >/dev/null 2>&1'
  docker exec termos-test mkdir -p /home/test/.codex/skills
  docker exec termos-test bash -c 'ln -sf /workspace/skills/termos /home/test/.codex/skills/termos'
  docker exec termos-test chown -R test:test /home/test/.codex >/dev/null 2>&1 || true
fi

if [ "$AUTO_MODE" = true ]; then
  RECORD_MODE=true
  SERVE_DOCS=true
  OPEN_VIEWER=true
  CAST_PATH="/workspace/docs/recordings/termos.cast"
  docker exec termos-test bash -c "rm -f $CAST_PATH /tmp/asciinema.log"
  docker exec -u test termos-test bash -c "nohup script -q -c \"stty cols 120 rows 35; TERM=xterm-256color COLUMNS=120 LINES=35 asciinema rec $CAST_PATH --command \\\"env HOME=/home/test ZELLIJ_CONFIG_FILE=/home/test/.config/zellij/config.kdl zellij --config /home/test/.config/zellij/config.kdl --new-session-with-layout default --session $SESSION_NAME\\\"\" /dev/null >/tmp/asciinema.log 2>&1 &"

  echo "Waiting for Zellij session '$SESSION_NAME' to start..."
  for i in {1..40}; do
    if docker exec -u test termos-test bash -c "ls -d /tmp/zellij-*/0.*/* 2>/dev/null | grep -q \"/$SESSION_NAME$\""; then
      break
    fi
    sleep 0.5
  done
  if ! docker exec -u test termos-test bash -c "ls -d /tmp/zellij-*/0.*/* 2>/dev/null | grep -q \"/$SESSION_NAME$\""; then
    echo "ERROR: Zellij session '$SESSION_NAME' did not start."
    exit 1
  fi

  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
  # Dismiss any Zellij welcome screen (ESC closes it).
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' >/dev/null 2>&1 || true

  echo "Dismissing Zellij onboarding..."
  for i in {1..30}; do
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action dump-screen /tmp/zellij-screen.txt >/dev/null 2>&1 || true
    if docker exec -u test termos-test bash -c "grep -aEq \"Welcome to Zellij|Welcome\" /tmp/zellij-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -q \"Choose the text style\" /tmp/zellij-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars '1' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -q \"Release Notes\" /tmp/zellij-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' || true
      sleep 0.5
      continue
    fi
    break
  done

  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action new-tab --name demo --cwd /workspace
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action go-to-tab-name demo
  sleep 0.5
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars 'echo auto-ready'
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\n'

  # Leave only the demo tab; Claude will start termos up when ready.

  if [ "$AGENT" = "claude" ]; then
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action write-chars 'env HOME=/home/test claude --model sonnet --plugin-dir /workspace/.claude-plugin --permission-mode dontAsk'
  else
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action write-chars 'codex'
  fi
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\n'

  echo "Waiting for Claude to be ready..."
  ready=0
  for i in {1..120}; do
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action go-to-tab-name demo >/dev/null 2>&1 || true
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action dump-screen /tmp/termos-claude-screen.txt >/dev/null 2>&1 || true
    # Dismiss Claude Code first-run screens if present.
    if docker exec -u test termos-test bash -c "grep -aEq 'Security notes|Press .*Enter.*to continue' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.2
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Ready to code here|permission to work with your files|Yes, continue|Enter to confirm' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars '1' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Release Notes' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Choose the text style|Let.s get started|/theme|Welcome to Claude' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars '1' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Claude Code|SessionStart|^> |^› |^❯ |Recent activity|Welcome back|/model to try|Anthropic marketplace installed|don.t ask on' /tmp/termos-claude-screen.txt"; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [ "$ready" -ne 1 ]; then
    echo "WARNING: Claude prompt not detected. Dumping screen to ./docs/recordings/claude-screen.txt"
    docker exec -u test termos-test cat /tmp/termos-claude-screen.txt > ./docs/recordings/claude-screen.txt || true
  fi

  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
    bash -lc 'python3 - <<'"'"'PY'"'"'
import pathlib
import re
import subprocess

text = pathlib.Path("/workspace/demo/claude-demo.txt").read_text()
text = re.sub(r"\\s+", " ", text).strip()
if text:
    subprocess.run(["zellij", "action", "write-chars", text], check=False)
    subprocess.run(["zellij", "action", "write-chars", "\\n"], check=False)
PY'

  echo "Auto demo running for ${AUTO_DURATION}s..."
  sleep "$AUTO_DURATION"
  docker exec -u test termos-test zellij kill-session "$SESSION_NAME" >/dev/null 2>&1 || true
  sleep 2

  if command -v agg >/dev/null 2>&1; then
    agg docs/recordings/termos.cast docs/recordings/termos.gif || true
  fi
fi

if [ "$SERVE_DOCS" = true ]; then
  if command -v python3 >/dev/null 2>&1; then
    if command -v lsof >/dev/null 2>&1; then
      if ! lsof -i tcp:8000 >/dev/null 2>&1; then
        (cd docs && nohup python3 -m http.server 8000 >/tmp/termos-http.log 2>&1 & echo $! > /tmp/termos-http.pid) || true
      fi
    else
      (cd docs && nohup python3 -m http.server 8000 >/tmp/termos-http.log 2>&1 & echo $! > /tmp/termos-http.pid) || true
    fi
  fi
fi

echo ""
echo "=========================================="
echo "Docker test ready!"
echo ""
if [ "$AUTO_MODE" = false ]; then
  echo "Attach with:"
  echo "  docker exec -it -u test termos-test zellij attach --create test"
fi
if [ "$RECORD_MODE" = true ] && [ "$AUTO_MODE" = false ]; then
  echo ""
  echo "Record a cast (saved to /workspace/docs/recordings/termos.cast):"
  echo "  docker exec -it -u test termos-test asciinema rec /workspace/docs/recordings/termos.cast --command \"zellij attach --create test\""
  echo "  # exit zellij to stop recording; cast file will be on host at ./docs/recordings/termos.cast"
  echo "  # view it via ./docs/index.html (GitHub Pages or local file server)"
fi
if [ "$AUTO_MODE" = true ]; then
  echo ""
  echo "Auto demo complete."
  echo "Cast: ./docs/recordings/termos.cast"
  if [ -f ./docs/recordings/termos.gif ]; then
    echo "GIF:  ./docs/recordings/termos.gif"
  fi
  echo "Viewer: http://localhost:8000"
fi

if [ "$ATTACH_MODE" = true ] && [ "$AUTO_MODE" = false ]; then
  echo "Bootstrapping Zellij session '$SESSION_NAME'..."

  if ! docker exec -u test termos-test bash -c "ls -d /tmp/zellij-*/0.*/* 2>/dev/null | grep -q \"/$SESSION_NAME$\""; then
    docker exec -u test termos-test bash -c "nohup script -q -c \"TERM=xterm-256color ZELLIJ_CONFIG_FILE=/home/test/.config/zellij/config.kdl zellij --config /home/test/.config/zellij/config.kdl --new-session-with-layout default --session $SESSION_NAME\" /dev/null >/tmp/zellij-bootstrap.log 2>&1 &"
  fi

  echo "Waiting for Zellij session '$SESSION_NAME' to start..."
  for i in {1..40}; do
    if docker exec -u test termos-test bash -c "ls -d /tmp/zellij-*/0.*/* 2>/dev/null | grep -q \"/$SESSION_NAME$\""; then
      break
    fi
    sleep 0.5
  done

  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
  # Dismiss any Zellij welcome screen (ESC closes it).
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' >/dev/null 2>&1 || true

  echo "Dismissing Zellij onboarding..."
  for i in {1..30}; do
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action dump-screen /tmp/zellij-screen.txt >/dev/null 2>&1 || true
    if docker exec -u test termos-test bash -c "grep -aEq \"Welcome to Zellij|Welcome\" /tmp/zellij-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -q \"Choose the text style\" /tmp/zellij-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars '1' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -q \"Release Notes\" /tmp/zellij-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' || true
      sleep 0.5
      continue
    fi
    break
  done

  tabs="$(docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action list-tabs 2>/dev/null || true)"
  tabs="$(echo "$tabs" | sed $'s/\\x1b\\[[0-9;]*m//g')"
  if ! echo "$tabs" | grep -q " demo"; then
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action new-tab --name demo --cwd /workspace >/dev/null 2>&1 || true
  fi
  # Leave only the demo tab; Claude will start termos up when ready.

  if [ "$AGENT" = "claude" ]; then
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action write-chars 'env HOME=/home/test claude --model sonnet --plugin-dir /workspace/.claude-plugin --permission-mode dontAsk' || true
  else
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action write-chars 'codex' || true
  fi
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\n' || true

  # Keep nudging past first-run screens for a short window (helps after attach).
  docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" bash -lc 'nohup bash -lc "
export ZELLIJ_SESSION_NAME='"$SESSION_NAME"'
for i in {1..120}; do
  zellij action switch-mode locked >/dev/null 2>&1 || true
  zellij action go-to-tab-name demo >/dev/null 2>&1 || true
  zellij action dump-screen /tmp/termos-claude-screen.txt >/dev/null 2>&1 || true
  grep -aEq \"Security notes|Press .*Enter.*to continue\" /tmp/termos-claude-screen.txt && {
    zellij action write-chars $'\\r' || true
    zellij action write-chars $'\\r' || true
  }
  grep -aEq \"Ready to code here|permission to work with your files|Yes, continue|Enter to confirm\" /tmp/termos-claude-screen.txt && {
    zellij action write-chars \"1\" || true
    zellij action write-chars $'\\r' || true
  }
  grep -aEq \"Release Notes\" /tmp/termos-claude-screen.txt && \
    zellij action write-chars $'\\e' || true
  grep -aEq \"Choose the text style|Let.s get started|/theme|Welcome to Claude\" /tmp/termos-claude-screen.txt && {
    zellij action write-chars \"1\" || true
    zellij action write-chars $'\\r' || true
  }
  sleep 0.5
done
" >/tmp/termos-nudge.log 2>&1 &' || true

  echo "Waiting for Claude to be ready..."
  ready=0
  for i in {1..120}; do
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action go-to-tab-name demo >/dev/null 2>&1 || true
    docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" \
      zellij action dump-screen /tmp/termos-claude-screen.txt >/dev/null 2>&1 || true
    # Dismiss Claude Code first-run screens if present.
    if docker exec -u test termos-test bash -c "grep -aEq 'Security notes|Press .*Enter.*to continue' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.2
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Ready to code here|permission to work with your files|Yes, continue|Enter to confirm' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars '1' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Release Notes' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\e' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Choose the text style|Let.s get started|/theme|Welcome to Claude' /tmp/termos-claude-screen.txt"; then
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action switch-mode locked >/dev/null 2>&1 || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars '1' || true
      docker exec -u test termos-test env ZELLIJ_SESSION_NAME="$SESSION_NAME" zellij action write-chars $'\r' || true
      sleep 0.5
      continue
    fi
    if docker exec -u test termos-test bash -c "grep -aEq 'Claude Code|SessionStart|^> |^› |^❯ |Recent activity|Welcome back|/model to try|Anthropic marketplace installed|don.t ask on' /tmp/termos-claude-screen.txt"; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [ "$ready" -ne 1 ]; then
    echo "WARNING: Claude prompt not detected. Dumping screen to ./docs/recordings/claude-screen.txt"
    docker exec -u test termos-test cat /tmp/termos-claude-screen.txt > ./docs/recordings/claude-screen.txt || true
  fi
fi

if [ "$SERVE_DOCS" = true ]; then
  echo ""
  echo "Docs server: http://localhost:8000"
  if [ "$OPEN_VIEWER" = true ]; then
    if command -v open >/dev/null 2>&1; then
      open http://localhost:8000 || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open http://localhost:8000 || true
    fi
  fi
fi

if [ "$ATTACH_MODE" = true ]; then
  echo ""
  echo "Attaching to Zellij session '$SESSION_NAME'..."
  docker exec -it -u test termos-test zellij attach --create "$SESSION_NAME"
fi
if [ "$AUTO_MODE" = false ]; then
  echo ""
  echo "Inside Zellij, run:"
  if [ "$AGENT" = "claude" ]; then
    echo "  env HOME=/home/test claude --model sonnet --plugin-dir /workspace/.claude-plugin"
  else
    echo "  codex"
    echo "  # make sure OPENAI_API_KEY is set or complete login"
  fi
  echo "  # Claude will start 'termos up' when ready"
  echo ""
  echo "Then run your prompt or demo:"
  if [ -n "$PROMPT" ]; then
    echo "  $PROMPT"
  else
    echo "  ./demo/run-demo.sh    # (if you want the component demo)"
  fi
fi
echo ""
echo "Stop with:"
echo "  docker rm -f termos-test"
echo ""
echo "Usage:"
echo "  ./docker-test.sh --agent claude                    # Start without prompt"
echo "  ./docker-test.sh --agent codex                     # Start without prompt"
echo "  ./docker-test.sh --agent claude \"hello world\"      # Start with prompt"
echo "  ./docker-test.sh --agent codex -p \"hello world\"    # Start with prompt (explicit)"
echo "  ./docker-test.sh --agent claude --demo             # Run interactive components demo"
echo "  ./docker-test.sh --agent claude --auto             # Run demo + record + stop"
echo "  ./docker-test.sh --agent claude --auto --duration 60  # Longer auto run"
echo "  ./docker-test.sh --agent claude --auto --open      # Auto run + open viewer"
echo "  ./docker-test.sh --agent claude --serve            # Serve docs only"
echo "  ./docker-test.sh --agent claude --attach           # Attach to Zellij"
echo "  ./docker-test.sh --agent codex --record            # Record a cast for docs/debugging"
echo "=========================================="
