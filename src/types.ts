export type GoalStatus = "active" | "paused" | "complete" | "dropped";

export type SupplementSource = "user" | "queued-user";

export interface GoalRuntimeFlags {
  continuationInFlight: boolean;
  continuationAssistantMessageID?: string;
  turnHadToolCalls: boolean;
  autoContinuationSuppressed: boolean;
  pendingQuestionCount: number;
  pendingPermissionCount: number;
  compactionNoticePending: boolean;
  compactionNoticeSkipNextClear: boolean;
  ignoredInputTexts: string[];
}

export interface GoalSupplement {
  id: string;
  messageID?: string;
  source: SupplementSource;
  text: string;
  createdAt: number;
}

export interface GoalRecord {
  id: string;
  objective: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  supplements: GoalSupplement[];
  completedAt?: number;
  droppedAt?: number;
}

export interface GoalSessionState {
  sessionID: string;
  flags: GoalRuntimeFlags;
  seenUserMessageIDs: string[];
  goal?: GoalRecord;
}

export interface GoalStoreData {
  sessions: Record<string, GoalSessionState>;
}

export type GoalRuntimeFlagPatch = Partial<GoalRuntimeFlags>;

export type GoalUpdater = (goal: GoalRecord) => GoalRecord | void;

export interface SupplementInput {
  messageID?: string;
  source: SupplementSource;
  text: string;
}
