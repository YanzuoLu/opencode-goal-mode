import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGoalTool } from "./goal-tool";
import { GoalStore } from "./store";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-goal-tool-"));
  const store = new GoalStore(join(dir, "state.json"));
  await store.createGoal("s1", "Ship it");
  return { store, tool: createGoalTool(store) };
}

const context = {
  sessionID: "s1",
  messageID: "m1",
  agent: "build",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata() {},
  ask: async () => {},
};

function outputText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "output" in result) {
    return String(result.output);
  }
  return String(result);
}

describe("goal tool", () => {
  test("get returns active state", async () => {
    const { tool } = await setup();

    const result = await tool.execute({ op: "get" }, context as any);

    expect(outputText(result)).toContain("Ship it");
  });

  test("get returns missing message when no goal exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-goal-tool-"));
    const store = new GoalStore(join(dir, "state.json"));
    const tool = createGoalTool(store);

    const result = await tool.execute({ op: "get" }, context as any);

    expect(outputText(result)).toBe("No goal exists for this session.");
  });

  test("complete marks goal complete and suppresses continuation", async () => {
    const { store, tool } = await setup();
    await store.setFlags("s1", { continuationInFlight: true });

    const result = await tool.execute({ op: "complete", summary: "Done" }, context as any);

    const state = await store.getSession("s1");
    expect(outputText(result)).toBe("Goal completed. Summary: Done");
    expect(state.goal?.status).toBe("complete");
    expect(state.goal?.completedAt).toEqual(expect.any(Number));
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(state.flags.continuationInFlight).toBe(false);
  });

  test("drop marks goal dropped and suppresses continuation", async () => {
    const { store, tool } = await setup();
    await store.setFlags("s1", { continuationInFlight: true });

    const result = await tool.execute({ op: "drop", summary: "Wrong target" }, context as any);

    const state = await store.getSession("s1");
    expect(outputText(result)).toBe("Goal dropped. Reason: Wrong target");
    expect(state.goal?.status).toBe("dropped");
    expect(state.goal?.droppedAt).toEqual(expect.any(Number));
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(state.flags.continuationInFlight).toBe(false);
  });

  test("pause suppresses auto continuation", async () => {
    const { store, tool } = await setup();

    const result = await tool.execute({ op: "pause" }, context as any);

    const state = await store.getSession("s1");
    expect(outputText(result)).toBe("Goal paused.");
    expect(state.goal?.status).toBe("paused");
    expect(state.flags.autoContinuationSuppressed).toBe(true);
  });

  test("resume clears suppression", async () => {
    const { store, tool } = await setup();
    await tool.execute({ op: "pause" }, context as any);

    const result = await tool.execute({ op: "resume" }, context as any);

    const state = await store.getSession("s1");
    expect(outputText(result)).toBe("Goal resumed.");
    expect(state.goal?.status).toBe("active");
    expect(state.flags.autoContinuationSuppressed).toBe(false);
  });
});
