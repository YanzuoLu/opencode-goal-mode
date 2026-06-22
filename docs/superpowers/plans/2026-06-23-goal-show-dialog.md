# Goal Show Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Show active goal` open a read-only dialog even when no active goal exists.

**Architecture:** Reuse the existing `goalDetailView(api, context, view)` dialog path. Change only `showGoal()` so the no-active branch passes `"No active goal"` into the same dialog renderer instead of calling toast.

**Tech Stack:** TypeScript, Bun tests, OpenCode TUI plugin API.

## Global Constraints

- Always use TDD: write a failing test, verify it fails, implement the minimal code, verify it passes.
- Do not change server `/goal` command behavior.
- Do not change `/goal-menu` slash registration.
- The no-active `Show active goal` path must not call `promptAsync`, mutate goal state, write transcript text, or show a toast.
- Do not add token/time budgets.
- Do not publish npm unless explicitly requested after implementation.
- Do not commit unless explicitly requested after implementation.

---

### Task 1: Show No-Active State In Dialog

**Files:**
- Modify: `src/tui.test.ts`
- Modify: `src/tui.ts`

**Interfaces:**
- Consumes: `showGoal(api, store)` via `selectGoalAction(api, "show")` in tests.
- Produces: no-active show behavior that opens the same read-only detail dialog shape as active show, with `context` text `No active goal`.

- [ ] **Step 1: Write the failing test**

Update `src/tui.test.ts` test `show with no active goal emits a toast` to expect a dialog instead:

```ts
test("show with no active goal opens a dialog and does not toast or prompt", async () => {
  const { api } = await setup();

  const dialog = await selectGoalAction(api, "show");

  expect(dialog.type).toBe("goal-detail");
  expect(dialog.props.title).toBe("Active goal");
  expect(dialog.props.context).toBe("No active goal");
  expect(api.toasts).toHaveLength(0);
  expect(api.promptCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui.test.ts`

Expected: FAIL because current `showGoal()` emits toast `No active goal` and does not open a dialog.

- [ ] **Step 3: Write minimal implementation**

In `src/tui.ts`, replace the no-context toast branch in `showGoal()` with fallback dialog text:

```ts
const context = renderActiveGoalContext(await store.getSession(sessionID)) ?? "No active goal";
const view = api.solidView ?? (api.ui?.Dialog ? await loadSolidView() : undefined);
api.ui?.dialog?.replace?.(() => goalDetailView(api, context, view));
```

Keep the `No active session` toast unchanged because there is no session to render state for.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tui.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run: `bun test && bun run typecheck && bun run compile && npm pack --dry-run --json && git diff --check`

Expected: all commands exit 0.
