# Goal Show Dialog Design

## Goal

Make the TUI `Show active goal` action always stay in the dialog flow. When there is no active goal, it should open a read-only dialog instead of showing a top-right toast.

## Current Behavior

- `/goal-menu` opens the TUI goal menu.
- Selecting `Show active goal` opens a detail dialog only when `renderActiveGoalContext()` returns context.
- If no active goal exists, `showGoal()` calls `toast(api, "info", "No active goal")`.

## Desired Behavior

- Selecting `Show active goal` with an active goal opens the existing read-only detail dialog.
- Selecting `Show active goal` without an active goal opens a read-only dialog titled `Active goal` whose content is `No active goal`.
- The no-active show path must not call `promptAsync`, mutate goal state, write transcript text, or show a toast.
- Pause, drop, resume, and set/replace behavior remain unchanged.

## Testing Requirements

- Update `src/tui.test.ts` so `show with no active goal` expects a dialog and zero toasts.
- Existing active-goal show tests must continue to pass.
- Full verification must pass before release.
