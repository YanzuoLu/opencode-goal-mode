import type { Config } from "@opencode-ai/plugin";
import type { GoalStore } from "./store";
export type GoalSubcommand = "set" | "replace" | "show" | "pause" | "resume" | "drop";
export declare function registerGoalCommand(config: Config): void;
export declare function parseGoalArgs(args: string): {
    subcommand: GoalSubcommand;
    rest: string;
};
export declare function handleGoalCommand(input: {
    command: string;
    sessionID: string;
    arguments: string;
}, output: {
    parts: any[];
}, store: GoalStore): Promise<void>;
