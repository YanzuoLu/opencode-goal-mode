import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleGoalCommand } from "./commands";
import { goalStartPromptText } from "./context";
import plugin from "./index";
import { GoalRuntimeHooks } from "./runtime";
import { GoalStore } from "./store";

async function setup(options?: { maxContextBytes: number; autoContinue: boolean; suppressQuestions?: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
  const store = new GoalStore(join(dir, "state.json"));
  const client = { session: { promptAsync: async () => undefined } };
  return { store, runtime: new GoalRuntimeHooks(store, client as any, options) };
}

describe("GoalRuntimeHooks", () => {
  test("captures real user messages as supplements", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await runtime.onChatMessage(
      { sessionID: "s1", messageID: "m1" },
      { message: { id: "m1" }, parts: [{ type: "text", text: "Prefer server-only." }] } as any,
    );

    const state = await store.getSession("s1");
    expect(state.goal?.supplements[0]?.text).toBe("Prefer server-only.");
  });

  test("does not capture a merged goal kickoff message as a supplement (regression: no nesting)", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    // Reproduces the exact shape from the corrupted state.json: opencode merges the
    // command template + raw arguments + the pushed kickoff into one user message.
    // The old exact-match dedup missed this and stored it as a supplement, which then
    // rendered as a nested <active_goal_context>. The suffix sentinel must skip it.
    const merged = `Manage persistent goal mode\n\nShip it\n\n${goalStartPromptText("set")}`;
    await runtime.onChatMessage(
      { sessionID: "s1", messageID: "m2" },
      { parts: [{ type: "text", text: merged }] } as any,
    );

    expect((await store.getSession("s1")).goal?.supplements).toHaveLength(0);
  });

  test("does not self-capture the server /goal kickoff as a supplement", async () => {
    const { store, runtime } = await setup();
    const output: any = { parts: [] };

    await handleGoalCommand(
      { command: "goal", sessionID: "s1", arguments: "Ship server kickoff" },
      output,
      store,
    );
    // The command pushes only the short kickoff; opencode also prepends the objective.
    const merged = `Ship server kickoff\n\n${output.parts.map((p: any) => p.text).join("\n\n")}`;
    await runtime.onChatMessage(
      { sessionID: "s1", messageID: "m-server-goal" },
      { parts: [{ type: "text", text: merged }] } as any,
    );

    expect((await store.getSession("s1")).goal?.supplements).toHaveLength(0);
  });

  test("strips an embedded context block but keeps the rest of a real message", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await runtime.onChatMessage(
      { sessionID: "s1", messageID: "m4" },
      {
        parts: [
          {
            type: "text",
            text: "Real note <active_goal_context>x</active_goal_context> here",
          },
        ],
      } as any,
    );

    const supplements = (await store.getSession("s1")).goal?.supplements ?? [];
    expect(supplements).toHaveLength(1);
    expect(supplements[0]?.text).not.toContain("<active_goal_context>");
    expect(supplements[0]?.text).toContain("Real note");
    expect(supplements[0]?.text).toContain("here");
  });

  test("does not capture synthetic or ignored text parts", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await runtime.onChatMessage(
      { sessionID: "s1", messageID: "m3" },
      {
        parts: [
          { type: "text", text: "Synthetic", synthetic: true },
          { type: "text", text: "Ignored", ignored: true },
          { type: "tool", text: "Not user text" },
        ],
      } as any,
    );

    expect((await store.getSession("s1")).goal?.supplements).toHaveLength(0);
  });

  test("injects active goal context into system output", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    const output = { system: ["base"] };

    await runtime.onSystemTransform({ sessionID: "s1" } as any, output);

    expect(output.system.join("\n")).toContain("<active_goal_context>");
    expect(output.system.join("\n")).toContain("Ship it");
  });

  test("injects one compaction notice and clears the pending flag", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    await store.setFlags("s1", { compactionNoticePending: true });
    const output = { system: [] };

    await runtime.onSystemTransform({ sessionID: "s1" } as any, output);

    expect(output.system.join("\n")).toContain("<compaction_notice>");
    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(false);
  });

  test("keeps compaction notice pending through the compaction transform", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    await runtime.onCompacting({ sessionID: "s1" }, { context: [] });

    const compactionOutput = { system: [] };
    await runtime.onSystemTransform({ sessionID: "s1" } as any, compactionOutput);

    expect(compactionOutput.system.join("\n")).toContain("<compaction_notice>");
    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(true);

    const nextOutput = { system: [] };
    await runtime.onSystemTransform({ sessionID: "s1" } as any, nextOutput);

    expect(nextOutput.system.join("\n")).toContain("<compaction_notice>");
    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(false);
  });

  test("pushes compaction context for active goals", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    const output = { context: ["base"] };

    await runtime.onCompacting({ sessionID: "s1" }, output);

    expect(output.context.join("\n")).toContain("Preserve this active goal context");
    expect(output.context.join("\n")).toContain("Ship it");
    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(true);
  });

  test("Esc interrupt suppresses auto continuation without pausing active goal", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await (runtime as any).onEvent({
      event: { type: "session.next.interrupt.requested", properties: { sessionID: "s1" } },
    });

    const state = await store.getSession("s1");
    expect(state.goal?.status).toBe("active");
    expect(state.flags.autoContinuationSuppressed).toBe(true);
  });

  test("idle sends synthetic continuation when active and not suppressed", async () => {
    const calls: any[] = [];
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
    const store = new GoalStore(join(dir, "state.json"));
    const runtime = new GoalRuntimeHooks(store, {
      session: { promptAsync: async (args: any) => calls.push(args) },
    } as any);
    await store.createGoal("s1", "Ship it");

    await (runtime as any).onEvent({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].path.id).toBe("s1");
    expect(calls[0].body.parts[0].synthetic).toBe(true);
    expect(calls[0].body.parts[0].text).toContain("The active goal has not been completed");
  });

  test("idle settles an in-flight no-tool continuation without prompting", async () => {
    const calls: any[] = [];
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
    const store = new GoalStore(join(dir, "state.json"));
    const runtime = new GoalRuntimeHooks(store, {
      session: { promptAsync: async (args: any) => calls.push(args) },
    } as any);
    await store.createGoal("s1", "Ship it");
    await store.setFlags("s1", {
      continuationInFlight: true,
      turnHadToolCalls: false,
      autoContinuationSuppressed: false,
    });

    await (runtime as any).onEvent({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    });

    const state = await store.getSession("s1");
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("autoContinue false prevents idle continuation", async () => {
    const calls: any[] = [];
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
    const store = new GoalStore(join(dir, "state.json"));
    const runtime = new GoalRuntimeHooks(
      store,
      { session: { promptAsync: async (args: any) => calls.push(args) } } as any,
      { maxContextBytes: 60000, autoContinue: false },
    );
    await store.createGoal("s1", "Ship it");

    await (runtime as any).onEvent({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    });

    const state = await store.getSession("s1");
    expect(calls).toHaveLength(0);
    expect(state.flags.autoContinuationSuppressed).toBe(false);
    expect(state.flags.continuationInFlight).toBe(false);
  });

  test("maxContextBytes guard suppresses idle continuation when active context is too large", async () => {
    const calls: any[] = [];
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
    const store = new GoalStore(join(dir, "state.json"));
    const runtime = new GoalRuntimeHooks(
      store,
      { session: { promptAsync: async (args: any) => calls.push(args) } } as any,
      { maxContextBytes: 1, autoContinue: true },
    );
    await store.createGoal("s1", "Ship it");

    await (runtime as any).onEvent({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    });

    const state = await store.getSession("s1");
    expect(calls).toHaveLength(0);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(state.flags.continuationInFlight).toBe(false);
  });

  test("continuation turn with no tool calls suppresses next continuation", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    await store.setFlags("s1", { continuationInFlight: true, turnHadToolCalls: false });

    await (runtime as any).onEvent({
      event: {
        type: "session.next.step.ended",
        properties: { sessionID: "s1", assistantMessageID: "a1" },
      },
    });

    const state = await store.getSession("s1");
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
  });

  test("tool call during continuation prevents suppression", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    await store.setFlags("s1", { continuationInFlight: true, turnHadToolCalls: false });

    await (runtime as any).onEvent({
      event: { type: "session.next.tool.called", properties: { sessionID: "s1", tool: "bash" } },
    });
    await (runtime as any).onEvent({
      event: {
        type: "session.next.step.ended",
        properties: { sessionID: "s1", assistantMessageID: "a1" },
      },
    });

    const state = await store.getSession("s1");
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(false);
  });

  test("idle waits while questions or permissions are pending", async () => {
    const calls: any[] = [];
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
    const store = new GoalStore(join(dir, "state.json"));
    const runtime = new GoalRuntimeHooks(store, {
      session: { promptAsync: async (args: any) => calls.push(args) },
    } as any);
    await store.createGoal("question", "Ship it");
    await store.createGoal("permission", "Ship it");
    await store.setFlags("question", { pendingQuestionCount: 1 });
    await store.setFlags("permission", { pendingPermissionCount: 1 });

    await (runtime as any).onEvent({
      event: { type: "session.idle", properties: { sessionID: "question" } },
    });
    await (runtime as any).onEvent({
      event: { type: "session.idle", properties: { sessionID: "permission" } },
    });

    expect(calls).toHaveLength(0);
  });

  test("question and permission events track pending counts without going below zero", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await (runtime as any).onEvent({
      event: { type: "question.asked", properties: { sessionID: "s1" } },
    });
    await (runtime as any).onEvent({
      event: { type: "question.v2.asked", properties: { sessionID: "s1" } },
    });
    let state = await store.getSession("s1");
    expect(state.flags.pendingQuestionCount).toBe(2);
    await (runtime as any).onEvent({
      event: { type: "question.replied", properties: { sessionID: "s1" } },
    });
    await (runtime as any).onEvent({
      event: { type: "question.v2.rejected", properties: { sessionID: "s1" } },
    });
    await (runtime as any).onEvent({
      event: { type: "question.rejected", properties: { sessionID: "s1" } },
    });

    await (runtime as any).onEvent({
      event: { type: "permission.asked", properties: { sessionID: "s1" } },
    });
    await (runtime as any).onEvent({
      event: { type: "permission.v2.asked", properties: { sessionID: "s1" } },
    });
    state = await store.getSession("s1");
    expect(state.flags.pendingPermissionCount).toBe(2);
    await (runtime as any).onEvent({
      event: { type: "permission.replied", properties: { sessionID: "s1" } },
    });
    await (runtime as any).onEvent({
      event: { type: "permission.v2.replied", properties: { sessionID: "s1" } },
    });
    await (runtime as any).onEvent({
      event: { type: "permission.replied", properties: { sessionID: "s1" } },
    });

    state = await store.getSession("s1");
    expect(state.flags.pendingQuestionCount).toBe(0);
    expect(state.flags.pendingPermissionCount).toBe(0);
  });

  test("compaction ended marks active goal for one system notice", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await (runtime as any).onEvent({
      event: { type: "session.next.compaction.ended", properties: { sessionID: "s1" } },
    });

    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(true);
  });

  test("compaction autocontinue leaves active goal autocontinue enabled and marks one system notice", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    const output = { enabled: true };

    await (runtime as any).onCompactionAutocontinue({ sessionID: "s1" }, output);

    expect(output.enabled).toBe(true);
    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(true);
  });

  test("compaction autocontinue is a no-op for sessions without active goals", async () => {
    const { store, runtime } = await setup();
    const output = { enabled: true };

    await (runtime as any).onCompactionAutocontinue({ sessionID: "ordinary" }, output);

    expect(output.enabled).toBe(true);
    expect((await store.getSession("ordinary")).goal).toBeUndefined();
  });

  test("compaction autocontinue preserves an already-disabled output flag", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    const output = { enabled: false };

    await (runtime as any).onCompactionAutocontinue({ sessionID: "s1" }, output);

    expect(output.enabled).toBe(false);
    expect((await store.getSession("s1")).flags.compactionNoticePending).toBe(true);
  });

  test("event handling is safe no-op for sessions without persisted state", async () => {
    const calls: any[] = [];
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-runtime-"));
    const store = new GoalStore(join(dir, "state.json"));
    const runtime = new GoalRuntimeHooks(store, {
      session: { promptAsync: async (args: any) => calls.push(args) },
    } as any);

    for (const type of [
      "session.next.interrupt.requested",
      "session.next.step.started",
      "session.next.tool.called",
      "question.asked",
      "question.replied",
      "permission.asked",
      "permission.replied",
      "session.next.compaction.ended",
      "session.next.step.ended",
      "session.idle",
    ]) {
      await (runtime as any).onEvent({ event: { type, properties: { sessionID: "ordinary" } } });
    }

    expect(calls).toHaveLength(0);
    expect((await store.getSession("ordinary")).goal).toBeUndefined();
  });
});

