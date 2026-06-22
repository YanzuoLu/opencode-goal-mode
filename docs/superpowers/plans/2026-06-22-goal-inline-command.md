# Goal Inline Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `v0.1.5` with inline `/goal <args>` server command support while preserving the bare `/goal` TUI menu.

**Architecture:** Keep the server plugin as the owner of inline slash command behavior and the TUI plugin as the owner of the bare action-only menu. Share the goal kickoff prompt formatter through `src/context.ts` so server and TUI produce identical model-visible text. Use UI-only ignored/noReply command output for inline show/pause/drop status.

**Tech Stack:** TypeScript, Bun test runner, OpenCode server plugin API, OpenCode TUI plugin API, `@opencode-ai/plugin`, `@opencode-ai/sdk`.

## Global Constraints

- Always use TDD: write a failing test, verify it fails, implement minimal code, verify it passes.
- Work in place on `/Users/ol125/Documents/opencode-goal`; the user previously chose not to create a git worktree.
- Do not commit unless the user explicitly asks for a commit.
- Feature version is `0.1.5`; release tag examples use `#v0.1.5`.
- Bare `/goal` remains the TUI menu entry and must not be consumed as server `show`.
- `/goal <objective>` is equivalent to `/goal set <objective>`.
- `/goal set <objective>`, `/goal replace <objective>`, and `/goal resume` start a model turn with model-visible active-goal context.
- `/goal show`, `/goal pause`, and `/goal drop` write UI-only transcript status, do not enter model context, and do not request a model reply.
- UI-only transcript text must include `This message is not sent to the model.`
- UI-only text parts must be `ignored: true` and command output must set `noReply: true`.
- Set/replace/resume output parts must not use `ignored` or `synthetic`.
- Kickoff prompt text must be added to `flags.ignoredInputTexts` before `chat.message` can capture it as a supplement.
- Normal completion still requires `goal({ op: "complete" })`.
- Do not add token budgets, time budgets, or an 800ms continuation timer.
- Preserve OpenCode native post-compaction auto-continue behavior from `v0.1.4`.
- Keep `scripts.build` absent.

---

### Task 1: Shared Prompt Formatter

**Files:**
- Modify: `src/context.ts`
- Modify: `src/context.test.ts`
- Modify: `src/tui.ts`
- Modify: `src/tui.test.ts`

**Interfaces:**
- Produces: `goalStartPromptText(context: string, action: "set" | "replace" | "resume"): string` exported from `src/context.ts`.
- Consumes: existing TUI tests that import `goalStartPromptText` from `src/tui.ts`; `src/tui.ts` must re-export it.

- [ ] **Step 1: Write failing tests**

  Add this test to `src/context.test.ts`:

  ```ts
  test("builds goal start prompt text for set, replace, and resume", () => {
    const context = "<active_goal_context>Ship it</active_goal_context>";

    expect(goalStartPromptText(context, "set")).toContain("Begin working toward the active goal.");
    expect(goalStartPromptText(context, "replace")).toContain("Begin working toward the replacement active goal.");
    expect(goalStartPromptText(context, "resume")).toContain("Resume working toward the active goal.");
    expect(goalStartPromptText(context, "set")).toContain(context);
    expect(goalStartPromptText(context, "set")).toContain('goal({ op: "complete" })');
  });
  ```

  Import `goalStartPromptText` from `./context` in `src/context.test.ts`.

- [ ] **Step 2: Verify RED**

  Run: `bun test src/context.test.ts`

  Expected: FAIL because `goalStartPromptText` is not exported from `src/context.ts`.

- [ ] **Step 3: Implement minimal formatter move**

  In `src/context.ts`, add:

  ```ts
  export type GoalStartAction = "set" | "replace" | "resume";

  export function goalStartPromptText(context: string, action: GoalStartAction): string {
    const instruction = action === "resume"
      ? "Resume working toward the active goal."
      : action === "replace"
        ? "Begin working toward the replacement active goal."
        : "Begin working toward the active goal.";
    return `${context}\n\n${instruction}\nIf the goal is now complete, call goal({ op: "complete" }).`;
  }
  ```

  In `src/tui.ts`, replace the local formatter implementation with:

  ```ts
  import { goalStartPromptText, renderActiveGoalContext } from "./context";
  import type { GoalStartAction } from "./context";
  export { goalStartPromptText } from "./context";
  ```

  Keep `type GoalMenuAction = GoalStartAction | "show" | "pause" | "drop";`.

- [ ] **Step 4: Verify GREEN**

  Run: `bun test src/context.test.ts src/tui.test.ts`

  Expected: PASS.

---

