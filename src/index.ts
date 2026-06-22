import type { Plugin } from "@opencode-ai/plugin";

import { createGoalTool } from "./goal-tool";
import { parseOptions } from "./plugin-options";
import { GoalRuntimeHooks } from "./runtime";
import { GoalStore } from "./store";

const plugin: Plugin = async (input, rawOptions) => {
  const options = parseOptions(rawOptions);
  const store = new GoalStore(options.statePath);
  const runtime = new GoalRuntimeHooks(store, input.client, options);

  return {
    tool: {
      goal: createGoalTool(store),
    },
    "chat.message": async (input, output) => {
      await runtime.onChatMessage(input, output);
    },
    "experimental.chat.system.transform": async (input, output) => {
      await runtime.onSystemTransform(input, output);
    },
    "experimental.session.compacting": async (input, output) => {
      await runtime.onCompacting(input, output);
    },
    "experimental.compaction.autocontinue": async (input, output) => {
      await runtime.onCompactionAutocontinue(input, output);
    },
    event: async (input) => {
      await runtime.onEvent(input);
    },
  };
};

export default plugin;
