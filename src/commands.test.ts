import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleGoalCommand, parseGoalArgs, registerGoalCommand } from "./commands";
import { GoalStore } from "./store";

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "opencode-goal-command-"));
  return new GoalStore(join(dir, "state.json"));
}

describe("goal commands", () => {
  test("does not register a server slash command", () => {
    const config: any = {};

    registerGoalCommand(config);

    expect(config.command?.goal).toBeUndefined();
  });

  test("parses bare objective as set", () => {
    expect(parseGoalArgs("Ship the plugin")).toEqual({
      subcommand: "set",
      rest: "Ship the plugin",
    });
    expect(parseGoalArgs("pause")).toEqual({ subcommand: "pause", rest: "" });
  });

  test("goal commands pass through unchanged", async () => {
    const s = await store();
    const existingParts = [{ type: "text", text: "existing" }];
    const output: any = { parts: [...existingParts] };

    await handleGoalCommand({ command: "goal", sessionID: "s1", arguments: "Ship it" }, output, s);

    expect(output.parts).toEqual(existingParts);
    expect((await s.getSession("s1")).goal).toBeUndefined();
  });

  test("non-goal commands pass through unchanged", async () => {
    const s = await store();
    const output: any = { parts: [{ type: "text", text: "existing" }] };

    await handleGoalCommand({ command: "other", sessionID: "s1", arguments: "Ship it" }, output, s);

    expect(output.parts).toEqual([{ type: "text", text: "existing" }]);
    expect((await s.getSession("s1")).goal).toBeUndefined();
  });
});