### Task 2: Server Inline Goal Command

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/commands.test.ts`
- Modify: `src/index.ts`
- Modify: `src/runtime.test.ts`

**Interfaces:**
- Consumes: `GoalStore`, `renderActiveGoalContext`, `goalStartPromptText`.
- Produces: `registerGoalCommand(config: Config): void` registers `config.command.goal`.
- Produces: `handleGoalCommand(input, output, store)` mutates only `/goal` command output and state.
- Output type used by tests: `{ parts: any[]; noReply?: boolean }`.

- [ ] **Step 1: Write failing command tests**

  Replace `src/commands.test.ts` expectations with tests for these behaviors:

  ```ts
  test("registers a server slash command", () => {
    const config: any = {};
    registerGoalCommand(config);
    expect(config.command.goal).toMatchObject({ description: "Manage the active goal" });
  });

  test("empty goal args are a no-op so the TUI menu owns bare /goal", async () => {
    const s = await store();
    const output: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "" }, output, s);
    expect(output).toEqual({ parts: [] });
    expect((await s.getSession("s1")).goal).toBeUndefined();
  });

  test("bare objective creates a goal with model-visible kickoff text", async () => {
    const s = await store();
    const output: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "Ship inline goal" }, output, s);
    expect((await s.getSession("s1")).goal).toMatchObject({ objective: "Ship inline goal", status: "active" });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].text).toContain("<active_goal_context>");
    expect(output.parts[0].text).toContain("Ship inline goal");
    expect(output.parts[0].ignored).toBeUndefined();
    expect(output.parts[0].synthetic).toBeUndefined();
    expect(output.noReply).toBeUndefined();
  });
  ```

  Add separate tests for:

  - `set <objective>` creates a goal with model-visible text.
  - `replace <objective>` replaces an active goal with model-visible text.
  - `resume` changes paused and active suppressed goals to active, clears `autoContinuationSuppressed`, and emits model-visible text.
  - `show` emits UI-only snapshot with `ignored: true` and `noReply: true`.
  - `pause` changes active to paused and emits UI-only status `Action: paused`.
  - `drop` changes active or paused to dropped, sets `continuationInFlight: false`, sets `autoContinuationSuppressed: true`, and emits UI-only status `Action: dropped`.
  - Non-goal command pass-through remains unchanged.
  - Blank `set` and `replace` emit UI-only status containing `Goal objective cannot be blank` and do not mutate state.

- [ ] **Step 2: Verify RED**

  Run: `bun test src/commands.test.ts`

  Expected: FAIL because the current server command functions are no-ops.

- [ ] **Step 3: Implement minimal server command behavior**

  In `src/commands.ts`:

  - Change `GoalSubcommand` to include `"menu"`.
  - Change empty args parsing to `{ subcommand: "menu", rest: "" }`.
  - Implement `registerGoalCommand(config)` as:

    ```ts
    config.command = Object.assign({}, config.command, {
      goal: { description: "Manage the active goal" },
    });
    ```

  - Add helpers:

    ```ts
    function pushVisibleGoalPrompt(output: { parts: any[] }, text: string): void {
      output.parts.push({ type: "text", text });
    }

    function setUiOnly(output: { parts: any[]; noReply?: boolean }, text: string): void {
      output.parts.push({ type: "text", text, ignored: true });
      output.noReply = true;
    }

    function uiStatus(action: string): string {
      return `▣ Goal Mode | UI-only status\nThis message is not sent to the model.\n\nAction: ${action}`;
    }

    function uiSnapshot(context: string): string {
      return `▣ Goal Mode | UI-only goal snapshot\nThis message is not sent to the model.\n\n${context}`;
    }
    ```

  - For set/replace/resume, render context, build `goalStartPromptText(context, action)`, set `ignoredInputTexts`, then push the visible text part.
  - For show/pause/drop/no-active/errors, call `setUiOnly`.
  - Keep non-goal command pass-through.

  In `src/index.ts`, wire:

  ```ts
  import { handleGoalCommand, registerGoalCommand } from "./commands";
  ```

  Add hooks:

  ```ts
  config: (config) => {
    registerGoalCommand(config);
  },
  "command.execute.before": async (input, output) => {
    await handleGoalCommand(input, output as any, store);
  },
  ```

- [ ] **Step 4: Add runtime self-capture regression test**

  In `src/runtime.test.ts`, add a test that calls `handleGoalCommand()` for `arguments: "Ship server kickoff"`, then calls `runtime.onChatMessage()` with the output parts, and verifies supplements stay empty and `ignoredInputTexts` is consumed.

- [ ] **Step 5: Verify GREEN**

  Run: `bun test src/commands.test.ts src/runtime.test.ts`

  Expected: PASS.

---

### Task 3: TUI Show Read-Only Detail View

**Files:**
- Modify: `src/tui.ts`
- Modify: `src/tui.test.ts`

**Interfaces:**
- Consumes: existing `showGoal()` helper in `src/tui.ts`.
- Produces: a read-only dialog/view object whose `type` is `goal-detail` in test fallback environments and whose props contain `title: "Active goal"` and `context`.

- [ ] **Step 1: Write failing TUI tests**

  Update the existing `show opens a dialog with rendered context and does not prompt` test to expect:

  ```ts
  expect(dialog.type).toBe("goal-detail");
  expect(dialog.props.title).toBe("Active goal");
  expect(dialog.props.context).toContain("<active_goal_context>");
  expect(dialog.props.context).toContain("Ship the TUI command");
  expect(api.promptCalls).toHaveLength(0);
  ```

  Keep the no-active-goal toast test unchanged.

- [ ] **Step 2: Verify RED**

  Run: `bun test src/tui.test.ts`

  Expected: FAIL because current show returns a `DialogAlert` object with `type: "alert"` and `message`.

- [ ] **Step 3: Implement read-only detail view**

  In `src/tui.ts`, add:

  ```ts
  function goalDetailView(api: GoalTuiApi, context: string): unknown {
    return {
      type: "goal-detail",
      props: {
        title: "Active goal",
        context,
        onClose: () => api.ui?.dialog?.clear?.(),
      },
    };
  }
  ```

  Change `showGoal()` to call `api.ui?.dialog?.replace?.(() => goalDetailView(api, context));`.

- [ ] **Step 4: Verify GREEN**

  Run: `bun test src/tui.test.ts`

  Expected: PASS.

---

### Task 4: Version, README, Dist, and Full Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/package.test.ts`
- Modify generated: `dist/index.js`
- Modify generated: `dist/tui.js`
- Modify generated declarations under `dist/src/`

