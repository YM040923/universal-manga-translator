import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");

test("extension build emits MV3 assets", () => {
  assert.equal(existsSync(resolve(dist, "manifest.json")), true);
  assert.equal(existsSync(resolve(dist, "content.js")), true);
  assert.equal(existsSync(resolve(dist, "background.js")), true);
  assert.equal(existsSync(resolve(dist, "options.html")), true);
  assert.equal(existsSync(resolve(dist, "options.js")), true);
  assert.equal(existsSync(resolve(dist, "popup.html")), true);
  assert.equal(existsSync(resolve(dist, "popup.js")), true);
});

test("manifest action points at popup html", () => {
  const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
  assert.equal(manifest.action.default_popup, "popup.html");
});

test("content script build is a classic script without static module imports", () => {
  const content = readFileSync(resolve(dist, "content.js"), "utf8");
  assert.equal(/(^|[;\n\r])\s*import\s*(?:\{|[\w*])/m.test(content), false);
  assert.equal(/import\(/.test(content), false);
});
