import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");

test("@umt/extension test builds workspace dependencies before compiling tests", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "apps", "extension", "package.json"), "utf8"));
  const script = pkg.scripts?.test ?? "";
  const buildTestScript = pkg.scripts?.["build:test"] ?? "";

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
  assert.match(buildTestScript, /rmSync\(['"]dist-test['"],\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  assert.ok(
    buildTestScript.indexOf("rmSync") < buildTestScript.indexOf("tsc -p tsconfig.test.json"),
    "dist-test must be cleared before extension tests compile",
  );
});

test("@umt/extension build:test removes stale compiled suites before tsc", () => {
  const stale = path.join(root, "apps", "extension", "dist-test", "content", "capture", "ocr-text-evidence.test.js");
  mkdirSync(path.dirname(stale), { recursive: true });
  writeFileSync(stale, "throw new Error('stale heuristic suite executed');\n", "utf8");
  try {
    const result = spawnSync("pnpm --filter @umt/extension build:test", {
      cwd: root,
      encoding: "utf8",
      shell: true,
      timeout: 60_000,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, output);
    assert.equal(existsSync(stale), false, "deleted ocr-text-evidence source must not leave stale compiled tests");
  } finally {
    rmSync(stale, { force: true });
  }
});

test("@umt/core standard test command maps every source suite without a fixed count", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "packages", "core", "package.json"), "utf8"));
  const script = pkg.scripts?.test ?? "";
  const runner = readFileSync(path.join(root, "packages", "core", "scripts", "run-tests.mjs"), "utf8");

  assert.match(script, /node scripts\/run-tests\.mjs/);
  assert.doesNotMatch(script, /dist\/\*\*\/\*\.test\.js/);
  assert.doesNotMatch(runner, /minimumTestCount|78/);
  assert.match(runner, /src/);
  assert.match(runner, /\.test\.ts/);
  assert.match(runner, /existsSync/);

  const result = spawnSync("pnpm --filter @umt/core test", {
    cwd: root,
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST"))),
    shell: true,
    timeout: 60_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.equal(result.status, 0, output);
  const expectedSuiteCount = findFiles(path.join(root, "packages", "core", "src"), ".test.ts").length;
  const suiteCount = Number(output.match(/CORE_TEST_SUITE_COUNT=(\d+)/)?.[1] ?? 0);
  const testCount = Number(output.match(/CORE_TEST_COUNT=(\d+)/)?.[1] ?? 0);
  assert.equal(suiteCount, expectedSuiteCount, output);
  assert.equal(testCount > 0, true, output);
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

test("root release:check runs the complete local release gate", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const script = pkg.scripts?.["release:check"] ?? "";

  for (const command of [
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:e2e",
    "pnpm package:extension",
    "pnpm verify:release",
  ]) {
    assert.match(script, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.ok(script.indexOf("pnpm typecheck") < script.indexOf("pnpm test"), "typecheck should run before tests");
  assert.ok(script.indexOf("pnpm test") < script.indexOf("pnpm test:e2e"), "unit tests should run before browser smoke tests");
  assert.ok(script.indexOf("pnpm test:e2e") < script.indexOf("pnpm package:extension"), "browser smoke tests should run before packaging");
  assert.ok(script.indexOf("pnpm package:extension") < script.indexOf("pnpm verify:release"), "release assets should be verified after packaging");
});

function findFiles(directory, suffix) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(absolute, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(absolute);
  }
  return files;
}
