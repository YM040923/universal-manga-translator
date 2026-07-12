import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("README presents plugin-only mode as the main user product", () => {
  const readme = read("README.md");
  for (const phrase of [
    "纯插件版",
    "不需要桌面端",
    "不需要本地后端",
    "chrome://extensions",
    "apps/extension/dist",
    "API Key",
    "自检",
    "本地 OCR HTTP",
  ]) assertIncludes(readme, phrase);

  assert.equal(readme.indexOf("## 快速开始：纯插件版") >= 0, true);
  assert.equal(
    readme.indexOf("## 高级/实验：后端和桌面端") > readme.indexOf("## 快速开始：纯插件版"),
    true,
  );
});

test("release checklist prioritizes extension zip instead of desktop packaging", () => {
  const checklist = read("docs/release-checklist.md");
  assert.match(checklist, /extension-release\.zip/);
  assert.match(checklist, /apps\/extension\/dist/);
  assert.match(checklist, /Desktop\/backend.*advanced/i);
});

test("release checklist includes a manual smoke test for product-critical extension flows", () => {
  const checklist = read("docs/release-checklist.md");
  for (const phrase of [
    "Manual smoke test",
    "enable the site",
    "API self-test",
    "directory/detail pages",
    "top-left image buttons",
    "single-page retranslate",
    "manual selection",
  ]) assertIncludes(checklist, phrase);
});

test("release artifacts are ignored instead of committed", () => {
  const gitignore = read(".gitignore");
  assert.match(gitignore, /^release\/$/m);
});

test("public user docs are readable UTF-8 without mojibake", () => {
  for (const relative of publicDocs()) {
    const content = read(relative);
    assert.doesNotMatch(content, /[\uE000-\uF8FF\uFFFD]/, relative);
    assert.doesNotMatch(content, /(?:Ã.|Â.|â€|â€™)/, relative);
  }
});

