import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { stripGoalContextBlocks } from "./context";

import type {
  GoalRecord,
  GoalRuntimeFlagPatch,
  GoalRuntimeFlags,
  GoalSessionState,
  GoalStoreData,
  GoalSupplement,
  GoalUpdater,
  SupplementInput,
} from "./types";

export type {
  GoalRecord,
  GoalRuntimeFlagPatch,
  GoalRuntimeFlags,
  GoalSessionState,
  GoalStatus,
  GoalStoreData,
  GoalSupplement,
  GoalUpdater,
  SupplementInput,
  SupplementSource,
} from "./types";

const EMPTY_DATA: GoalStoreData = { sessions: {} };

// Hard cap on stored supplements per goal. Each real user message after /goal
// becomes a supplement; without a cap the system-prompt injection would grow
// unbounded over a long session. Oldest entries are dropped when exceeded.
const MAX_SUPPLEMENTS = 50;

function defaultFlags(): GoalRuntimeFlags {
  return {
    continuationInFlight: false,
    turnHadToolCalls: false,
    autoContinuationSuppressed: false,
    pendingQuestionCount: 0,
    pendingPermissionCount: 0,
    compactionNoticePending: false,
    compactionNoticeSkipNextClear: false,
  };
}

function cloneFlags(flags: GoalRuntimeFlags): GoalRuntimeFlags {
  return {
    ...defaultFlags(),
    ...flags,
    compactionNoticeSkipNextClear: flags.compactionNoticeSkipNextClear ?? false,
  };
}

function newSession(sessionID: string): GoalSessionState {
  return {
    sessionID,
    flags: defaultFlags(),
  };
}

function newGoal(objective: string): GoalRecord {
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    throw new Error("Goal objective cannot be blank");
  }
  const now = Date.now();

  return {
    id: randomUUID(),
    objective: trimmed,
    status: "active",
    createdAt: now,
    updatedAt: now,
    supplements: [],
  };
}

function supplementID(input: SupplementInput, text: string): string {
  return input.messageID ?? createHash("sha256")
    .update(input.source)
    .update(text)
    .digest("hex");
}

function cloneGoal(goal: GoalRecord): GoalRecord {
  return {
    ...goal,
    supplements: goal.supplements.map((supplement) => ({ ...supplement })),
  };
}

function cloneSession(state: GoalSessionState): GoalSessionState {
  const cloned: GoalSessionState = {
    sessionID: state.sessionID,
    flags: cloneFlags(state.flags),
  };

  if (state.goal) {
    cloned.goal = cloneGoal(state.goal);
  }

  return cloned;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export class GoalStore {
  constructor(public readonly filePath: string) {}

  async getSession(sessionID: string): Promise<GoalSessionState> {
    const data = await this.readData();
    const state = data.sessions[sessionID];
    return state ? cloneSession(state) : newSession(sessionID);
  }

  async saveSession(state: GoalSessionState): Promise<GoalSessionState> {
    const data = await this.readData();
    data.sessions[state.sessionID] = cloneSession(state);
    await this.writeData(data);
    return cloneSession(state);
  }

  async createGoal(sessionID: string, objective: string): Promise<GoalSessionState> {
    const data = await this.readData();
    const state = data.sessions[sessionID] ?? newSession(sessionID);
    const existing = state.goal;
    if (existing && existing.status !== "complete" && existing.status !== "dropped") {
      throw new Error("Cannot replace an unfinished goal");
    }

    state.goal = newGoal(objective);
    data.sessions[sessionID] = state;
    await this.writeData(data);
    return cloneSession(state);
  }

  async replaceGoal(sessionID: string, objective: string): Promise<GoalSessionState> {
    const data = await this.readData();
    const state: GoalSessionState = {
      sessionID,
      flags: defaultFlags(),
      goal: newGoal(objective),
    };
    data.sessions[sessionID] = state;
    await this.writeData(data);
    return cloneSession(state);
  }

  async appendSupplement(
    sessionID: string,
    input: SupplementInput,
  ): Promise<GoalSessionState> {
    const data = await this.readData();
    const state = this.requireSession(data, sessionID);
    const goal = state.goal;

    if (!goal || goal.status !== "active") {
      return cloneSession(state);
    }

    // Defense-in-depth: never persist a rendered goal-context block as a
    // supplement (that is what produced the nested <active_goal_context> bug).
    const text = stripGoalContextBlocks(input.text.trim());
    if (!text) {
      return cloneSession(state);
    }
    const id = supplementID(input, text);

    if (!goal.supplements.some((supplement) => supplement.id === id)) {
      const supplement: GoalSupplement = {
        id,
        source: input.source,
        text,
        createdAt: Date.now(),
      };
      if (input.messageID !== undefined) {
        supplement.messageID = input.messageID;
      }
      goal.supplements.push(supplement);
      if (goal.supplements.length > MAX_SUPPLEMENTS) {
        goal.supplements.splice(0, goal.supplements.length - MAX_SUPPLEMENTS);
      }
    }
    state.flags.autoContinuationSuppressed = false;

    await this.writeData(data);
    return cloneSession(state);
  }

  async setFlags(
    sessionID: string,
    patch: GoalRuntimeFlagPatch,
  ): Promise<GoalSessionState> {
    const data = await this.readData();
    const state = this.requireSession(data, sessionID);
    state.flags = {
      ...defaultFlags(),
      ...state.flags,
      ...patch,
    };

    await this.writeData(data);
    return cloneSession(state);
  }

  async updateGoal(sessionID: string, updater: GoalUpdater): Promise<GoalSessionState> {
    const data = await this.readData();
    const state = this.requireSession(data, sessionID);
    const goal = this.requireGoal(state, sessionID);
    const draft = cloneGoal(goal);
    state.goal = updater(draft) ?? draft;

    await this.writeData(data);
    return cloneSession(state);
  }

  private requireSession(data: GoalStoreData, sessionID: string): GoalSessionState {
    const state = data.sessions[sessionID];
    if (!state) {
      throw new Error(`No goal for session ${sessionID}`);
    }
    return state;
  }

  private requireGoal(state: GoalSessionState, sessionID: string): GoalRecord {
    if (!state.goal) {
      throw new Error(`No goal for session ${sessionID}`);
    }
    return state.goal;
  }

  private async readData(): Promise<GoalStoreData> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as GoalStoreData;
    } catch (error) {
      if (isMissingFile(error)) {
        return { sessions: { ...EMPTY_DATA.sessions } };
      }
      throw error;
    }
  }

  private async writeData(data: GoalStoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;

    try {
      await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
}
