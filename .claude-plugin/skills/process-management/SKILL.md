---
name: process-management
description: Monitor and manage background dev processes. Use when user asks about process status, logs, ports, preview URLs, or needs to restart services.
allowed-tools: mcp__sidecar__*
---

# Sidecar MCP Skill

The sidecar MCP server provides terminal management, interactive UI components, and background process monitoring.

## Terminal & UI Tools (Always Available)

### `create_terminal`
Create a tmux terminal pane running any command.
```
create_terminal(name: "dev-server", command: "npm run dev")
```

### `remove_terminal`
Remove a terminal pane by name.

### `show_interaction`
Show interactive Ink components for user input, TUI dashboards, or any terminal UI. Two modes:

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

**File mode** - Run custom Ink components (forms, dashboards, TUIs, visualizations):
```
show_interaction(ink_file: "dashboard.tsx", title: "System Monitor")
show_interaction(ink_file: "file-picker.tsx")
show_interaction(ink_file: "progress-tracker.tsx")
```

File resolution order:
1. Absolute paths used as-is
2. Project `.sidecar/interactive/` directory
3. Global `~/.sidecar/interactive/` directory

Use cases for file mode:
- Interactive dashboards (htop-style monitors, stats displays)
- File browsers and pickers
- Progress trackers and build monitors
- Custom configuration wizards
- Any React/Ink-based terminal UI

### `get_interaction_result`
Get result from a non-blocking interaction.

### `cancel_interaction`
Cancel a pending interaction.

### `set_sidecar_status`
Update the terminal window title/status indicator.

## Process Tools (Requires `sidecar.yaml`)

When a `sidecar.yaml` config exists, these additional tools are available:

- `list_processes` - Get overview of all processes (name, status, port, health)
- `get_status` - Get detailed status of a single process
- `get_logs` - Get stdout/stderr logs for a process
- `get_url` - Get the preview URL for a process
- `restart_process` - Restart a crashed or stuck process

## Writing Custom Ink Components

Create `.tsx` files in `~/.sidecar/interactive/` or `.sidecar/interactive/`:

```tsx
import { Box, Text, useInput, useApp } from 'ink';

function MyComponent() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      onComplete({ selected: 'value' });  // Global function to return data
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Press Enter to continue</Text>
    </Box>
  );
}

export default MyComponent;
```

Available imports: `ink`, `ink-text-input`, `ink-select-input`, `react`

## When to Use

- **create_terminal**: Running dev servers, build commands, any shell command
- **show_interaction**: Collecting user input, showing dashboards/TUIs, confirmations, selections
- **Process tools**: Monitoring sidecar-managed background services

## Best Practices

1. Use `show_interaction` for structured user input instead of asking in chat
2. Use `show_interaction` with custom components for rich terminal UIs
3. Use `create_terminal` for long-running processes you want visible
4. Check process status before suggesting restarts
5. When a user reports issues, check logs first to diagnose
