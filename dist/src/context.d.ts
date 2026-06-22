import type { GoalSessionState } from "./types";
export type GoalStartAction = "set" | "replace" | "resume";
export declare function goalStartPromptText(context: string, action: GoalStartAction): string;
export declare function renderActiveGoalContext(state: GoalSessionState, options?: {
    includeCompactionNotice?: boolean;
}): string | undefined;
export declare function renderContinuationPrompt(state: GoalSessionState): string | undefined;
export declare function renderCompactionContext(state: GoalSessionState): string | undefined;
