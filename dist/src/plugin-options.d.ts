export interface GoalPluginOptions {
    statePath: string;
    maxContextBytes: number;
    autoContinue: boolean;
    suppressQuestions: boolean;
    deferWhileSubagentsActive: boolean;
    subagentGraceMs: number;
    skipCommandOriginatedSupplements: boolean;
    commandOriginSkipTtlMs: number;
    ignoreSupplementMarkers: string[];
}
export declare function parseOptions(input: unknown): GoalPluginOptions;
