import { tool } from "@opencode-ai/plugin/tool";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import { renderActiveGoalContext } from "./context";
import type { GoalStore } from "./store";

const schema = tool.schema;

export function createGoalTool(store: GoalStore): ToolDefinition {
  return tool({
    description: [
      "Inspect or update the active goal.",
      "Call op=complete only when the active goal is actually finished.",
      "Do not claim the goal is complete without calling this tool.",
    ].join(" "),
    args: {
      op: schema.enum(["get", "complete", "drop", "pause", "resume"]),
      summary: schema.string().optional(),
    },
    async execute(args, context) {
      const state = await store.getSession(context.sessionID);
      if (!state.goal) return "No goal exists for this session.";

      if (args.op === "get") {
        return renderActiveGoalContext(state, {
          includeCompactionNotice: state.flags.compactionNoticePending,
        }) ?? "No active goal.";
      }

      if (args.op === "complete") {
        await store.updateGoal(context.sessionID, (goal) => {
          goal.status = "complete";
          goal.completedAt = Date.now();
        });
        await store.setFlags(context.sessionID, {
          autoContinuationSuppressed: true,
          continuationInFlight: false,
        });
        return `Goal completed.${args.summary ? ` Summary: ${args.summary}` : ""}`;
      }

      if (args.op === "drop") {
        await store.updateGoal(context.sessionID, (goal) => {
          goal.status = "dropped";
          goal.droppedAt = Date.now();
        });
        await store.setFlags(context.sessionID, {
          autoContinuationSuppressed: true,
          continuationInFlight: false,
        });
        return `Goal dropped.${args.summary ? ` Reason: ${args.summary}` : ""}`;
      }

      if (args.op === "pause") {
        await store.updateGoal(context.sessionID, (goal) => {
          if (goal.status === "active") goal.status = "paused";
        });
        await store.setFlags(context.sessionID, { autoContinuationSuppressed: true });
        return "Goal paused.";
      }

      await store.updateGoal(context.sessionID, (goal) => {
        if (goal.status === "paused") goal.status = "active";
      });
      await store.setFlags(context.sessionID, { autoContinuationSuppressed: false });
      return "Goal resumed.";
    },
  });
}
