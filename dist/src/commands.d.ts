import type { Config } from "@opencode-ai/plugin";
import type { GoalStore } from "./store";
export type GoalSubcommand = "menu" | "set" | "replace" | "resume" | "show" | "pause" | "drop";
type GoalCommandOutput = {
    parts: any[];
    noReply?: boolean;
};
export declare function registerGoalCommand(config: Config): void;
export declare function parseGoalArgs(args: string): {
    subcommand: GoalSubcommand;
    rest: string;
};
export declare function handleGoalCommand(input: {
    command: string;
    sessionID: string;
    arguments: string;
}, output: GoalCommandOutput, store: GoalStore): Promise<void>;
export {};
