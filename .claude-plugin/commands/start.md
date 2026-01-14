---
allowed-tools: Bash
---

Start the Termos event stream for the current Zellij session (long-running).

```bash
termos up
```

Run this as a background/base process so it stays alive (do not use shell `&`).

Keep this process running in a separate pane/tab or background job to receive interaction results. `termos run <component>` will display interactive UIs in a floating pane.
