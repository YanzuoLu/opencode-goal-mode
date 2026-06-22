# Goal Menu Slash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the TUI menu slash command from `/goal` to `/goal-menu` so OpenCode autocomplete no longer shows two `/goal` entries.

**Architecture:** Preserve the server plugin as the only `/goal` command because inline arguments require `config.command.goal`. Keep the TUI command's internal keymap name `goal.menu`, but change its visible slash name in both modern and legacy registration paths.

**Tech Stack:** TypeScript, Bun tests, OpenCode server plugin API, OpenCode TUI plugin API, GitHub tag install.

## Global Constraints

- Always use TDD: write a failing test, verify it fails, implement the minimal code, verify it passes.
- Do not remove or hide the server `config.command.goal`; OpenCode has no supported hidden server command field.
- Do not remove inline `/goal <objective>` or `/goal set|replace|resume|show|pause|drop` behavior.
- Change the TUI menu slash name to `/goal-menu` in both keymap and legacy fallback paths.
- Do not add token/time budgets.
- Do not publish npm. Keep GitHub tag install and avoid `scripts.build`.
- Do not commit unless the user explicitly asks for a commit.

---

### Task 1: Rename TUI Slash Entry

**Files:**
- Modify: `src/tui.test.ts`
- Modify: `src/tui.ts`

**Interfaces:**
- Consumes: `registerGoalTuiCommand(api, rawOptions)`.
- Produces: a TUI menu command available as `/goal-menu`, while keeping internal command name `goal.menu` and menu behavior unchanged.

- [ ] **Step 1: Write the failing test**

Update `src/tui.test.ts` so the registration test expects:

```ts
expect(registeredCommand(api)).toMatchObject({
  namespace: "palette",
  name: "goal.menu",
  slashName: "goal-menu",
  title: "Goal",
  value: "goal-menu",
  slash: { name: "goal-menu" },
});
```

Update the legacy fallback test to expect:

```ts
expect(command).toMatchObject({ title: "Goal", value: "goal-menu", slash: { name: "goal-menu" } });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tui.test.ts`

Expected: FAIL because current code registers `slashName: "goal"`, `value: "goal"`, and `slash: { name: "goal" }`.

- [ ] **Step 3: Write minimal implementation**

In `src/tui.ts`, introduce a single constant:

```ts
const GOAL_MENU_SLASH = "goal-menu";
```

Use that constant in `commandFields()` for `value` and `slash.name`, and in the keymap registration for `slashName`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tui.test.ts`

Expected: PASS.

---

### Task 2: Update Version and Documentation

**Files:**
- Modify: `src/package.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing package metadata and README install examples.
- Produces: package version `0.1.6` and documentation that tells users `/goal-menu` opens the TUI menu.

- [ ] **Step 1: Write the failing test**

Update `src/package.test.ts` so it expects `pkg.version` to be `0.1.6`, the README to contain `#v0.1.6`, not `#v0.1.5`, and the README to contain `/goal-menu`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/package.test.ts`

Expected: FAIL because package version and README still point to `0.1.5` and do not document `/goal-menu`.

- [ ] **Step 3: Write minimal implementation**

Set `package.json` version to `0.1.6`. Update README install examples from `#v0.1.5` to `#v0.1.6`. Change behavior docs so `/goal-menu` opens the TUI goal menu/dialog and inline `/goal` remains the server command family.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/package.test.ts`

Expected: PASS.

---

### Task 3: Full Verification

**Files:**
- Generated: `dist/index.js`
- Generated: `dist/tui.js`
- Generated: `dist/src/*.d.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: verified build artifacts for `opencode-goal-mode@0.1.6`.

- [ ] **Step 1: Run full test suite**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: exit 0.

- [ ] **Step 3: Compile distribution files**

Run: `bun run compile`

Expected: exit 0 and regenerated `dist/` files.

- [ ] **Step 4: Verify package dry run**

Run: `npm pack --dry-run --json`

Expected: package name `opencode-goal-mode`, version `0.1.6`, and dist files included.

- [ ] **Step 5: Run pack smoke test**

Run: `bun run scripts/pack-smoke.ts`

Expected: exit 0.
