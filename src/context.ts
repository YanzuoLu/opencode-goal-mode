import type { GoalSessionState } from "./types";
import { ACTIVE_GOAL_RULES, COMPACTION_NOTICE, escapeXml } from "./prompts";

export type GoalStartAction = "set" | "replace" | "resume";

export const GOAL_START_INSTRUCTIONS: Record<GoalStartAction, string> = {
  set: "Begin working toward the active goal.",
  replace: "Begin working toward the replacement active goal.",
  resume: "Resume working toward the active goal.",
};

export const GOAL_START_SUFFIX =
  'If the goal is now complete, call goal({ op: "complete" }).';

// The kickoff is a short, model-visible nudge ONLY. The full <active_goal_context>
// XML is injected separately every turn via onSystemTransform, so embedding it here
// (as the old implementation did) duplicated the context and — once captured as a
// supplement — produced nested <active_goal_context> blocks. Keeping the kickoff
// XML-free makes that nesting structurally impossible.
export function goalStartPromptText(action: GoalStartAction): string {
  return `${GOAL_START_INSTRUCTIONS[action]}\n${GOAL_START_SUFFIX}`;
}

const GOAL_CONTEXT_BLOCK = /<active_goal_context>[\s\S]*?<\/active_goal_context>/g;

// Remove any rendered goal-context block from arbitrary text. Used both as a guard
// before storing a supplement and at render time to self-heal already-corrupted
// state that contains an embedded context block.
export function stripGoalContextBlocks(text: string): string {
  return text.replace(GOAL_CONTEXT_BLOCK, "").trim();
}

export const GOAL_SNAPSHOT_LABEL =
  "Read-only snapshot — this is the exact goal context the model sees in its system prompt every turn. It is not sent as a new message.";

export function goalSnapshotLabel(context: string): string {
  return `${GOAL_SNAPSHOT_LABEL}\n\n${context}`;
}

export function renderActiveGoalContext(
  state: GoalSessionState,
  options: { includeCompactionNotice?: boolean } = {},
): string | undefined {
  const goal = state.goal;
  if (!goal || goal.status !== "active") return undefined;

  const cleaned = goal.supplements
    .map((item) => ({ item, text: stripGoalContextBlocks(item.text) }))
    .filter((entry) => entry.text.length > 0);
  const supplements = cleaned.length
    ? cleaned
        .map(
          ({ item, text }, index) =>
            `<instruction index="${index + 1}" id="${escapeXml(item.id)}" source="${escapeXml(item.source)}">\n${escapeXml(text)}\n</instruction>`,
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
