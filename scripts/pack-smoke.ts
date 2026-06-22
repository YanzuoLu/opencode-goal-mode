import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
const smokeDir = "/tmp/opencode-goal-smoke";

await $`bun run typecheck`.cwd(root);
await $`bun test`.cwd(root);
await $`bun run build`.cwd(root);
await $`npm pack --dry-run --json`.cwd(root);

await mkdir(smokeDir, { recursive: true });
await writeFile(
  join(smokeDir, "opencode.json"),
  `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      plugin: [[`file://${root.replace(/\/$/, "")}`, { statePath: join(smokeDir, "goal-state.json") }]],
    },
    null,
    2,
  )}\n`,
);

console.log(`Smoke config written to ${join(smokeDir, "opencode.json")}`);
console.log(`Run with: OPENCODE_CONFIG=${join(smokeDir, "opencode.json")} opencode`);
