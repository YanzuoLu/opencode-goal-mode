import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const session = "opencode-goal-smoke";
const smokeDir = "/tmp/opencode-goal-smoke";
const configPath = join(smokeDir, "opencode.json");
const statePath = join(smokeDir, "goal-state.json");

async function sh(strings: TemplateStringsArray, ...values: string[]) {
  return await $(strings, ...values).quiet();
}

await $`bun run typecheck`.cwd(root);
await $`bun test`.cwd(root);
await $`bun run build`.cwd(root);

await mkdir(smokeDir, { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      plugin: [[`file://${root}`, { statePath }]],
    },
    null,
    2,
  )}\n`,
);

await sh`tmux kill-session -t ${session}`.catch(() => undefined);
await sh`tmux new-session -d -s ${session} -c ${smokeDir} env OPENCODE_CONFIG=${configPath} opencode`;
await Bun.sleep(4000);

await sh`tmux send-keys -t ${session} /goal Space "Create GOAL_SMOKE.md with the text goal-smoke-ok, then call the goal tool complete." Enter`;
await Bun.sleep(12000);
await sh`tmux send-keys -t ${session} /goal Space show Enter`;
await Bun.sleep(3000);

const capture = (await sh`tmux capture-pane -p -t ${session}`).text();
console.log(capture);

if (!capture.includes("Goal") && !capture.includes("goal")) {
  throw new Error("tmux smoke did not show goal output");
}

console.log(`tmux session left running: ${session}`);
console.log(`state path: ${statePath}`);
