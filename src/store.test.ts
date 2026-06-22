import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GoalStore } from "./store";

let tempDir: string;
let storePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "opencode-goal-store-"));
  storePath = join(tempDir, "goal-state.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("GoalStore", () => {
  test("exposes the configured store file path", () => {
    const store = new GoalStore(storePath);

    expect(store.filePath).toBe(storePath);
  });

  test("createGoal creates a session with root runtime flags and goal metadata", async () => {
    const store = new GoalStore(storePath);

    const state = await store.createGoal("session-1", " Ship the store ");

    expect(state.sessionID).toBe("session-1");
    expect(state.seenUserMessageIDs).toEqual([]);
    expect(state.flags).toEqual({
      continuationInFlight: false,
      turnHadToolCalls: false,
      autoContinuationSuppressed: false,
      pendingQuestionCount: 0,
      pendingPermissionCount: 0,
      compactionNoticePending: false,
      compactionNoticeSkipNextClear: false,
      ignoredInputTexts: [],
    });
    expect(state.goal).toBeDefined();
    expect(state.goal).toMatchObject({
      id: expect.any(String),
      objective: "Ship the store",
      status: "active",
      supplements: [],
    });
    expect(state.goal?.createdAt).toEqual(expect.any(Number));
    expect(state.goal?.updatedAt).toBe(state.goal?.createdAt);
    expect(state.goal?.completedAt).toBeUndefined();
    expect(state.goal?.droppedAt).toBeUndefined();
  });

  test("saveSession supports sessions without a goal", async () => {
    const store = new GoalStore(storePath);

    const state = await store.saveSession({
      sessionID: "session-1",
      seenUserMessageIDs: ["message-1"],
      flags: {
        continuationInFlight: false,
        turnHadToolCalls: false,
        autoContinuationSuppressed: true,
        pendingQuestionCount: 1,
        pendingPermissionCount: 0,
        compactionNoticePending: false,
        compactionNoticeSkipNextClear: false,
        ignoredInputTexts: ["ignored"],
      },
    });

    expect(state.goal).toBeUndefined();
    expect(state.seenUserMessageIDs).toEqual(["message-1"]);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
  });

  test("createGoal rejects blank objectives and existing unfinished goals", async () => {
    const store = new GoalStore(storePath);

    await expect(store.createGoal("session-1", "   ")).rejects.toThrow(
      "Goal objective cannot be blank",
    );

    await store.createGoal("session-1", "First goal");
    await expect(store.createGoal("session-1", "Second goal")).rejects.toThrow(
      "Cannot replace an unfinished goal",
    );

    await store.updateGoal("session-1", (goal) => ({ ...goal, status: "complete" }));
    const next = await store.createGoal("session-1", "Second goal");

    expect(next.goal?.objective).toBe("Second goal");
    expect(next.goal?.status).toBe("active");
  });

  test("replaceGoal creates a new active goal and resets runtime flags", async () => {
    const store = new GoalStore(storePath);
    await store.createGoal("session-1", "Old goal");
    await store.setFlags("session-1", {
      continuationInFlight: true,
      continuationAssistantMessageID: "assistant-1",
      autoContinuationSuppressed: true,
      pendingQuestionCount: 2,
      ignoredInputTexts: ["ignored"],
    });
    await store.appendSupplement("session-1", {
      messageID: "message-1",
      source: "user",
      text: "extra context",
    });

    const replaced = await store.replaceGoal("session-1", " New goal ");

    expect(replaced.goal).toMatchObject({
      id: expect.any(String),
      objective: "New goal",
      status: "active",
      supplements: [],
    });
    expect(replaced.flags).toEqual({
      continuationInFlight: false,
      turnHadToolCalls: false,
      autoContinuationSuppressed: false,
      pendingQuestionCount: 0,
      pendingPermissionCount: 0,
      compactionNoticePending: false,
      compactionNoticeSkipNextClear: false,
      ignoredInputTexts: [],
    });
  });

  test("appendSupplement trims text, deduplicates by messageID, records metadata, and clears suppression", async () => {
    const store = new GoalStore(storePath);
    await store.createGoal("session-1", "Goal");
    await store.setFlags("session-1", { autoContinuationSuppressed: true });

    await store.appendSupplement("session-1", {
      messageID: "message-1",
      source: "queued-user",
      text: "  remember this  ",
    });
    const state = await store.appendSupplement("session-1", {
      messageID: "message-1",
      source: "queued-user",
      text: "remember this again",
    });

    expect(state.goal?.supplements).toEqual([
      {
        id: "message-1",
        messageID: "message-1",
        source: "queued-user",
        text: "remember this",
        createdAt: expect.any(Number),
      },
    ]);
    expect(state.flags.autoContinuationSuppressed).toBe(false);
  });

  test("appendSupplement supports supplements without message IDs", async () => {
    const store = new GoalStore(storePath);
    await store.createGoal("session-1", "Goal");

    await store.appendSupplement("session-1", {
      source: "user",
      text: "  remember this  ",
    });
    const state = await store.appendSupplement("session-1", {
      source: "user",
      text: "remember this",
    });

    expect(state.goal?.supplements).toHaveLength(1);
    expect(state.goal?.supplements[0]).toMatchObject({
      id: expect.any(String),
      source: "user",
      text: "remember this",
      createdAt: expect.any(Number),
    });
    expect(state.goal?.supplements[0]?.messageID).toBeUndefined();
  });

  test("appendSupplement ignores inactive goals", async () => {
    const store = new GoalStore(storePath);
    await store.createGoal("session-1", "Goal");
    await store.updateGoal("session-1", (goal) => ({ ...goal, status: "paused" }));

    const state = await store.appendSupplement("session-1", {
      messageID: "message-1",
      source: "user",
      text: "ignored while paused",
    });

    expect(state.goal?.supplements).toEqual([]);
  });

  test("setFlags merges runtime flags without changing goal status", async () => {
    const store = new GoalStore(storePath);
    await store.createGoal("session-1", "Goal");
    await store.updateGoal("session-1", (goal) => ({ ...goal, status: "paused" }));

    const state = await store.setFlags("session-1", {
      continuationInFlight: true,
      pendingPermissionCount: 3,
    });

    expect(state.goal?.status).toBe("paused");
    expect(state.flags.continuationInFlight).toBe(true);
    expect(state.flags.pendingPermissionCount).toBe(3);
  });

  test("persists sessions to JSON and reloads them from disk", async () => {
    const store = new GoalStore(storePath);
    await store.createGoal("session-1", "Persistent goal");
    await store.appendSupplement("session-1", {
      messageID: "message-1",
      source: "user",
      text: "persisted context",
    });

    const reloaded = new GoalStore(storePath);

    await expect(reloaded.getSession("missing")).resolves.toEqual({
      sessionID: "missing",
      flags: {
        continuationInFlight: false,
        turnHadToolCalls: false,
        autoContinuationSuppressed: false,
        pendingQuestionCount: 0,
        pendingPermissionCount: 0,
        compactionNoticePending: false,
        compactionNoticeSkipNextClear: false,
        ignoredInputTexts: [],
      },
      seenUserMessageIDs: [],
    });
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      sessions: Record<string, unknown>;
    };
    expect(persisted.sessions.missing).toBeUndefined();
    await expect(reloaded.getSession("session-1")).resolves.toEqual(
      await store.getSession("session-1"),
    );
  });
});
