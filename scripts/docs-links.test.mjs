import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("README documents plugin-only mode, advanced desktop mode, API keys, and local OCR HTTP", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const phrase of [
    "插件直连模式",
    "高级桌面/后端模式",
    "API Key",
    "本地 OCR HTTP",
    "chrome://extensions",
    "apps/extension/dist",
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(phrase)), phrase);
  }
});

test("local OCR and API template docs exist and contain required mapping guidance", () => {
  for (const relative of ["docs/local-ocr-http.md", "docs/api-templates.md"]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
  }
  const localOcr = fs.readFileSync(path.join(root, "docs/local-ocr-http.md"), "utf8");
  assert.match(localOcr, /http:\/\/127\.0\.0\.1/i);
  assert.match(localOcr, /image_base64|file/);
  assert.match(localOcr, /regionsPaths/);

  const templates = fs.readFileSync(path.join(root, "docs/api-templates.md"), "utf8");
  assert.match(templates, /OCR API URL/);
  assert.match(templates, /regionsPaths/);
  assert.match(templates, /textPaths/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
