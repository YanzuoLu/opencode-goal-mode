# Goal TUI Command Design

## Goal

Fix `/goal` so anything shown in the chat transcript is also model-visible context, while short command feedback is shown through the OpenCode TUI toast system.

## Non-Negotiable Rules

- Chat transcript text must never be UI-only fallback text.
- Do not use ignored chat text for `/goal` command feedback.
- Short confirmations such as `Goal set`, `Goal paused`, and `No active goal` must be shown with `api.ui.toast`.
- `/goal show`, `/goal pause`, `/goal resume`, and `/goal drop` must not submit an empty or ignored prompt to the model.
- Set, replace, and resume are the only `/goal` actions that may start a model turn, and when they do, the user-visible chat message must be the same goal context the model receives.
- Normal completion still requires the model to call `goal({ op: "complete" })`.
- Esc interrupt does not pause or drop the goal.
- Do not add token or time budgets.
- Do not publish npm. GitHub tag install remains the release path.

## Command Behavior

| Operation | Model-visible input | TUI feedback |
| --- | --- | --- |
| `/goal` | Nothing immediately. | Opens a TUI menu with Set, Replace, Show, Pause, Resume, Drop. |
| Set goal | Sends a model-visible user message containing the complete active goal context and an instruction to begin working. | DialogPrompt for objective, then toast `Goal set`. |
| Replace goal | Sends a model-visible user message containing the complete new active goal context and an instruction to work on the replacement goal. | DialogPrompt for objective, then toast `Goal replaced`. |
| Show goal | Nothing. | DialogAlert containing current rendered goal context; toast `No active goal` if there is no active goal. |
| Pause goal | Nothing. Future model turns do not receive active goal context while paused. | Toast `Goal paused`. |
| Resume goal | Sends a model-visible user message containing the complete active goal context and an instruction to resume. | Toast `Goal resumed`. |
| Drop goal | Nothing. Future model turns do not receive active goal context and auto-continuation is suppressed. | Toast `Goal dropped`. |
| Ordinary user message while a goal is active | The user message plus system-injected active goal context. | No extra toast. |
| `goal({ op: "complete" })` | The model sees the tool result. | Optional completion toast is allowed later but not required for this fix. |

## Architecture

The package exports two OpenCode plugin targets:

- `.` is the server plugin. It owns state, the `goal` tool, system context injection, compaction handling, and auto-continuation. It must not register `/goal` as a server command.
- `./tui` is the TUI plugin. It owns slash UI, dialogs, and toasts.

The TUI plugin uses the same `GoalStore`, `parseOptions`, and context rendering functions as the server plugin. It registers `/goal` as an action-only slash command with `api.keymap.registerLayer` first, falling back to legacy `api.command.register` when needed, matching the working codex-lb pattern.

The TUI plugin sends set, replace, and resume model-visible prompts with `api.client.session.promptAsync`. It reads the current session from `api.route.current.params.sessionID`, and reads the session's current `agent`, `model.providerID`, `model.id`, and `model.variant` from `api.state.session.get(sessionID)`. If any required session/model data is missing, it shows an error toast and does not mutate goal state or write chat text.

## Testing Requirements

- Command tests must fail if any `/goal` feedback uses `{ ignored: true }` text parts.
- TUI tests must verify action-only `/goal` registration and toast/dialog behavior.
- TUI tests must verify set/replace/resume write state and call `promptAsync` with model-visible text parts.
- TUI tests must verify show/pause/drop do not call `promptAsync`.
- Package tests must verify the `./tui` export is included in package metadata.
- Existing system transform tests must continue to prove active goal context is injected into model context.

## Install Documentation

README must show both plugin entries:

- `opencode.json` for the server plugin entry.
- `tui.json` for the TUI plugin entry.

Both examples must pin a GitHub tag. The next fixed tag is `v0.1.3`.
