import type { GoalSessionState } from "./types";
export declare function renderActiveGoalContext(state: GoalSessionState, options?: {
    includeCompactionNotice?: boolean;
}): string | undefined;
export declare function renderContinuationPrompt(state: GoalSessionState): string | undefined;
export declare function renderCompactionContext(state: GoalSessionState): string | undefined;
