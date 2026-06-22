export interface GoalPluginOptions {
    statePath: string;
    maxContextBytes: number;
    autoContinue: boolean;
}
export declare function parseOptions(input: unknown): GoalPluginOptions;
