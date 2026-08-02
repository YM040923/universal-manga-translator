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

test("content main wires automatic and manual capture APIs through safe summary logging", () => {
  const main = readFileSync(resolve("src/content/main.ts"), "utf8");

  assert.match(
    main,
    /import\s+\{\s*captureWithRecognitionSummary\s*\}\s+from\s+["']\.\/capture\/recognition-capture-log["'];/,
  );
  assert.match(
    main,
    /captureWithRecognitionSummary\(\s*\(\)\s*=>\s*createSurfaceTaskWithImageDataCapture\(/,
  );
  assert.match(
    main,
    /captureWithRecognitionSummary\(\s*\(\)\s*=>\s*createScreenshotSurfaceCapture\(/,
  );
  assert.equal(main.includes('logger.info("recognition capture"'), false);
});

test("content main does not enable heuristic paid rescue for automatic empty OCR", () => {
  const main = readFileSync(resolve("src/content/main.ts"), "utf8");
  const directClient = readFileSync(resolve("src/content/client/direct-client.ts"), "utf8");

  assert.doesNotMatch(main, /ocr-text-evidence|OcrTextEvidenceProvider|createBrowserOcrTextEvidenceProvider/);
  assert.match(main, /new\s+DirectClient\(current\)/);
  assert.doesNotMatch(main, /new\s+DirectClient\(current\s*,/);
  assert.match(directClient, /Bubble extraction is observation-driven only/);
  assert.match(directClient, /Do not infer likelyTextEvidence from raw pixels/);
  assert.match(directClient, /Bubble-aware reconstruction is limited to the direct extension path/);
  assert.match(directClient, /Legacy server translation remains outside this reconstruction path/);
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
