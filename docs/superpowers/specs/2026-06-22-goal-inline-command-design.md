# Goal Inline Command Design

## Goal

Restore inline `/goal <args>` usage while keeping the `/goal` TUI menu. The server plugin handles inline arguments, and the TUI plugin keeps the action-only menu for bare `/goal`.

## Version

- The next feature release is `v0.1.5` because `v0.1.4` was used for the compaction auto-continue bugfix.
- GitHub tag install remains the release path. Do not publish to npm.

## Non-Negotiable Rules

- Bare `/goal` remains the TUI menu entry and must not be consumed as server `show`.
- `/goal <objective>` is equivalent to `/goal set <objective>`.
- `/goal set <objective>`, `/goal replace <objective>`, and `/goal resume` start a model turn with model-visible active-goal context.
- `/goal show`, `/goal pause`, and `/goal drop` write UI-only transcript status, do not enter model context, and do not request a model reply.
- UI-only transcript entries must be explicitly labeled with `This message is not sent to the model.`
- UI-only goal snapshot format is:

  ```text
  ▣ Goal Mode | UI-only goal snapshot
  This message is not sent to the model.

  <active_goal_context>
  <objective>
  Ship the plugin
  </objective>
  </active_goal_context>
  ```

- UI-only status format is:

  ```text
  ▣ Goal Mode | UI-only status
  This message is not sent to the model.

  Action: paused
  ```

- UI-only command output must set every text part to `ignored: true` and set `output.noReply = true`.
- If `output.noReply` is not accepted by OpenCode in a future runtime, this release must not silently fall back to an all-ignored model turn. Tests must lock the output shape expected by the current plugin hook contract.
- Set, replace, and resume outputs must not use `ignored` or `synthetic`; their text is the exact model-visible kickoff prompt.
- Model-visible kickoff text must be recorded in `flags.ignoredInputTexts` before the chat message hook sees it, preventing self-capture as a supplemental instruction.
- Normal completion still requires the model to call `goal({ op: "complete" })`.
- Esc interrupt does not pause or drop the goal.
- Do not add token budgets, time budgets, or an 800ms continuation timer.
- Preserve OpenCode native post-compaction auto-continue behavior from `v0.1.4`.
- Keep `scripts.build` absent to avoid npm git dependency preparation failures.

## Command Behavior

| Input | Owner | State change | Command output | Model reply |
| --- | --- | --- | --- | --- |
| `/goal` | TUI plugin | None immediately | Opens TUI menu | No |
| `/goal <objective>` | Server plugin | Creates active goal if allowed | Model-visible active-goal kickoff prompt | Yes |
| `/goal set <objective>` | Server plugin | Creates active goal if allowed | Model-visible active-goal kickoff prompt | Yes |
| `/goal replace <objective>` | Server plugin | Replaces current goal | Model-visible active-goal kickoff prompt | Yes |
| `/goal resume` | Server plugin | Active/paused goal becomes active; suppression clears | Model-visible active-goal kickoff prompt | Yes |
| `/goal show` | Server plugin | None | UI-only goal snapshot, ignored, noReply | No |
| `/goal pause` | Server plugin | Active goal becomes paused | UI-only status, ignored, noReply | No |
| `/goal drop` | Server plugin | Active/paused goal becomes dropped; continuation suppressed | UI-only status, ignored, noReply | No |
| TUI show | TUI plugin | None | TUI read-only detail view/dialog only | No |
| TUI pause/drop | TUI plugin | Same as current TUI state mutations | Toast only | No |

## Architecture

The package keeps two plugin entrypoints:

- `.` is the server plugin. It owns inline `/goal <args>`, the `goal` tool, state, system context injection, compaction handling, and idle auto-continuation.
- `./tui` is the TUI plugin. It owns the bare `/goal` menu, dialogs, and toasts.

The server plugin registers `config.command.goal` and handles `command.execute.before`. OpenCode provides inline command arguments as `input.arguments`; the handler only acts when `input.command === "goal"`. Non-goal commands pass through unchanged.

Command parsing stays small: trim arguments, treat a known first token as subcommand, otherwise treat the whole string as a `set` objective. Empty arguments parse as `menu`/no-op so the TUI action can own bare `/goal`.

Set/replace/resume share the same kickoff formatter as TUI set/replace/resume. This formatter renders `renderActiveGoalContext(state)`, appends the action instruction, and returns a plain text part. Before writing the output part, the handler stores that exact text in `flags.ignoredInputTexts` so `runtime.onChatMessage()` consumes it without appending it as a supplement.

Show/pause/drop use UI-only text parts. Their output has `noReply: true` and all parts are `ignored: true`. This intentionally shows a clear transcript record without sending text to the model.

TUI `Show active goal` changes from the existing alert-style dialog to a read-only detail view/dialog dedicated to long goal context. It remains TUI-only and never writes transcript text or calls `promptAsync`.

## Error Handling

- Blank `/goal set` and `/goal replace` objectives produce UI-only error status with `ignored: true` and `noReply: true`.
- `/goal set` with an unfinished goal uses the existing store error `Cannot replace an unfinished goal`, returned as UI-only error status.
- `/goal resume`, `/goal show`, `/goal pause`, and `/goal drop` with no applicable active/paused goal return UI-only status `Action: no active goal`.
- Unknown first token is not an error; it is treated as a bare objective.
- Non-goal commands are untouched.

## Testing Requirements

- Command tests must verify `registerGoalCommand()` registers `config.command.goal`.
- Command tests must verify bare empty args do not mutate state or output.
- Command tests must verify `/goal <objective>` and `/goal set <objective>` create goals and output model-visible text without `ignored` or `synthetic`.
- Command tests must verify `/goal replace <objective>` replaces active goal and outputs model-visible text.
- Command tests must verify `/goal resume` supports paused goals and active-but-suppressed goals, clears suppression, and outputs model-visible text.
- Command tests must verify `/goal show`, `/goal pause`, and `/goal drop` set `output.noReply = true`, use `ignored: true`, and do not create model-visible text.
- Runtime tests must verify server kickoff text is not captured as a supplement.
- TUI tests must verify the show action uses the read-only goal detail view/dialog, does not prompt, and does not write transcript text.
- Package tests must expect version `0.1.5`, README pin `#v0.1.5`, and no `scripts.build`.
- Full verification must include `bun test`, `bun run typecheck`, `bun run compile`, `npm pack --dry-run --json`, and `bun run scripts/pack-smoke.ts`.

## Install Documentation

README must document both plugin entries:

- `opencode.json` for the server plugin entry.
- `tui.json` for the TUI plugin entry.

Both examples must pin `opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.5`.

README must explain that `/goal` opens the TUI menu, while `/goal <objective>` and subcommands are handled inline by the server plugin.