describe("plugin runtime wiring", () => {
  test("returns runtime hooks while preserving tool wiring", async () => {
    const hooks = await plugin({ client: { session: { promptAsync: async () => undefined } } } as any);

    expect(hooks.tool).toHaveProperty("goal");
    expect(hooks.config).toBeFunction();
    expect(hooks["command.execute.before"]).toBeFunction();
    expect(hooks["tool.execute.before"]).toBeFunction();
    expect(hooks["chat.message"]).toBeFunction();
    expect(hooks["experimental.chat.system.transform"]).toBeFunction();
    expect(hooks["experimental.session.compacting"]).toBeFunction();
    expect(hooks["experimental.compaction.autocontinue"]).toBeFunction();
    expect(hooks.event).toBeFunction();
  });

  test("wires server goal command hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-plugin-"));
    const statePath = join(dir, "custom-state.json");
    const hooks = await plugin(
      { client: { session: { promptAsync: async () => undefined } } } as any,
      { statePath, maxContextBytes: 60000, autoContinue: true },
    );
    const config: any = {};
    await hooks.config?.(config);
    const output: any = { parts: [] };

    await hooks["command.execute.before"]?.(
      { command: "goal", sessionID: "s1", arguments: "Ship wired command" } as any,
      output,
    );

    expect(config.command.goal).toMatchObject({ description: "Manage the active goal" });
    // The kickoff part is now XML-free and carries only the short instruction; the
    // objective reaches the model via opencode's args + the system-prompt injection.
    expect(output.parts[0].text).toContain("Begin working toward the active goal");
    expect(output.parts[0].text).not.toContain("<active_goal_context>");
    expect((await new GoalStore(statePath).getSession("s1")).goal).toMatchObject({
      objective: "Ship wired command",
      status: "active",
    });
  });

  test("uses statePath option for persisted tool state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-plugin-"));
    const statePath = join(dir, "custom-state.json");
    await new GoalStore(statePath).createGoal("s1", "Ship custom state");
    const hooks = await plugin(
      { client: { session: { promptAsync: async () => undefined } } } as any,
      { statePath, maxContextBytes: 60000, autoContinue: true },
    );
    const goalTool = hooks.tool?.goal;
    if (!goalTool) throw new Error("missing goal tool");

    const result = await goalTool.execute({ op: "get" }, { sessionID: "s1" } as any);

    expect(String(result)).toContain("Ship custom state");
  });
});

