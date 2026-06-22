import type { Config } from "@opencode-ai/plugin";
import type { GoalStore } from "./store";
export type GoalSubcommand = "set" | "replace" | "show" | "pause" | "resume" | "drop";
export declare function registerGoalCommand(_config: Config): void;
export declare function parseGoalArgs(args: string): {
    subcommand: GoalSubcommand;
    rest: string;
};
export declare function handleGoalCommand(_input: {
    command: string;
    sessionID: string;
    arguments: string;
}, _output: {
    parts: any[];
}, _store: GoalStore): Promise<void>;
