import type { Config } from "@opencode-ai/plugin";

import { renderActiveGoalContext } from "./context";
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

export function registerGoalCommand(config: Config): void {
  config.command ??= {};
  config.command.goal ??= {
    template: "Manage persistent goal mode",
    description: "Create, inspect, pause, resume, or drop a persistent goal",
  };
}

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

function pushText(output: { parts: any[] }, text: string): void {
  output.parts.length = 0;
  output.parts.push({ type: "text", text, ignored: true });
}

export async function handleGoalCommand(
  input: { command: string; sessionID: string; arguments: string },
  output: { parts: any[] },
  store: GoalStore,
): Promise<void> {
  if (input.command !== "goal") return;

  const parsed = parseGoalArgs(input.arguments);
  const session = await store.getSession(input.sessionID);

  if (parsed.subcommand === "set") {
    await store.createGoal(input.sessionID, parsed.rest);
    pushText(output, "Goal mode initialized. Work toward the active goal.");
    return;
  }

  if (parsed.subcommand === "replace") {
    await store.replaceGoal(input.sessionID, parsed.rest);
    pushText(output, "Goal replaced. Work toward the new active goal.");
    return;
  }

  if (parsed.subcommand === "show") {
    const context = renderActiveGoalContext(session, {
      includeCompactionNotice: session.flags.compactionNoticePending,
    });
    pushText(output, context ? `Current goal state:\n\n${context}` : "No active goal.");
    return;
  }

  if (!session.goal) {
    pushText(output, "No goal exists for this session.");
    return;
  }

  if (parsed.subcommand === "pause") {
    await store.updateGoal(input.sessionID, (goal) => {
      if (goal.status === "active") goal.status = "paused";
    });
    pushText(output, "Goal paused. Use /goal resume to continue it.");
    return;
  }

  if (parsed.subcommand === "resume") {
    await store.updateGoal(input.sessionID, (goal) => {
      if (goal.status === "paused") goal.status = "active";
    });
    await store.setFlags(input.sessionID, { autoContinuationSuppressed: false });
    pushText(output, "Goal resumed.");
    return;
  }

  if (parsed.subcommand === "drop") {
    await store.updateGoal(input.sessionID, (goal) => {
      goal.status = "dropped";
      goal.droppedAt = Date.now();
    });
    await store.setFlags(input.sessionID, {
      autoContinuationSuppressed: true,
      continuationInFlight: false,
    });
    pushText(output, "Goal dropped.");
  }
}
