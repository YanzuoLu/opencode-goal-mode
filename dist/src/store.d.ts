import type { GoalRuntimeFlagPatch, GoalSessionState, GoalUpdater, SupplementInput } from "./types";
export type { GoalRecord, GoalRuntimeFlagPatch, GoalRuntimeFlags, GoalSessionState, GoalStatus, GoalStoreData, GoalSupplement, GoalUpdater, SupplementInput, SupplementSource, } from "./types";
export declare class GoalStore {
    readonly filePath: string;
    constructor(filePath: string);
    getSession(sessionID: string): Promise<GoalSessionState>;
    saveSession(state: GoalSessionState): Promise<GoalSessionState>;
    createGoal(sessionID: string, objective: string): Promise<GoalSessionState>;
    replaceGoal(sessionID: string, objective: string): Promise<GoalSessionState>;
    appendSupplement(sessionID: string, input: SupplementInput): Promise<GoalSessionState>;
    setFlags(sessionID: string, patch: GoalRuntimeFlagPatch): Promise<GoalSessionState>;
    updateGoal(sessionID: string, updater: GoalUpdater): Promise<GoalSessionState>;
    private requireSession;
    private requireGoal;
    private readData;
    private writeData;
}
