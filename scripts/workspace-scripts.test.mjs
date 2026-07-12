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

test("root qa:extension builds the extension before launching manual QA", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const script = pkg.scripts?.["qa:extension"] ?? "";

  assert.match(script, /pnpm --filter @umt\/extension build/);
  assert.match(script, /node scripts\/qa-extension-load\.mjs/);
  assert.ok(
    script.indexOf("pnpm --filter @umt/extension build") < script.indexOf("node scripts/qa-extension-load.mjs"),
    "extension build must happen before QA loads apps/extension/dist",
  );
});

test("QA extension loader does not require backend health in plugin-only mode", () => {
  const script = readFileSync(path.join(root, "scripts", "qa-extension-load.mjs"), "utf8");

  assert.match(script, /runMode/);
  assert.match(script, /direct/);
  assert.ok(
    script.indexOf('if (runMode === "backend")') < script.indexOf('check("backend-reachable"'),
    "backend health check must be guarded behind backend run mode",
  );
});

test("QA extension loader enables the domain from the requested QA URL", () => {
  const script = readFileSync(path.join(root, "scripts", "qa-extension-load.mjs"), "utf8");

  assert.match(script, /qaDomain/);
  assert.match(script, /primaryDomainFromUrl/);
  assert.doesNotMatch(script, /enabledSites:\s*\{\s*"asurascans\.com":\s*true\s*\}/);
});

test("QA extension loader uses generic OCR environment names only", () => {
  const script = readFileSync(path.join(root, "scripts", "qa-extension-load.mjs"), "utf8");

  assert.match(script, /OCR_API_KEYS/);
  assert.doesNotMatch(script, /UAPIS|BAIDU|uapis|baidu/);
});

test("QA extension loader has a help mode that exits before launching Chrome", () => {
  const script = readFileSync(path.join(root, "scripts", "qa-extension-load.mjs"), "utf8");

  assert.match(script, /args\.has\("help"\)/);
  assert.match(script, /printHelp\(\)/);
  assert.match(script, /process\.exit\(0\)/);
  assert.ok(
    script.indexOf('args.has("help")') < script.indexOf("chromium.launchPersistentContext"),
    "help mode must be handled before Playwright launches Chrome",
  );
  assert.match(script, /--configure-direct=true/);
  assert.match(script, /--run-mode=backend/);
  assert.match(script, /qa-output\/extension-qa-report\.json/);
});

test("release version is consistent across root package, extension package, and manifest", () => {
  const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const extensionPkg = JSON.parse(readFileSync(path.join(root, "apps", "extension", "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(root, "apps", "extension", "public", "manifest.json"), "utf8"));

  assert.match(rootPkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(extensionPkg.version, rootPkg.version);
  assert.equal(manifest.version, rootPkg.version);
});
