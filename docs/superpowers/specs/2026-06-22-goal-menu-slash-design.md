# Goal Menu Slash Design

## Goal

Remove the duplicate `/goal` autocomplete entry introduced when the server plugin and TUI plugin both register the same slash name, while preserving inline `/goal <objective>` behavior.

## Evidence

- OpenCode server `config.command` entries do not expose a public `hidden`, `showInPalette`, or `slashName` field.
- OpenCode slash autocomplete concatenates visible TUI slash commands with server command list entries and does not dedupe by slash name.
- `command.execute.before` only runs after OpenCode has resolved a registered server command, so `/goal <arguments>` still requires `config.command.goal`.
- The TUI command can choose a different `slashName`; that is the plugin-side fix that does not require upstream changes.

## Design

Keep the server command registered as `goal` so manual `/goal <objective>`, `/goal set`, `/goal replace`, `/goal resume`, `/goal show`, `/goal pause`, and `/goal drop` continue to work through `command.execute.before`.

Change the TUI menu slash entry to `/goal-menu`. The TUI command remains named `goal.menu` internally and remains available from the palette. Both the modern keymap registration and the legacy `api.command.register` fallback must use the same visible slash name.

Bare server `/goal` stays a no-op so selecting the server entry does not create state, write ignored transcript text, or start a model turn. The TUI menu is now opened through `/goal-menu`.

## User-Visible Behavior

- `/goal <objective>` creates the active goal inline according to the existing parser behavior and submits model-visible goal context.
- `/goal set <objective>`, `/goal replace <objective>`, and `/goal resume` keep their current model-visible kickoff behavior.
- `/goal show`, `/goal pause`, and `/goal drop` keep their current UI-only, `noReply` behavior.
- `/goal-menu` opens the TUI menu with Show, Set, Replace, Pause, Resume, and Drop actions.
- Slash autocomplete no longer contains two visible `/goal` entries from this plugin.

## Testing Requirements

- TUI tests must fail if the modern keymap command registers `slashName: "goal"`.
- TUI tests must assert the modern keymap command registers `slashName: "goal-menu"` and `slash: { name: "goal-menu" }`.
- TUI tests must assert the legacy fallback registers `slash: { name: "goal-menu" }`.
- Existing server command tests must continue to pass, proving inline `/goal` behavior is preserved.
- Package/README tests must assert release metadata and docs point to `0.1.6` / `#v0.1.6` and mention `/goal-menu`.

## Release Notes

This is a bugfix release for OpenCode's duplicate slash autocomplete entry. The package version should be `0.1.6`. GitHub tag install remains the supported install path; npm publication is out of scope.
