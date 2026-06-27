import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const schema = z.object({
  statePath: z.string().min(1).optional(),
  maxContextBytes: z.number().int().positive().optional(),
  autoContinue: z.boolean().optional(),
  suppressQuestions: z.boolean().optional(),
  deferWhileSubagentsActive: z.boolean().optional(),
  subagentGraceMs: z.number().int().nonnegative().optional(),
  skipCommandOriginatedSupplements: z.boolean().optional(),
  commandOriginSkipTtlMs: z.number().int().nonnegative().optional(),
  ignoreSupplementMarkers: z.array(z.string()).optional(),
});

const DEFAULT_IGNORE_SUPPLEMENT_MARKERS = [
  "<!-- SLIM_INTERNAL_INITIATOR -->",
  "SENTINEL: background-job-board-v2",
];

export interface GoalPluginOptions {
  statePath: string;
  maxContextBytes: number;
  autoContinue: boolean;
  suppressQuestions: boolean;
  deferWhileSubagentsActive: boolean;
  subagentGraceMs: number;
  skipCommandOriginatedSupplements: boolean;
  commandOriginSkipTtlMs: number;
  ignoreSupplementMarkers: string[];
}

export function parseOptions(input: unknown): GoalPluginOptions {
  const parsed = schema.parse(input ?? {});
  return {
    statePath: parsed.statePath ?? join(homedir(), ".local", "share", "opencode-goal-mode", "state.json"),
    maxContextBytes: parsed.maxContextBytes ?? 60000,
    autoContinue: parsed.autoContinue ?? true,
    suppressQuestions: parsed.suppressQuestions ?? true,
    deferWhileSubagentsActive: parsed.deferWhileSubagentsActive ?? true,
    subagentGraceMs: parsed.subagentGraceMs ?? 4000,
    skipCommandOriginatedSupplements: parsed.skipCommandOriginatedSupplements ?? true,
    commandOriginSkipTtlMs: parsed.commandOriginSkipTtlMs ?? 15000,
    ignoreSupplementMarkers: parsed.ignoreSupplementMarkers ?? DEFAULT_IGNORE_SUPPLEMENT_MARKERS,
  };
}
