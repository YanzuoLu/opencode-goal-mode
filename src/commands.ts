import type { Config } from "@opencode-ai/plugin";

import { goalStartPromptText } from "./context";
import type { GoalStore } from "./store";

export type GoalSubcommand = "menu" | "set" | "replace" | "resume" | "show" | "pause" | "drop";

// Inline subcommands that drive the model (they legitimately start a turn).
const inlineSubcommands = new Set<GoalSubcommand>(["set", "replace", "resume"]);

// UI-only actions. opencode always issues a model turn for an inline command
// (the command path has no noReply), so these would each fire a spurious,
// context-free turn. They live only in /goal-menu, which uses turn-free client
// actions. Reserved here so `/goal show` is not mistaken for a new objective.
const menuOnlySubcommands = new Set<GoalSubcommand>(["show", "pause", "drop"]);

type GoalCommandOutput = { parts: any[]; noReply?: boolean };

export function registerGoalCommand(config: Config): void {
  config.command = Object.assign({}, config.command, {
    goal: {
      // Empty template: opencode appends the raw arguments to the user message, so
      // a non-empty template (the old "Manage persistent goal mode") only leaked
      // noise into the model's context. The kickoff/UI text is supplied via the
      // command.execute.before parts instead.
      template: "",
      description: "Manage the active goal",
    },
  });
}

export function parseGoalArgs(args: string): { subcommand: GoalSubcommand; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { subcommand: "menu", rest: "" };

  const [first = "", ...restParts] = trimmed.split(/\s+/);
  const lower = first.toLowerCase() as GoalSubcommand;
  if (inlineSubcommands.has(lower) || menuOnlySubcommands.has(lower)) {
    return { subcommand: lower, rest: restParts.join(" ").trim() };
  }

  return { subcommand: "set", rest: trimmed };
}

function pushVisibleGoalPrompt(output: { parts: any[] }, text: string): void {
  output.parts.push({ type: "text", text });
}

function setUiOnly(output: GoalCommandOutput, text: string): void {
  // opencode pre-populates output.parts with the raw command arguments (e.g. the
  // "show"/"pause"/"drop" keyword) before this hook runs. Those are model-visible
  // and would trigger a model turn, so drop them and keep only the ignored UI part.
  output.parts.length = 0;
  output.parts.push({ type: "text", text, ignored: true });
  output.noReply = true;
}

function uiStatus(action: string): string {
  return `▣ Goal Mode | UI-only status\nThis message is not sent to the model.\n\nAction: ${action}`;
}

function uiMenuOnly(subcommand: string): string {
  return `▣ Goal Mode | UI-only status\nThis message is not sent to the model.\n\n"${subcommand}" is available in /goal-menu. The inline /goal command only handles set, replace, and resume.`;
}

async function pushGoalStartPrompt(
  sessionID: string,
  output: GoalCommandOutput,
  store: GoalStore,
  action: "set" | "replace" | "resume",
): Promise<void> {
  const state = await store.getSession(sessionID);
  if (!state.goal || state.goal.status !== "active") {
    setUiOnly(output, uiStatus("no active goal"));
    return;
  }

  // Short, XML-free kickoff. The full context is injected every turn by
  // onSystemTransform; onChatMessage skips this message via GOAL_START_SUFFIX so
  // it is never captured as a supplement.
  pushVisibleGoalPrompt(output, goalStartPromptText(action));
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

    // show / pause / drop: UI-only actions, available only in /goal-menu.
    setUiOnly(output, uiMenuOnly(parsed.subcommand));
  } catch (error) {
    setUiOnly(output, uiStatus(error instanceof Error ? error.message : String(error)));
  }
}
