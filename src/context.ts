import type { GoalSessionState } from "./types";
import { ACTIVE_GOAL_RULES, COMPACTION_NOTICE, escapeXml } from "./prompts";

export type GoalStartAction = "set" | "replace" | "resume";

export function goalStartPromptText(context: string, action: GoalStartAction): string {
  const instruction = action === "resume"
    ? "Resume working toward the active goal."
    : action === "replace"
      ? "Begin working toward the replacement active goal."
      : "Begin working toward the active goal.";
  return `${context}\n\n${instruction}\nIf the goal is now complete, call goal({ op: "complete" }).`;
}

export function renderActiveGoalContext(
  state: GoalSessionState,
  options: { includeCompactionNotice?: boolean } = {},
): string | undefined {
  const goal = state.goal;
  if (!goal || goal.status !== "active") return undefined;

  const supplements = goal.supplements.length
    ? goal.supplements
        .map(
          (item, index) =>
            `<instruction index="${index + 1}" id="${escapeXml(item.id)}" source="${escapeXml(item.source)}">\n${escapeXml(item.text)}\n</instruction>`,
        )
        .join("\n")
    : "<none />";
  const notice = options.includeCompactionNotice
    ? `\n<compaction_notice>\n${COMPACTION_NOTICE}\n</compaction_notice>`
    : "";

  return `<active_goal_context>\n<objective>\n${escapeXml(goal.objective)}\n</objective>\n\n<supplemental_instructions>\n${supplements}\n</supplemental_instructions>\n\n<rules>\n${ACTIVE_GOAL_RULES.map((rule) => `- ${rule}`).join("\n")}\n</rules>${notice}\n</active_goal_context>`;
}

export function renderContinuationPrompt(state: GoalSessionState): string | undefined {
  if (!state.goal || state.goal.status !== "active") return undefined;

  return [
    "The active goal has not been completed.",
    "Continue making concrete progress toward the active goal using available tools when useful.",
    'If the goal is now complete, call goal({ op: "complete" }) and provide a concise completion summary.',
    "If you cannot make progress without user input, ask exactly what you need and do not call tools just to keep the loop alive.",
  ].join("\n");
}

export function renderCompactionContext(state: GoalSessionState): string | undefined {
  const rendered = renderActiveGoalContext(state);
  if (!rendered) return undefined;

  return `Preserve this active goal context in the conversation summary. Do not omit supplemental instructions.\n\n${rendered}`;
}
