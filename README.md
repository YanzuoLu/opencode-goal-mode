# opencode-goal-mode

Persistent goal mode for opencode.

## MVP Behavior

- `/goal <objective>` creates an active persisted goal.
- Real user messages after `/goal` are persisted as supplemental instructions.
- Esc interrupt does not pause or drop the goal.
- Auto continuation runs only after opencode reports the session idle.
- A continuation turn with no tool calls suppresses further automatic continuation.
- The model must call `goal({ "op": "complete" })` to complete the goal.
- Token and time budgets are not implemented.

## Local Smoke Install

```bash
bun run scripts/pack-smoke.ts
OPENCODE_CONFIG=/tmp/opencode-goal-smoke/opencode.json opencode
```

opencode reads config at startup. Restart opencode after changing the plugin path or options.

## GitHub Install

Pin the plugin to a release tag in `opencode.json` so later updates do not change existing sessions unexpectedly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.2"
  ]
}
```

Use a specific tag such as `#v0.1.2`, not a floating branch. Restart opencode after changing the plugin list.

Optional plugin settings use opencode's tuple form:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.2",
      { "autoContinue": true }
    ]
  ]
}
```

`statePath` is optional. By default, goal state is stored at `~/.local/share/opencode-goal-mode/state.json`. Override it only when you want isolated state for tests or a specific project.

## tmux Smoke Test

```bash
bun run smoke:tmux
tmux capture-pane -p -t opencode-goal-smoke
tmux kill-session -t opencode-goal-smoke
```

The smoke test uses an isolated `OPENCODE_CONFIG` and stores goal state in `/tmp/opencode-goal-smoke/goal-state.json`.
