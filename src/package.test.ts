import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type PackageJson = {
  name?: string;
  repository?: {
    url?: string;
  };
  types?: string;
  exports?: {
    "."?: {
      types?: string;
    };
  };
};

test("package metadata uses the non-conflicting GitHub release name", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.name).toBe("opencode-goal-mode");
  expect(pkg.repository?.url).toBe("git+https://github.com/YanzuoLu/opencode-goal-mode.git");
});

test("package metadata points to emitted declaration file", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.types).toBe("dist/src/index.d.ts");
  expect(pkg.exports?.["."]?.types).toBe("./dist/src/index.d.ts");
});
