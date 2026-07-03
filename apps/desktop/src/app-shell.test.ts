import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopShellHtml } from "./app-shell.js";

test("desktop shell is a polished software control panel without embedded backend admin iframe", () => {
  const html = createDesktopShellHtml();
  assert.match(html, /启动后端/);
  assert.match(html, /停止后端/);
  assert.match(html, /清理占用/);
  assert.match(html, /刷新状态/);
  assert.match(html, /OCR API 设置/);
  assert.match(html, /运行完整自检/);
  assert.match(html, /翻译模型/);
  assert.doesNotMatch(html, /测试模型/);
  assert.doesNotMatch(html, /测试 OCR/);
  assert.doesNotMatch(html, /打开后端控制台/);
  assert.doesNotMatch(html, /<iframe/);
  assert.doesNotMatch(html, /replace\(\/\/\$/);
  assert.match(html, /endsWith\('\/'\)/);
  assert.doesNotMatch(html, /src="http:\/\/127\.0\.0\.1:47831\/admin"/);
  assert.doesNotMatch(html, /uapisApiKeys|uapisEndpoint|uapisInput/);
  assert.doesNotMatch(html, /后续通用 OCR 阶段接入|当前可先/);
  assert.match(html, /data-backend-required/);
  assert.match(html, /apiKeys: keys\.trim\(\)/);
  assert.match(html, /apiUrl: el\('ocrUrl'\)\.value/);
  assert.match(html, /inputMode: el\('ocrInput'\)\.value/);
  assert.match(html, /ocrImageField/);
  assert.match(html, /ocrStaticFields/);
  assert.match(html, /ocrRegionsPaths/);
  assert.match(html, /ocrTextPaths/);
  assert.match(html, /ocrBoxPaths/);
  assert.match(html, /ocrConfidencePaths/);
  assert.match(html, /parseJsonField\('ocrStaticFields'/);
  assert.match(html, /parseListField\('ocrRegionsPaths'/);
  assert.match(html, /ensureBackendRunning/);
  assert.match(html, /后端未运行，请先点击/);
  assert.match(html, /selfTest'\)\.onclick = \(\) => runBackendAction\(TXT\.selfTest/);
  assert.match(html, /badges/);
  assert.match(html, /apiKeyConfigured/);
});

test("desktop shell keeps backend configuration badges across periodic status refreshes", () => {
  const html = createDesktopShellHtml();
  assert.match(html, /let lastBackendDetails = \{\}/);
  assert.match(html, /show\(\{ \.\.\.lastBackendDetails, \.\.\.status \}\)/);
  assert.match(html, /lastBackendDetails = \{/);
});

test("desktop model settings can update translator API key without displaying existing secrets", () => {
  const html = createDesktopShellHtml();
  assert.match(html, /id="openAiKey"/);
  assert.match(html, /保存后不回显明文/);
  assert.match(html, /apiKey: openAiKey\.trim\(\)/);
  assert.match(html, /openAiKey\.value = ''/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]/);
});

test("desktop shell avoids stretched empty cards and keeps status readable", () => {
  const html = createDesktopShellHtml();
  assert.match(html, /align-items:start/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /弹窗/);
});

test("desktop shell no longer exposes legacy backend admin bridge", () => {
  const html = createDesktopShellHtml();
  assert.doesNotMatch(html, /adminUrl|openExternalAdmin|\/admin/);
});
