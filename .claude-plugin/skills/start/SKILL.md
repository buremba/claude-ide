---
name: start
description: "Start dev environment, create terminals/panes, show interactive forms, manage processes. Triggers: start dev, run server, create terminal, open pane, ask question, show form, interactive input, process status, dashboard."
allowed-tools: mcp__plugin_ide_ide__*
---

# IDE Start Skill

Start and manage your development environment with terminals, processes, interactive forms, and dashboards.

## Starting the Environment

When the user wants to start their dev environment, use `list_processes` to initialize and show all processes from `mide.yaml`. This will:
1. Create the tmux session
2. Start all auto-start processes
3. Open the terminal window (if configured)

```
list_processes()  // Initializes environment and shows status
```

## Terminal & Pane Tools

### `create_pane`
Create a terminal pane running any command. Use for dev servers, build commands, or any shell process.
```
create_pane(name: "dev-server", command: "npm run dev")
create_pane(name: "tests", command: "npm test --watch", group: "tools")
```

### `remove_pane`
Remove a terminal pane by name.

## Interactive Forms & Dashboards

### `show_interaction`
Show interactive Ink components for user input, TUI dashboards, or any terminal UI.

**Schema mode** - Define forms inline:
```
show_interaction(
  schema: {
    questions: [
      { question: "What's your name?", header: "Name", inputType: "text" },
      { question: "Select role", header: "Role", options: [
        { label: "Developer", description: "Write code" },
        { label: "Designer", description: "Create designs" }
      ]}
    ]
  },
  title: "User Setup"
)
```

**File mode** - Run custom Ink components:
```
show_interaction(ink_file: "dashboard.tsx", title: "System Monitor")
show_interaction(ink_file: "file-picker.tsx")
```

File resolution: Project `.mide/interactive/` → Global `~/.mide/interactive/`

### `get_interaction_result`
Get result from a non-blocking interaction.

### `cancel_interaction`
Cancel a pending interaction.

### `set_status`
Update the terminal window title/status indicator.

## Process Management (requires `mide.yaml`)

- `list_processes` - Overview of all processes (also initializes environment)
- `get_status` - Detailed status of a single process
- `get_logs` - Get stdout/stderr logs
- `get_url` - Get the preview URL for a process
- `start_process` - Start a stopped process
- `stop_process` - Stop a running process
- `restart_process` - Restart a process

## When to Use

| User Intent | Tool |
|-------------|------|
| "start dev environment" | `list_processes` |
| "run a command in terminal" | `create_pane` |
| "ask user a question" | `show_interaction` with schema |
| "show a dashboard" | `show_interaction` with ink_file |
| "check if server is running" | `get_status` |
| "show me the logs" | `get_logs` |
| "restart the API" | `restart_process` |

## Best Practices

1. Use `list_processes` first to initialize the environment
2. Use `show_interaction` for structured user input instead of asking in chat
3. Use `create_pane` for long-running processes you want visible
4. Check process status before suggesting restarts
5. When user reports issues, check logs first to diagnose
