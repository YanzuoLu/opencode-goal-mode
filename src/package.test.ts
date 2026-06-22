import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type PackageJson = {
  name?: string;
  version?: string;
  repository?: {
    url?: string;
  };
  scripts?: Record<string, string>;
  types?: string;
  exports?: {
    "."?: {
      import?: string;
      types?: string;
    };
    "./tui"?: {
      import?: string;
      types?: string;
    };
  };
};

test("package metadata uses the non-conflicting GitHub release name", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.name).toBe("opencode-goal-mode");
  expect(pkg.repository?.url).toBe("git+https://github.com/YanzuoLu/opencode-goal-mode.git");
});

test("package metadata declares release version 0.1.5", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.version).toBe("0.1.5");
});

test("package metadata points to emitted declaration file", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.types).toBe("dist/src/index.d.ts");
  expect(pkg.exports?.["."]?.types).toBe("./dist/src/index.d.ts");
});

test("package metadata exports the TUI plugin entrypoint", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.exports?.["./tui"]?.import).toBe("./dist/tui.js");
  expect(pkg.exports?.["./tui"]?.types).toBe("./dist/src/tui.d.ts");
});

test("package metadata avoids npm git dependency preparation lifecycle", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.scripts?.build).toBeUndefined();
  expect(pkg.scripts?.compile).toContain("bun build src/index.ts");
  expect(pkg.scripts?.compile).toContain("src/tui.ts");
});

test("README documents pinned server and TUI plugin install entries", async () => {
  const readme = await readFile("README.md", "utf8");

  expect(readme).toContain("opencode.json");
  expect(readme).toContain("tui.json");
  expect(readme).toContain("https://opencode.ai/tui.json");
  expect(readme).toContain("opencode-goal-mode@git+https://github.com/YanzuoLu/opencode-goal-mode.git#v0.1.5");
  expect(readme).not.toContain("#v0.1.4");
  expect(readme).not.toContain("#v0.1.3");
  expect(readme).not.toContain("#v0.1.2");
  expect(readme).toContain("/goal <objective>");
  expect(readme).toContain("/goal show");
  expect(readme).toContain("/goal pause");
  expect(readme).toContain("/goal drop");
  expect(readme).toContain("This message is not sent to the model.");

  const tuiBlock = readme.match(/Pin the TUI plugin in `tui\.json`[\s\S]*?```json\n([\s\S]*?)\n```/);
  expect(tuiBlock).not.toBeNull();
  expect(tuiBlock?.[1]).toContain('"$schema": "https://opencode.ai/tui.json"');
  expect(tuiBlock?.[1]).not.toContain('"$schema": "https://opencode.ai/config.json"');
});
