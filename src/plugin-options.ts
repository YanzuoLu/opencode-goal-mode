import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const schema = z.object({
  statePath: z.string().min(1).optional(),
  maxContextBytes: z.number().int().positive().optional(),
  autoContinue: z.boolean().optional(),
});

export interface GoalPluginOptions {
  statePath: string;
  maxContextBytes: number;
  autoContinue: boolean;
}

export function parseOptions(input: unknown): GoalPluginOptions {
  const parsed = schema.parse(input ?? {});
  return {
    statePath: parsed.statePath ?? join(homedir(), ".local", "share", "opencode-goal", "state.json"),
    maxContextBytes: parsed.maxContextBytes ?? 60000,
    autoContinue: parsed.autoContinue ?? true,
  };
}
