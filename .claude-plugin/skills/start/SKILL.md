---
name: start
description: "Start dev environment, manage services, interactive forms."
allowed-tools: Bash
forbidden-tools: AskUserQuestion
---

# Termos

## Prerequisites

Check if installed:
```bash
which termos || echo "NOT_INSTALLED"
```

If NOT_INSTALLED, tell the user:
> Install with: `npm install -g @termosdev/cli`

## Start Session (REQUIRED FIRST)

```bash
termos up --stream  # run_in_background: true
```

This streams events including interaction results. If session exists:
```bash
termos connect --stream  # run_in_background: true
```

## Display Components

All components are async by default - returns ID immediately.

### Plan File → Markdown (MUST USE when plan exists)
```bash
termos run markdown --file "/path/to/plan.md" --title "Implementation Plan"
```
When a plan file exists, display it so user can follow along.

### Todo List → Checklist (MUST USE for progress)
```bash
termos run checklist "Task 1,Task 2,Task 3" --title "Progress"
```
Always show current task progress so user can track.

### Code Review
```bash
termos run code --file "src/file.ts" --highlight "10-20"
```

## Interactive Components

### Confirmation
```bash
termos run confirm "Proceed with changes?"
# Returns: {"id":"interaction-xxx","status":"started"}
```

### Multi-question Form
```bash
# Write questions to file first (avoids shell escaping issues)
cat > /tmp/questions.json << 'EOF'
{"questions":[{"question":"Your question?","header":"answer"}]}
EOF
termos run ask --file /tmp/questions.json
```

Run `termos run --help` for full schemas.

## Reading Results

Results appear in the `termos up --stream` background task output:
```json
{"ts":123,"type":"result","id":"interaction-xxx","action":"accept","confirmed":true}
```

Check the stream task output to read user responses.

## Services
```bash
termos ls                      # List services
termos start|stop|restart <n>  # Manage services
```
