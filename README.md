# opencode-goal-mode

Persistent goal mode for opencode.

## MVP Behavior

- `/goal-menu` opens the TUI goal menu/dialog. Use it for `show`, `pause`, and `drop` — these are UI-only actions that run with no model turn.
- `/goal <objective>` and `/goal set <objective>` create a goal inline and submit model-visible goal context.
- `/goal replace <objective>` replaces a goal inline and submits model-visible goal context.
- `/goal resume` resumes active/paused goals inline and submits model-visible goal context.
- The inline `/goal` command only handles `set`, `replace`, and `resume` (the actions that drive the model). opencode always starts a model turn for an inline command, so the context-free actions `show`/`pause`/`drop` live in `/goal-menu` instead; typing them inline just points you there.
- Ordinary user messages while a goal is active are persisted as supplemental instructions.
- Command-originated/interoperability messages are not persisted as supplemental instructions by default.
- Goal mode runs autonomously: while a goal is active the model is told not to ask the user and to make reasonable assumptions instead, and the interactive `question` tool is aborted before it can halt the turn. Disable with `suppressQuestions: false`.
- Esc interrupt does not pause or drop the goal.
- Auto continuation runs only after opencode reports the session idle, and by default defers while child subagent sessions are active.
- opencode's native post-compaction auto-continue remains enabled; goal mode only adds active-goal compaction context.
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

Pin the server plugin to a release tag in `opencode.json` so later updates do not change existing sessions unexpectedly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.17"
  ]
}
```

Pin the TUI plugin in `tui.json` with the same release tag:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.17"
  ]
}
```

Use a specific tag such as `#v0.1.17`, not a floating branch. Restart opencode after changing the plugin list.

Optional plugin settings use opencode's tuple form:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.17",
      { "autoContinue": true }
    ]
  ]
}
```

`statePath` is optional. By default, goal state is stored at `~/.local/share/opencode-goal-mode/state.json`. Override it only when you want isolated state for tests or a specific project.

`suppressQuestions` is optional and defaults to `true`: while a goal is active the interactive `question` tool is aborted so the model proceeds autonomously instead of blocking for user input. Set it to `false` to let the model ask questions during a goal.

Interop guard options are optional:

- `deferWhileSubagentsActive` defaults to `true`: auto-continuation waits while tracked child/subagent sessions for the goal session are busy.
- `subagentGraceMs` defaults to `4000`: after a tracked child/subagent goes idle, auto-continuation still defers for this grace window.
- `skipCommandOriginatedSupplements` defaults to `true`: the first non-marker chat message after any command execution is not saved as a supplemental instruction.
- `commandOriginSkipTtlMs` defaults to `15000`: command-origin skipping expires after this TTL so a later genuine user message is not skipped.
- `ignoreSupplementMarkers` defaults to `["<!-- SLIM_INTERNAL_INITIATOR -->", "SENTINEL: background-job-board-v2"]`: messages containing any listed marker are never saved as supplemental instructions.

Set `GOAL_MODE_DEBUG=1` in the environment to append a JSON decision trace (child-session tracking, continuation defer/send, supplement skip/capture) to `goal-mode-debug.log` next to the goal state file. It is off by default and never affects runtime behavior.

## tmux Smoke Test

```bash
bun run smoke:tmux
tmux capture-pane -p -t opencode-goal-smoke
tmux kill-session -t opencode-goal-smoke
```

The smoke test uses an isolated `OPENCODE_CONFIG` and stores goal state in `/tmp/opencode-goal-smoke/goal-state.json`.
