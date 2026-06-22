import type { Config } from "@opencode-ai/plugin";

import type { GoalStore } from "./store";

export type GoalSubcommand = "set" | "replace" | "show" | "pause" | "resume" | "drop";

const subcommands = new Set<GoalSubcommand>([
  "set",
  "replace",
  "show",
  "pause",
  "resume",
  "drop",
]);

export function registerGoalCommand(_config: Config): void {}

export function parseGoalArgs(args: string): { subcommand: GoalSubcommand; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { subcommand: "show", rest: "" };

  const [first = "", ...restParts] = trimmed.split(/\s+/);
  const lower = first.toLowerCase();
  if (subcommands.has(lower as GoalSubcommand)) {
    return { subcommand: lower as GoalSubcommand, rest: restParts.join(" ").trim() };
  }

  return { subcommand: "set", rest: trimmed };
}

export async function handleGoalCommand(
  _input: { command: string; sessionID: string; arguments: string },
  _output: { parts: any[] },
  _store: GoalStore,
): Promise<void> {}
