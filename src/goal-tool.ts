import { tool } from "@opencode-ai/plugin/tool";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import { renderActiveGoalContext } from "./context";
import type { GoalStore } from "./store";

const schema = tool.schema;

export function createGoalTool(store: GoalStore): ToolDefinition {
  return tool({
    description: [
      "Inspect or update the goal for this session.",
      "Only relevant after a goal has been started with the /goal command.",
      "If there is no active goal, do not call this tool — there is nothing to complete, pause, drop, or resume.",
      "When a goal is active, call op=complete only once it is actually finished, and do not claim completion without calling it.",
    ].join(" "),
    args: {
      op: schema.enum(["get", "complete", "drop", "pause", "resume"]),
      summary: schema.string().optional(),
    },
    async execute(args, context) {
      const state = await store.getSession(context.sessionID);
      if (!state.goal) return "No goal exists for this session.";

      const current = state.goal;

      if (args.op === "get") {
        return renderActiveGoalContext(state, {
          includeCompactionNotice: state.flags.compactionNoticePending,
        }) ?? "No active goal.";
      }

      if (args.op === "complete") {
        if (current.status !== "active") {
          return `No active goal to complete (current status: ${current.status}). Do not call this tool unless a goal is active.`;
        }
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
        if (current.status !== "active" && current.status !== "paused") {
          return `No in-progress goal to drop (current status: ${current.status}).`;
        }
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
        if (current.status !== "active") {
          return `No active goal to pause (current status: ${current.status}).`;
        }
        await store.updateGoal(context.sessionID, (goal) => {
          if (goal.status === "active") goal.status = "paused";
        });
        await store.setFlags(context.sessionID, { autoContinuationSuppressed: true });
        return "Goal paused.";
      }

      if (current.status !== "paused") {
        return `No paused goal to resume (current status: ${current.status}).`;
      }
      await store.updateGoal(context.sessionID, (goal) => {
        if (goal.status === "paused") goal.status = "active";
      });
      await store.setFlags(context.sessionID, { autoContinuationSuppressed: false });
      return "Goal resumed.";
    },
  });
}
