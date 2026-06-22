import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type PackageJson = {
  types?: string;
  exports?: {
    "."?: {
      types?: string;
    };
  };
};

test("package metadata points to emitted declaration file", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;

  expect(pkg.types).toBe("dist/src/index.d.ts");
  expect(pkg.exports?.["."]?.types).toBe("./dist/src/index.d.ts");
});