describe("autonomous goal mode disables the question tool", () => {
  // In goal mode the loop is meant to run unattended. opencode's "question" tool
  // halts the turn waiting for the user, which stalls the goal ("block"). When a
  // goal is active we abort the question tool before it runs so the model proceeds
  // autonomously instead of waiting.
  test("aborts the question tool while a goal is active", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    await expect(
      runtime.onToolExecuteBefore({ tool: "question", sessionID: "s1", callID: "c1" }, { args: {} }),
    ).rejects.toThrow(/autonomous goal mode/i);
  });

  test("leaves the question tool alone when no goal is active", async () => {
    const { runtime } = await setup();

    await expect(
      runtime.onToolExecuteBefore({ tool: "question", sessionID: "s1", callID: "c1" }, { args: {} }),
    ).resolves.toBeUndefined();
  });

  test("leaves the question tool alone for a non-active (paused) goal", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");
    await store.updateGoal("s1", (goal) => ({ ...goal, status: "paused" }));

    await expect(
      runtime.onToolExecuteBefore({ tool: "question", sessionID: "s1", callID: "c1" }, { args: {} }),
    ).resolves.toBeUndefined();
  });

  test("never blocks non-question tools, even with an active goal", async () => {
    const { store, runtime } = await setup();
    await store.createGoal("s1", "Ship it");

    for (const tool of ["bash", "edit", "read", "webfetch"]) {
      await expect(
        runtime.onToolExecuteBefore({ tool, sessionID: "s1", callID: "c1" }, { args: {} }),
      ).resolves.toBeUndefined();
    }
  });

  test("respects suppressQuestions:false (questions allowed)", async () => {
    const { store, runtime } = await setup({
      maxContextBytes: 60000,
      autoContinue: true,
      suppressQuestions: false,
    });
    await store.createGoal("s1", "Ship it");

    await expect(
      runtime.onToolExecuteBefore({ tool: "question", sessionID: "s1", callID: "c1" }, { args: {} }),
    ).resolves.toBeUndefined();
  });
});