**Interfaces:**
- Produces: package version `0.1.5`.
- Produces: README install examples pinned to `#v0.1.5`.
- Produces: documentation for bare `/goal` TUI menu plus inline `/goal <objective>` and subcommands.

- [ ] **Step 1: Write failing package/docs tests**

  In `src/package.test.ts`:

  - Change version expectation to `0.1.5`.
  - Change README expected pin to `#v0.1.5`.
  - Assert README does not contain `#v0.1.4`.
  - Assert README contains `/goal <objective>`.
  - Assert README contains `/goal show`, `/goal pause`, and `/goal drop`.
  - Assert README contains `This message is not sent to the model.`.
  - Keep `expect(pkg.scripts?.build).toBeUndefined()`.

- [ ] **Step 2: Verify RED**

  Run: `bun test src/package.test.ts`

  Expected: FAIL because package version and README still describe `v0.1.4` behavior.

- [ ] **Step 3: Update version and README**

  Set `package.json` version to `0.1.5`.

  Update README behavior bullets:

  - `/goal` opens the TUI goal menu/dialog.
  - `/goal <objective>` and `/goal set <objective>` create a goal inline and submit model-visible goal context.
  - `/goal replace <objective>` replaces a goal inline and submits model-visible goal context.
  - `/goal resume` resumes active/paused goals inline and submits model-visible goal context.
  - `/goal show`, `/goal pause`, and `/goal drop` write UI-only transcript status with `This message is not sent to the model.` and do not request a model reply.

  Update every README GitHub install tag to `#v0.1.5`.

- [ ] **Step 4: Verify package/docs tests**

  Run: `bun test src/package.test.ts`

  Expected: PASS.

- [ ] **Step 5: Build dist**

  Run: `bun run compile`

  Expected: exit 0 and regenerated `dist/index.js`, `dist/tui.js`, and declarations.

- [ ] **Step 6: Full verification**

  Run these commands:

  ```bash
  bun test
  bun run typecheck
  bun run compile
  npm pack --dry-run --json
  bun run scripts/pack-smoke.ts
  git diff --check
  ```

  Expected:

  - `bun test`: all tests pass.
  - `bun run typecheck`: exit 0.
  - `bun run compile`: exit 0.
  - `npm pack --dry-run --json`: reports `opencode-goal-mode@0.1.5` and includes `dist/tui.js`.
  - `bun run scripts/pack-smoke.ts`: exit 0.
  - `git diff --check`: no output.

---

## Self-Review

- Spec coverage: Tasks cover shared formatter, server inline command behavior, runtime self-capture prevention, TUI show read-only detail view, package/docs/version/dist, and full verification.
- Placeholder scan: This plan contains no unresolved placeholder text.
- Type consistency: The shared `GoalStartAction` type, `goalStartPromptText` function, command output `noReply`, and UI-only text formats match the design spec.
- Scope check: The plan does not include npm publishing, token/time budgets, or continuation timer work.
