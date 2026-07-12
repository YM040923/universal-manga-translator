import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("@umt/extension test builds workspace dependencies before compiling tests", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "apps", "extension", "package.json"), "utf8"));
  const script = pkg.scripts?.test ?? "";

  assert.match(script, /pnpm --filter @umt\/shared build/);
  assert.match(script, /pnpm --filter @umt\/core build/);
  assert.ok(
    script.indexOf("pnpm --filter @umt/shared build") < script.indexOf("pnpm build:test"),
    "shared must be built before extension test compilation",
  );
  assert.ok(
    script.indexOf("pnpm --filter @umt/core build") < script.indexOf("pnpm build:test"),
    "core must be built before extension test compilation",
  );
});

test("root test:e2e builds the extension before launching browser tests", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const script = pkg.scripts?.["test:e2e"] ?? "";

  assert.match(script, /pnpm --filter @umt\/extension build/);
  assert.match(script, /playwright test tests\/integration/);
  assert.ok(
    script.indexOf("pnpm --filter @umt/extension build") < script.indexOf("playwright test tests/integration"),
    "extension build must happen before Playwright loads apps/extension/dist",
  );
});
