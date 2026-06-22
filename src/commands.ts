import type { Config } from "@opencode-ai/plugin";

import { goalStartPromptText, renderActiveGoalContext } from "./context";
import type { GoalStore } from "./store";

export type GoalSubcommand = "menu" | "set" | "replace" | "show" | "pause" | "resume" | "drop";

const subcommands = new Set<GoalSubcommand>([
  "set",
  "replace",
  "show",
  "pause",
  "resume",
  "drop",
]);

type GoalCommandOutput = { parts: any[]; noReply?: boolean };

export function registerGoalCommand(config: Config): void {
  config.command = Object.assign({}, config.command, {
    goal: {
      template: "Manage persistent goal mode",
      description: "Manage the active goal",
    },
  });
}

export function parseGoalArgs(args: string): { subcommand: GoalSubcommand; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { subcommand: "menu", rest: "" };

  const [first = "", ...restParts] = trimmed.split(/\s+/);
  const lower = first.toLowerCase();
  if (subcommands.has(lower as GoalSubcommand)) {
    return { subcommand: lower as GoalSubcommand, rest: restParts.join(" ").trim() };
  }

  return { subcommand: "set", rest: trimmed };
}

function pushVisibleGoalPrompt(output: { parts: any[] }, text: string): void {
  output.parts.push({ type: "text", text });
}

function setUiOnly(output: GoalCommandOutput, text: string): void {
  output.parts.push({ type: "text", text, ignored: true });
  output.noReply = true;
}

function uiStatus(action: string): string {
  return `▣ Goal Mode | UI-only status\nThis message is not sent to the model.\n\nAction: ${action}`;
}

function uiSnapshot(context: string): string {
  return `▣ Goal Mode | UI-only goal snapshot\nThis message is not sent to the model.\n\n${context}`;
}

async function pushGoalStartPrompt(
  sessionID: string,
  output: GoalCommandOutput,
  store: GoalStore,
  action: "set" | "replace" | "resume",
): Promise<void> {
  const state = await store.getSession(sessionID);
  const context = renderActiveGoalContext(state);
  if (!context) {
    setUiOnly(output, uiStatus("no active goal"));
    return;
  }

  const text = goalStartPromptText(context, action);
  await store.setFlags(sessionID, {
    ignoredInputTexts: [...state.flags.ignoredInputTexts, text],
  });
  pushVisibleGoalPrompt(output, text);
}

export async function handleGoalCommand(
  input: { command: string; sessionID: string; arguments: string },
  output: GoalCommandOutput,
  store: GoalStore,
): Promise<void> {
  if (input.command !== "goal") return;

  const parsed = parseGoalArgs(input.arguments);
  if (parsed.subcommand === "menu") return;

  try {
    if (parsed.subcommand === "set") {
      if (!parsed.rest) {
        setUiOnly(output, uiStatus("Goal objective cannot be blank"));
        return;
      }

      await store.createGoal(input.sessionID, parsed.rest);
      await pushGoalStartPrompt(input.sessionID, output, store, "set");
      return;
    }

    if (parsed.subcommand === "replace") {
      if (!parsed.rest) {
        setUiOnly(output, uiStatus("Goal objective cannot be blank"));
        return;
      }

      await store.replaceGoal(input.sessionID, parsed.rest);
      await pushGoalStartPrompt(input.sessionID, output, store, "replace");
      return;
    }

    if (parsed.subcommand === "resume") {
      const state = await store.getSession(input.sessionID);
      if (!state.goal || (state.goal.status !== "active" && state.goal.status !== "paused")) {
        setUiOnly(output, uiStatus("no active goal"));
        return;
      }

      if (state.goal.status === "paused") {
        await store.updateGoal(input.sessionID, (goal) => {
          goal.status = "active";
          goal.updatedAt = Date.now();
        });
      }
      await store.setFlags(input.sessionID, { autoContinuationSuppressed: false });
      await pushGoalStartPrompt(input.sessionID, output, store, "resume");
      return;
    }

    if (parsed.subcommand === "show") {
      const state = await store.getSession(input.sessionID);
      const context = renderActiveGoalContext(state);
      setUiOnly(output, context ? uiSnapshot(context) : uiStatus("no active goal"));
      return;
    }

    if (parsed.subcommand === "pause") {
      const state = await store.getSession(input.sessionID);
      if (!state.goal || state.goal.status !== "active") {
        setUiOnly(output, uiStatus("no active goal"));
        return;
      }

      await store.updateGoal(input.sessionID, (goal) => {
        goal.status = "paused";
        goal.updatedAt = Date.now();
      });
      await store.setFlags(input.sessionID, { autoContinuationSuppressed: true });
      setUiOnly(output, uiStatus("paused"));
      return;
    }

    const state = await store.getSession(input.sessionID);
    if (!state.goal || (state.goal.status !== "active" && state.goal.status !== "paused")) {
      setUiOnly(output, uiStatus("no active goal"));
      return;
    }

    await store.updateGoal(input.sessionID, (goal) => {
      goal.status = "dropped";
      goal.droppedAt = Date.now();
      goal.updatedAt = Date.now();
    });
    await store.setFlags(input.sessionID, {
      autoContinuationSuppressed: true,
      continuationInFlight: false,
    });
    setUiOnly(output, uiStatus("dropped"));
  } catch (error) {
    setUiOnly(output, uiStatus(error instanceof Error ? error.message : String(error)));
  }
}
