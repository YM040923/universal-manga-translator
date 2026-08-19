import assert from "node:assert/strict";
import { test } from "node:test";
import { createWindowOptions } from "./window-config.js";

test("desktop window is a real software shell with secure preload bridge", () => {
  const options = createWindowOptions("F:/meihua/universal-manga-translator/apps/desktop/dist/preload.cjs");
  assert.equal(options.title, "Universal Manga Translator 桌面控制台");
  assert.ok(options.width >= 1100);
  assert.ok(options.height >= 760);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.match(options.webPreferences.preload, /preload\.cjs$/);
});

test("desktop package config bundles server resources and excludes test files", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  assert.match(pkg.scripts.package, /prepare-package\.mjs/);
  assert.deepEqual(pkg.build.extraResources, [{ from: "dist-server", to: "server", filter: ["**/*", "!data/**"] }]);
  assert.ok(pkg.build.files.includes("dist/main.js"));
  assert.ok(pkg.build.files.includes("dist/preload.cjs"));
  assert.ok(!pkg.build.files.includes("dist/**/*"));
});