test("extension packaging runs release package verification and checksum workflow", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageScript = read("scripts/package-extension.ps1");
  const readme = read("README.md");
  const checklist = read("docs/release-checklist.md");
  const releaseNotes = read("docs/release-notes-template.md");
  const ciWorkflow = read(".github/workflows/ci.yml");

  assert.match(packageJson.scripts["package:extension"], /package-extension\.ps1/);
  assert.match(packageJson.scripts["verify:release"], /verify-release-assets\.ps1/);
  assert.match(readme, /pnpm package:extension/);
  assert.equal(exists("scripts/verify-extension-package.ps1"), true);
  assert.equal(exists("scripts/write-extension-checksum.ps1"), true);
  assert.equal(exists("scripts/verify-release-assets.ps1"), true);
  assert.match(packageScript, /verify-extension-package\.ps1/);
  assert.match(packageScript, /write-extension-checksum\.ps1/);
  assert.match(packageScript, /verify-release-assets\.ps1/);
  assert.match(packageScript, /extension-release\.zip\.sha256/);
  assert.match(read("scripts/verify-extension-package.ps1"), /^param\(/);
  assert.match(read("scripts/verify-release-assets.ps1"), /^param\(/);
  assert.match(checklist, /verify-extension-package\.ps1/);
  assert.match(checklist, /verify-release-assets\.ps1/);
  assert.match(checklist, /extension-release\.zip\.sha256/);
  assert.match(releaseNotes, /extension-release\.zip\.sha256/);
  assert.match(ciWorkflow, /release\/extension-release\.zip\.sha256/);
  assert.match(checklist, /manifest\.json/);
});

test("CI runs the extension browser smoke test before packaging release artifacts", () => {
  const ciWorkflow = read(".github/workflows/ci.yml");

  assert.match(ciWorkflow, /playwright install chromium/);
  assert.match(ciWorkflow, /pnpm test:e2e/);
  assert.ok(
    ciWorkflow.indexOf("pnpm test:e2e") < ciWorkflow.indexOf("Package extension"),
    "browser smoke test must run before packaging/uploading release artifacts",
  );
});

test("public examples use generic placeholders instead of a bundled OCR vendor", () => {
  const envExample = read(".env.example");
  assert.match(envExample, /OCR_API_URL=https:\/\/example\.com\/ocr/);
  assert.doesNotMatch(envExample, /uapis\.cn|baidu/i);
});

test("local OCR and API template docs exist and contain required mapping guidance", () => {
  for (const relative of ["docs/local-ocr-http.md", "docs/api-templates.md"]) assert.equal(exists(relative), true, relative);

  const localOcr = read("docs/local-ocr-http.md");
  assert.match(localOcr, /http:\/\/127\.0\.0\.1/i);
  assert.match(localOcr, /image_base64|file/);
  assert.match(localOcr, /regionsPaths/);

  const templates = read("docs/api-templates.md");
  assert.match(templates, /OCR API URL/);
  assert.match(templates, /regionsPaths/);
  assert.match(templates, /textPaths/);
});

test("product roadmap defines plugin-first product-grade priorities", () => {
  const roadmap = read("docs/product-roadmap.md");
  for (const phrase of [
    "Chrome 插件",
    "Phase 1: release foundation",
    "Phase 2: reader detection and queue behavior",
    "Phase 6: UI polish",
    "Phase 7: publishing and trust",
    "CI",
    "extension-release.zip",
  ]) assertIncludes(roadmap, phrase);
});

test("first-run docs cover install, self-test, and common setup failures", () => {
  for (const relative of ["docs/quickstart.md", "docs/troubleshooting.md"]) assert.equal(exists(relative), true, relative);

  const quickstart = read("docs/quickstart.md");
  for (const phrase of [
    "chrome://extensions",
    "extension-release.zip",
    "extension-release.zip.sha256",
    "Get-FileHash",
    "启用此网站",
    "API 设置",
    "自检",
    "页面样本 OCR 正常",
  ]) assertIncludes(quickstart, phrase);

  const troubleshooting = read("docs/troubleshooting.md");
  for (const phrase of ["402", "额度不足", "fetch failed", "未解析到文字区域", "字段映射", "页面样本自检未返回", "目录页", "气泡偏移"]) {
    assertIncludes(troubleshooting, phrase);
  }
  assert.doesNotMatch(`${quickstart}\n${troubleshooting}`, /uapis\.cn|baidu|sk-[A-Za-z0-9_-]{12,}/i);
});

test("publishing trust docs and issue templates exist without secrets", () => {
  const required = [
    "docs/privacy-and-permissions.md",
    ".github/ISSUE_TEMPLATE/ocr-api-failure.md",
    ".github/ISSUE_TEMPLATE/translation-quality.md",
    ".github/ISSUE_TEMPLATE/site-compatibility.md",
    ".github/ISSUE_TEMPLATE/overlay-ui.md",
  ];
  for (const relative of required) assert.equal(exists(relative), true, relative);

  const privacy = read("docs/privacy-and-permissions.md");
  for (const phrase of ["API Key", "storage", "activeTab", "<all_urls>", "OCR API", "OpenAI-compatible", "插件不会上传到项目作者服务器"]) {
    assertIncludes(privacy, phrase);
  }

  const combined = required.map(read).join("\n");
  for (const phrase of ["请不要粘贴完整 API Key", "浏览器", "插件版本", "漫画网站 URL"]) assertIncludes(combined, phrase);
  assert.doesNotMatch(combined, /uapis\.cn|baidu|sk-[A-Za-z0-9_-]{12,}/i);
});

test("release notes template and contributing guide document safe release workflow", () => {
  for (const relative of ["docs/release-notes-template.md", "CONTRIBUTING.md"]) assert.equal(exists(relative), true, relative);

  const releaseNotes = read("docs/release-notes-template.md");
  for (const phrase of ["extension-release.zip", "extension-release.zip.sha256", "chrome://extensions", "已知限制", "API Key", "troubleshooting.md"]) {
    assertIncludes(releaseNotes, phrase);
  }

  const contributing = read("CONTRIBUTING.md");
  for (const phrase of ["纯插件优先", "pnpm install", "pnpm typecheck", "pnpm test", "package-extension.ps1", ".env", "release/"]) {
    assertIncludes(contributing, phrase);
  }

  assert.doesNotMatch(`${releaseNotes}\n${contributing}`, /uapis\.cn|baidu|sk-[A-Za-z0-9_-]{12,}/i);
});

test("public markdown docs do not contain broken local links", () => {
  for (const relative of [
    ...publicDocs(),
    "docs/api-templates.md",
    "docs/local-ocr-http.md",
    "docs/release-checklist.md",
  ]) {
    const content = read(relative);
    const baseDir = path.dirname(path.join(root, relative));
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]?.trim();
      if (!target || /^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
      const withoutAnchor = target.split("#")[0] ?? "";
      if (!withoutAnchor || !withoutAnchor.endsWith(".md")) continue;
      const resolved = path.resolve(baseDir, withoutAnchor);
      assert.equal(fs.existsSync(resolved), true, `${relative} links to missing ${target}`);
    }
  }
});

function publicDocs() {
  return [
    "README.md",
    "docs/quickstart.md",
    "docs/troubleshooting.md",
    "docs/release-notes-template.md",
    "docs/privacy-and-permissions.md",
    "docs/product-roadmap.md",
    "CONTRIBUTING.md",
    ".github/ISSUE_TEMPLATE/ocr-api-failure.md",
    ".github/ISSUE_TEMPLATE/translation-quality.md",
    ".github/ISSUE_TEMPLATE/site-compatibility.md",
    ".github/ISSUE_TEMPLATE/overlay-ui.md",
  ];
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

function assertIncludes(content, phrase) {
  assert.equal(content.includes(phrase), true, phrase);
}
