import { describe, expect, test } from "bun:test";

import { parseOptions } from "./plugin-options";

describe("parseOptions", () => {
  test("uses safe defaults", () => {
    const options = parseOptions(undefined);

    expect(options.maxContextBytes).toBe(60000);
    expect(options.autoContinue).toBe(true);
    expect(options.statePath).toContain("opencode-goal/state.json");
  });

  test("accepts explicit values", () => {
    const options = parseOptions({
      statePath: "/tmp/goal.json",
      maxContextBytes: 1234,
      autoContinue: false,
    });

    expect(options.statePath).toBe("/tmp/goal.json");
    expect(options.maxContextBytes).toBe(1234);
    expect(options.autoContinue).toBe(false);
  });

  test("rejects invalid values", () => {
    expect(() => parseOptions({ statePath: "" })).toThrow();
    expect(() => parseOptions({ maxContextBytes: 0 })).toThrow();
    expect(() => parseOptions({ maxContextBytes: 1.5 })).toThrow();
    expect(() => parseOptions({ autoContinue: "false" })).toThrow();
  });
});
