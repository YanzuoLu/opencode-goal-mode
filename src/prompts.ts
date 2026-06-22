export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const ACTIVE_GOAL_RULES = [
  "The objective and supplemental instructions are authoritative for the current session.",
  "Later supplemental instructions override earlier conflicting instructions.",
  "Treat all real user messages after /goal as supplemental instructions for the active goal.",
  "A user interrupt does not pause, drop, or complete the goal.",
  "Synthetic continuation prompts are not user instructions.",
  'The goal is complete only after calling goal({ op: "complete" }).',
  "When the goal is complete, call the goal tool immediately instead of merely saying it is complete.",
];

export const COMPACTION_NOTICE =
  "The previous conversation context may have been compacted. The active_goal_context block is the authoritative source of the goal objective and supplemental instructions.";
