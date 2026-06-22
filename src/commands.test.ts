import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleGoalCommand, parseGoalArgs, registerGoalCommand } from "./commands";
import { GoalRuntimeHooks } from "./runtime";
import { GoalStore } from "./store";

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-goal-command-"));
  return new GoalStore(join(dir, "state.json"));
}

function expectIgnoredText(output: any, expectedText?: string): string {
  expect(output.parts).toHaveLength(1);
  expect(output.parts[0]?.type).toBe("text");
  expect(output.parts[0]?.ignored).toBe(true);
  if (expectedText !== undefined) {
    expect(output.parts[0]?.text).toBe(expectedText);
  }
  return output.parts[0]?.text;
}

describe("goal commands", () => {
  test("registers command with required template", () => {
    const config: any = {};

    registerGoalCommand(config);

    expect(config.command.goal.template).toBe("Manage persistent goal mode");
  });

  test("parses bare objective as set", () => {
    expect(parseGoalArgs("Ship the plugin")).toEqual({
      subcommand: "set",
      rest: "Ship the plugin",
    });
    expect(parseGoalArgs("pause")).toEqual({ subcommand: "pause", rest: "" });
  });

  test("creates goal and emits concise ignored confirmation", async () => {
    const s = await store();
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "Ship it" }, output, s);

    expectIgnoredText(output, "Goal mode initialized. Work toward the active goal.");
    expect(output.parts[0]?.text).not.toContain("<active_goal_context>");
    const state = await s.getSession("s1");
    expect(state.goal?.objective).toBe("Ship it");
    expect(state.flags.ignoredInputTexts).toEqual([]);
  });

  test("set updates state that is injected through system transform", async () => {
    const s = await store();
    const runtime = new GoalRuntimeHooks(s, {
      session: { promptAsync: async () => undefined },
    } as any);
    const commandOutput: any = { parts: [] };
    const systemOutput = { system: ["base"] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "Ship it" }, commandOutput, s);
    await runtime.onSystemTransform({ sessionID: "s1" } as any, systemOutput);

    const rendered = systemOutput.system.join("\n");
    expectIgnoredText(commandOutput, "Goal mode initialized. Work toward the active goal.");
    expect(rendered).toContain("<active_goal_context>");
    expect(rendered).toContain("<objective>\nShip it\n</objective>");
  });

  test("real user messages after set are still captured as supplemental instructions", async () => {
    const s = await store();
    const runtime = new GoalRuntimeHooks(s, {
      session: { promptAsync: async () => undefined },
    } as any);
    const commandOutput: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "Ship it" }, commandOutput, s);
    await runtime.onChatMessage(
      { sessionID: "s1", messageID: "m-real" },
      { parts: [{ type: "text", text: "Prefer server-only." }] } as any,
    );

    const state = await s.getSession("s1");
    expect(state.goal?.supplements).toHaveLength(1);
    expect(state.goal?.supplements[0]?.text).toBe("Prefer server-only.");

    const systemOutput = { system: [] };
    await runtime.onSystemTransform({ sessionID: "s1" } as any, systemOutput);
    const rendered = systemOutput.system.join("\n");
    expect(rendered).toContain("<supplemental_instructions>");
    expect(rendered).toContain("Prefer server-only.");
  });

  test("pause and resume change status", async () => {
    const s = await store();
    await s.createGoal("s1", "Ship it");

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "pause" }, { parts: [] } as any, s);
    expect((await s.getSession("s1")).goal?.status).toBe("paused");

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "resume" }, { parts: [] } as any, s);
    expect((await s.getSession("s1")).goal?.status).toBe("active");
  });

  test("show renders ignored current active goal or missing message", async () => {
    const s = await store();
    const missingOutput: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "" }, missingOutput, s);
    expectIgnoredText(missingOutput, "No active goal.");

    await s.createGoal("s1", "Ship it");
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "show" }, output, s);

    const text = expectIgnoredText(output);
    expect(text).toContain("Current goal state:");
    expect(text).toContain("Ship it");
    expect((await s.getSession("s1")).flags.ignoredInputTexts).toEqual([]);
  });

  test("ignored command feedback is not captured as supplemental instructions", async () => {
    const s = await store();
    const runtime = new GoalRuntimeHooks(s, {
      session: { promptAsync: async () => undefined },
    } as any);
    await s.createGoal("s1", "Ship it");

    const showOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "show" }, showOutput, s);
    await runtime.onChatMessage({ sessionID: "s1", messageID: "m-show" }, showOutput);

    const pauseOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "pause" }, pauseOutput, s);
    await runtime.onChatMessage({ sessionID: "s1", messageID: "m-pause" }, pauseOutput);

    const resumeOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "resume" }, resumeOutput, s);
    await runtime.onChatMessage({ sessionID: "s1", messageID: "m-resume" }, resumeOutput);

    const state = await s.getSession("s1");
    expect(state.goal?.supplements).toHaveLength(0);
    expect(state.flags.ignoredInputTexts).toEqual([]);
  });

  test("replace creates a new active goal and emits concise ignored confirmation", async () => {
    const s = await store();
    await s.createGoal("s1", "Old goal");
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "replace New goal" }, output, s);

    expectIgnoredText(output, "Goal replaced. Work toward the new active goal.");
    expect(output.parts[0]?.text).not.toContain("<active_goal_context>");
    const state = await s.getSession("s1");
    expect(state.goal?.objective).toBe("New goal");
    expect(state.goal?.status).toBe("active");
    expect(state.flags.ignoredInputTexts).toEqual([]);
  });

  test("all goal command feedback is emitted as ignored text", async () => {
    const s = await store();

    const missingOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "" }, missingOutput, s);
    expectIgnoredText(missingOutput, "No active goal.");

    const setOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "Ship it" }, setOutput, s);
    expectIgnoredText(setOutput, "Goal mode initialized. Work toward the active goal.");

    const showOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "show" }, showOutput, s);
    expectIgnoredText(showOutput);

    const pauseOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "pause" }, pauseOutput, s);
    expectIgnoredText(pauseOutput, "Goal paused. Use /goal resume to continue it.");

    const resumeOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "resume" }, resumeOutput, s);
    expectIgnoredText(resumeOutput, "Goal resumed.");

    const replaceOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "replace New goal" }, replaceOutput, s);
    expectIgnoredText(replaceOutput, "Goal replaced. Work toward the new active goal.");

    const dropOutput: any = { parts: [] };
    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "drop" }, dropOutput, s);
    expectIgnoredText(dropOutput, "Goal dropped.");
  });

  test("drop marks goal dropped and suppresses continuation", async () => {
    const s = await store();
    await s.createGoal("s1", "Ship it");
    await s.setFlags("s1", { continuationInFlight: true });
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "drop" }, output, s);

    const state = await s.getSession("s1");
    expectIgnoredText(output, "Goal dropped.");
    expect(state.goal?.status).toBe("dropped");
    expect(state.goal?.droppedAt).toEqual(expect.any(Number));
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(state.flags.continuationInFlight).toBe(false);
  });

  test("non-goal commands pass through unchanged", async () => {
    const s = await store();
    const output: any = { parts: [{ type: "text", text: "existing" }] };

    await handleGoalCommand({ command: "other", sessionID: "s1", arguments: "Ship it" }, output, s);

    expect(output.parts).toEqual([{ type: "text", text: "existing" }]);
    expect((await s.getSession("s1")).goal).toBeUndefined();
  });
});
