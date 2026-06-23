import type { GoalSessionState } from "./types";
export type GoalStartAction = "set" | "replace" | "resume";
export declare const GOAL_START_INSTRUCTIONS: Record<GoalStartAction, string>;
export declare const GOAL_START_SUFFIX = "If the goal is now complete, call goal({ op: \"complete\" }).";
export declare function goalStartPromptText(action: GoalStartAction): string;
export declare function stripGoalContextBlocks(text: string): string;
export declare const GOAL_SNAPSHOT_LABEL = "Read-only snapshot \u2014 this is the exact goal context the model sees in its system prompt every turn. It is not sent as a new message.";
export declare function goalSnapshotLabel(context: string): string;
export declare function renderActiveGoalContext(state: GoalSessionState, options?: {
    includeCompactionNotice?: boolean;
}): string | undefined;
export declare function renderContinuationPrompt(state: GoalSessionState): string | undefined;
export declare function renderCompactionContext(state: GoalSessionState): string | undefined;
