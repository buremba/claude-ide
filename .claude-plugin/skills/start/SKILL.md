---
name: start
description: "Start dev environment, create terminals/panes, show Ink components and interactive forms, manage processes. Triggers: start dev, run server, create terminal, open pane, ink component, ask question, show form, interactive input, process status, dashboard, TUI."
allowed-tools: mcp__plugin_ide_ide__*
---

# IDE Start Skill

Start and manage your development environment with terminals, processes, interactive Ink components, and dashboards.

## Tools (8 total)

### Process Management (require mide.yaml)

| Tool | Description |
|------|-------------|
| `list_processes` | List all processes with status, port, URL, health |
| `manage_process(name, op)` | Start, stop, or restart a process |
| `get_logs(name, tail?)` | Get process logs |

### Pane Management

| Tool | Description |
|------|-------------|
| `create_pane(name, command)` | Create a terminal pane |
| `create_interaction(schema?, ink_file?)` | Show interactive Ink form/component |
| `remove_pane(name)` | Remove a pane |
| `capture_pane(name, lines?)` | Capture terminal output |

### Status

| Tool | Description |
|------|-------------|
| `set_status(status, message?)` | Update window title/status |

## Starting the Environment

```
list_processes()  // Initializes tmux session, shows all processes
```

## Managing Processes

```
manage_process(name: "api", op: "start")
manage_process(name: "api", op: "stop")
manage_process(name: "api", op: "restart")
```

## Creating Terminal Panes

```
create_pane(name: "dev-server", command: "npm run dev")
create_pane(name: "tests", command: "npm test --watch")
```

## Interactive Ink Components

**Schema mode** - Define forms inline:
```
create_interaction(
  schema: {
    questions: [
      { question: "What's your name?", header: "Name", inputType: "text" },
      { question: "Select role", header: "Role", options: [
        { label: "Developer" },
        { label: "Designer" }
      ]}
    ]
  },
  title: "User Setup"
)
```

**File mode** - Run custom Ink components:
```
create_interaction(ink_file: "color-picker.tsx", title: "Pick a Color")
```

File resolution: `.mide/interactive/` → `~/.mide/interactive/`

## Writing Ink Components

Create `.tsx` files in `.mide/interactive/`:

```tsx
import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;

function MyComponent() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      onComplete({ value: "done" });
      exit();
    }
  });

  return <Text>Press Enter to confirm</Text>;
}

export default MyComponent;
```

**Available imports:** `ink`, `ink-text-input`, `ink-select-input`, `react`

## Capturing Terminal Output

```
capture_pane(name: "dev-server", lines: 50)
// Returns last 50 lines of terminal output
```

## When to Use

| User Intent | Tool |
|-------------|------|
| "start dev environment" | `list_processes` |
| "run a command" | `create_pane` |
| "ask user a question" | `create_interaction` with schema |
| "show a picker" | `create_interaction` with ink_file |
| "what's in the terminal" | `capture_pane` |
| "restart the API" | `manage_process(op: "restart")` |
| "show me the logs" | `get_logs` |
