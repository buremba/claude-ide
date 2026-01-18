# Termos

Keep Claude Code interactive while it works.

[![Termos Demo](https://termos-dev.github.io/termos/recordings/poster.jpg)](https://termos-dev.github.io/termos/)

## The Problem

Claude Code's built-in `AskUserQuestion` tool blocks execution until you respond. One question at a time. If Claude needs approval mid-task, everything stops.

## The Solution

Termos is a CLI + Claude Code skill that spawns **floating terminal panes** for interactions. Claude keeps working while you review and respond in your own time.

```bash
# Claude runs this (non-blocking)
termos run confirm --prompt "Deploy to production?"

# Returns immediately with an ID
# Claude continues working, checks result later
termos wait <id>
```

- **Non-blocking** - Claude asks without stopping
- **Parallel interactions** - Multiple panes, multiple questions
- **Rich components** - Diffs, tables, checklists, not just text prompts

## Install

```bash
claude plugins add-marketplace github:termos-dev/termos
claude plugins install termos
```

Then run `/termos:init` in Claude to configure.

## Components

`confirm` `ask` `checklist` `select` `diff` `code` `table` `json` `markdown` `progress` `chart` `gauge` `tree` `mermaid` `plan-viewer`

Drop custom `.tsx` files in `.termos/interactive/` for your own Ink components.

## Requirements

- **macOS**: Native support (Ghostty or Terminal.app)
- **Linux/Windows**: Requires [Zellij](https://zellij.dev/)

## License

MIT
