export interface GoalPluginOptions {
    statePath: string;
    maxContextBytes: number;
    autoContinue: boolean;
    suppressQuestions: boolean;
}
export declare function parseOptions(input: unknown): GoalPluginOptions;
