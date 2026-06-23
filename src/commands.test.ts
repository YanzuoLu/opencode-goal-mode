import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleGoalCommand, parseGoalArgs, registerGoalCommand } from "./commands";
import { GoalStore } from "./store";

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-goal-command-"));
  return new GoalStore(join(dir, "state.json"));
}

describe("goal commands", () => {
  test("registers a server slash command", () => {
    const config: any = {};

    registerGoalCommand(config);

    expect(config.command.goal).toMatchObject({
      description: "Manage the active goal",
      template: "",
    });
  });

  test("parses bare objective as set and bare goal as menu", () => {
    expect(parseGoalArgs("")).toEqual({ subcommand: "menu", rest: "" });
    expect(parseGoalArgs("Ship the plugin")).toEqual({
      subcommand: "set",
      rest: "Ship the plugin",
    });
    expect(parseGoalArgs("pause")).toEqual({ subcommand: "pause", rest: "" });
  });

  test("empty goal args are a no-op so bare /goal does not start a model turn", async () => {
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

    expect((await s.getSession("s1")).goal).toMatchObject({
      objective: "Ship inline goal",
      status: "active",
    });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].text).toContain("Begin working toward the active goal");
    expect(output.parts[0].text).not.toContain("<active_goal_context>");
    expect(output.parts[0].ignored).toBeUndefined();
    expect(output.parts[0].synthetic).toBeUndefined();
    expect(output.noReply).toBeUndefined();
  });

  test("set creates a goal with model-visible kickoff text", async () => {
    const s = await store();
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "set Ship set goal" }, output, s);

    expect((await s.getSession("s1")).goal).toMatchObject({
      objective: "Ship set goal",
      status: "active",
    });
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Begin working toward the active goal"),
      }),
    ]);
    expect(output.parts[0].text).not.toContain("<active_goal_context>");
    expect(output.parts[0].ignored).toBeUndefined();
    expect(output.parts[0].synthetic).toBeUndefined();
    expect(output.noReply).toBeUndefined();
  });

  test("replace replaces an active goal with model-visible kickoff text", async () => {
    const s = await store();
    await s.createGoal("s1", "Old goal");
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "replace New goal" }, output, s);

    expect((await s.getSession("s1")).goal).toMatchObject({
      objective: "New goal",
      status: "active",
    });
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Begin working toward the replacement active goal"),
      }),
    ]);
    expect(output.parts[0].text).not.toContain("<active_goal_context>");
    expect(output.parts[0].ignored).toBeUndefined();
    expect(output.parts[0].synthetic).toBeUndefined();
    expect(output.noReply).toBeUndefined();
  });

  test("resume changes a paused goal to active with model-visible kickoff text", async () => {
    const s = await store();
    await s.createGoal("s1", "Resume goal");
    await s.updateGoal("s1", (goal) => {
      goal.status = "paused";
    });
    await s.setFlags("s1", { autoContinuationSuppressed: true });
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "resume" }, output, s);

    const state = await s.getSession("s1");
    expect(state.goal).toMatchObject({ objective: "Resume goal", status: "active" });
    expect(state.flags.autoContinuationSuppressed).toBe(false);
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Resume working toward the active goal"),
      }),
    ]);
    expect(output.parts[0].text).not.toContain("<active_goal_context>");
    expect(output.parts[0].ignored).toBeUndefined();
    expect(output.parts[0].synthetic).toBeUndefined();
    expect(output.noReply).toBeUndefined();
  });

  test("resume clears suppression on an active goal with model-visible kickoff text", async () => {
    const s = await store();
    await s.createGoal("s1", "Suppressed goal");
    await s.setFlags("s1", { autoContinuationSuppressed: true });
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "resume" }, output, s);

    const state = await s.getSession("s1");
    expect(state.goal).toMatchObject({ objective: "Suppressed goal", status: "active" });
    expect(state.flags.autoContinuationSuppressed).toBe(false);
    expect(output.parts[0].text).toContain("Resume working toward the active goal");
    expect(output.parts[0].ignored).toBeUndefined();
    expect(output.parts[0].synthetic).toBeUndefined();
    expect(output.noReply).toBeUndefined();
  });

  test("show emits a UI-only active goal snapshot", async () => {
    const s = await store();
    await s.createGoal("s1", "Show goal");
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "show" }, output, s);

    expect(output.noReply).toBe(true);
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        ignored: true,
        text: expect.stringContaining("Read-only snapshot"),
      }),
    ]);
    expect(output.parts[0].text).toContain("Show goal");
    expect(output.parts[0].text).toContain("<active_goal_context>");
    expect(output.parts[0].synthetic).toBeUndefined();
  });

  test("show with no active goal emits UI-only no-active status", async () => {
    const s = await store();
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "show" }, output, s);

    expect((await s.getSession("s1")).goal).toBeUndefined();
    expect(output.noReply).toBe(true);
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        ignored: true,
        text: expect.stringContaining("Action: no active goal"),
      }),
    ]);
    expect(output.parts[0].text).toContain("UI-only status");
    expect(output.parts[0].synthetic).toBeUndefined();
  });

  test("pause changes active to paused and emits UI-only status", async () => {
    const s = await store();
    await s.createGoal("s1", "Pause goal");
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "pause" }, output, s);

    expect((await s.getSession("s1")).goal).toMatchObject({ status: "paused" });
    expect(output.noReply).toBe(true);
    expect(output.parts).toEqual([
      expect.objectContaining({ type: "text", ignored: true, text: expect.stringContaining("Action: paused") }),
    ]);
    expect(output.parts[0].synthetic).toBeUndefined();
  });

  test("drop changes active to dropped and emits UI-only status", async () => {
    const s = await store();
    await s.createGoal("s1", "Drop goal");
    await s.setFlags("s1", { continuationInFlight: true });
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "drop" }, output, s);

    const state = await s.getSession("s1");
    expect(state.goal).toMatchObject({ status: "dropped" });
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(output.noReply).toBe(true);
    expect(output.parts).toEqual([
      expect.objectContaining({ type: "text", ignored: true, text: expect.stringContaining("Action: dropped") }),
    ]);
    expect(output.parts[0].synthetic).toBeUndefined();
  });

  test("drop changes paused to dropped and emits UI-only status", async () => {
    const s = await store();
    await s.createGoal("s1", "Paused drop goal");
    await s.updateGoal("s1", (goal) => {
      goal.status = "paused";
    });
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "drop" }, output, s);

    const state = await s.getSession("s1");
    expect(state.goal).toMatchObject({ status: "dropped" });
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(output.noReply).toBe(true);
    expect(output.parts[0]).toMatchObject({ type: "text", ignored: true });
    expect(output.parts[0].text).toContain("Action: dropped");
    expect(output.parts[0].synthetic).toBeUndefined();
  });

  test("blank set emits UI-only error and does not mutate state", async () => {
    const s = await store();
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "set   " }, output, s);

    expect((await s.getSession("s1")).goal).toBeUndefined();
    expect(output.noReply).toBe(true);
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        ignored: true,
        text: expect.stringContaining("Goal objective cannot be blank"),
      }),
    ]);
  });

  test("blank replace emits UI-only error and does not mutate state", async () => {
    const s = await store();
    await s.createGoal("s1", "Keep goal");
    const output: any = { parts: [] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "replace   " }, output, s);

    expect((await s.getSession("s1")).goal).toMatchObject({ objective: "Keep goal", status: "active" });
    expect(output.noReply).toBe(true);
    expect(output.parts).toEqual([
      expect.objectContaining({
        type: "text",
        ignored: true,
        text: expect.stringContaining("Goal objective cannot be blank"),
      }),
    ]);
  });

  test("resume pause and drop with no active goal emit UI-only no-active status", async () => {
    for (const subcommand of ["resume", "pause", "drop"]) {
      const s = await store();
      const output: any = { parts: [] };

      await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: subcommand }, output, s);

      expect((await s.getSession("s1")).goal).toBeUndefined();
      expect(output.noReply).toBe(true);
      expect(output.parts).toEqual([
        expect.objectContaining({
          type: "text",
          ignored: true,
          text: expect.stringContaining("Action: no active goal"),
        }),
      ]);
      expect(output.parts[0].synthetic).toBeUndefined();
    }
  });

  test("non-goal commands pass through unchanged", async () => {
    const s = await store();
    const output: any = { parts: [{ type: "text", text: "existing" }] };

    await handleGoalCommand({ command: "other", sessionID: "s1", arguments: "Ship it" }, output, s);

    expect(output.parts).toEqual([{ type: "text", text: "existing" }]);
    expect((await s.getSession("s1")).goal).toBeUndefined();
  });
});
