import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("README presents plugin-only mode as the main user product", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const phrase of [
    "纯插件版",
    "不需要桌面端",
    "不需要本地后端",
    "chrome://extensions",
    "apps/extension/dist",
    "API Key",
    "自检",
    "本地 OCR HTTP",
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(phrase)), phrase);
  }
  assert.equal(readme.indexOf("## 快速开始：纯插件版") >= 0, true);
  assert.equal(readme.indexOf("## 高级/实验：后端和桌面端") > readme.indexOf("## 快速开始：纯插件版"), true);
});

test("release checklist prioritizes extension zip instead of desktop packaging", () => {
  const checklist = fs.readFileSync(path.join(root, "docs/release-checklist.md"), "utf8");
  assert.match(checklist, /extension-release\.zip/);
  assert.match(checklist, /apps\/extension\/dist/);
  assert.match(checklist, /Desktop\/backend.*advanced/i);
});

test("release artifacts are ignored instead of committed", () => {
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^release\/$/m);
});

test("public examples use generic placeholders instead of a bundled OCR vendor", () => {
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(envExample, /OCR_API_URL=https:\/\/example\.com\/ocr/);
  assert.doesNotMatch(envExample, /uapis\.cn|baidu/i);
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
