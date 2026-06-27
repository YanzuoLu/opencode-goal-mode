import { describe, expect, test } from "bun:test";

import { parseOptions } from "./plugin-options";

describe("parseOptions", () => {
  test("uses safe defaults", () => {
    const options = parseOptions(undefined);

    expect(options.maxContextBytes).toBe(60000);
    expect(options.autoContinue).toBe(true);
    expect(options.statePath).toContain("opencode-goal-mode/state.json");
    expect(options.deferWhileSubagentsActive).toBe(true);
    expect(options.subagentGraceMs).toBe(4000);
    expect(options.skipCommandOriginatedSupplements).toBe(true);
    expect(options.commandOriginSkipTtlMs).toBe(15000);
    expect(options.ignoreSupplementMarkers).toEqual([
      "<!-- SLIM_INTERNAL_INITIATOR -->",
      "SENTINEL: background-job-board-v2",
    ]);
  });

  test("accepts explicit values", () => {
    const options = parseOptions({
      statePath: "/tmp/goal.json",
      maxContextBytes: 1234,
      autoContinue: false,
      deferWhileSubagentsActive: false,
      subagentGraceMs: 42,
      skipCommandOriginatedSupplements: false,
      commandOriginSkipTtlMs: 99,
      ignoreSupplementMarkers: ["custom-marker"],
    });

    expect(options.statePath).toBe("/tmp/goal.json");
    expect(options.maxContextBytes).toBe(1234);
    expect(options.autoContinue).toBe(false);
    expect(options.deferWhileSubagentsActive).toBe(false);
    expect(options.subagentGraceMs).toBe(42);
    expect(options.skipCommandOriginatedSupplements).toBe(false);
    expect(options.commandOriginSkipTtlMs).toBe(99);
    expect(options.ignoreSupplementMarkers).toEqual(["custom-marker"]);
  });

  test("rejects invalid values", () => {
    expect(() => parseOptions({ statePath: "" })).toThrow();
    expect(() => parseOptions({ maxContextBytes: 0 })).toThrow();
    expect(() => parseOptions({ maxContextBytes: 1.5 })).toThrow();
    expect(() => parseOptions({ autoContinue: "false" })).toThrow();
    expect(() => parseOptions({ deferWhileSubagentsActive: "false" })).toThrow();
    expect(() => parseOptions({ subagentGraceMs: -1 })).toThrow();
    expect(() => parseOptions({ subagentGraceMs: 1.5 })).toThrow();
    expect(() => parseOptions({ commandOriginSkipTtlMs: -1 })).toThrow();
    expect(() => parseOptions({ commandOriginSkipTtlMs: 1.5 })).toThrow();
    expect(() => parseOptions({ ignoreSupplementMarkers: "marker" })).toThrow();
  });
});
