import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");

test("extension build emits MV3 assets", () => {
  assert.equal(existsSync(resolve(dist, "manifest.json")), true);
  assert.equal(existsSync(resolve(dist, "content.js")), true);
  assert.equal(existsSync(resolve(dist, "background.js")), true);
  assert.equal(existsSync(resolve(dist, "options.html")), false);
  assert.equal(existsSync(resolve(dist, "options.js")), false);
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

test("manifest uses dynamic injection and does not expose an options page", () => {
  const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
  assert.equal(manifest.host_permissions.includes("<all_urls>"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.options_page, undefined);
});

test("popup shell is compact and every emitted relative import exists", () => {
  const popup = readFileSync(resolve(dist, "popup.html"), "utf8");
  assert.equal(/min-width:\s*390px/.test(popup), false);
  assert.equal(/min-height:\s*560px/.test(popup), false);
  assert.match(popup, /width:\s*320px/);

  for (const scriptName of ["popup.js", "background.js"]) {
    const script = readFileSync(resolve(dist, scriptName), "utf8");
    for (const match of script.matchAll(/from\s*["'](\.\/[^"']+)["']/g)) {
      assert.equal(existsSync(resolve(dist, match[1])), true, `${scriptName} imports missing asset ${match[1]}`);
    }
  }
});
