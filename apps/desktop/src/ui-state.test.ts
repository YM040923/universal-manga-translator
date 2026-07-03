import assert from "node:assert/strict";
import { test } from "node:test";
import { backendStatusView, userFacingError } from "./ui-state.js";

test("backendStatusView disables backend config actions while backend is stopped", () => {
  assert.deepEqual(backendStatusView({ running: false, owned: false, url: "http://127.0.0.1:47831" }), {
    statusText: "未运行",
    statusClass: "pill bad",
    ownerText: "等待启动",
    metaText: "http://127.0.0.1:47831",
    badges: [],
    startDisabled: false,
    stopDisabled: true,
    configDisabled: true,
  });
});

test("backendStatusView exposes readable running metadata", () => {
  const view = backendStatusView({
    running: true,
    owned: false,
    provider: "network-ocr-openai-compatible",
    targetLanguage: "zh-CN",
    url: "http://127.0.0.1:47831",
  });

  assert.equal(view.statusText, "运行中");
  assert.equal(view.statusClass, "pill ok");
  assert.equal(view.ownerText, "已检测到已有后端");
  assert.equal(view.metaText, "network-ocr-openai-compatible | zh-CN | http://127.0.0.1:47831");
  assert.equal(view.configDisabled, false);
});

test("userFacingError strips Electron IPC noise", () => {
  assert.equal(
    userFacingError(new Error("Error invoking remote method 'umt:start': Error: 找不到 Universal Manga Translator 项目目录，无法启动后端")),
    "找不到 Universal Manga Translator 项目目录，无法启动后端",
  );
});

test("backendStatusView exposes concise backend configuration badges", () => {
  assert.deepEqual(
    backendStatusView({
      running: true,
      owned: true,
      provider: "network-ocr-openai-compatible",
      targetLanguage: "zh-CN",
      url: "http://127.0.0.1:47831",
      ocrConfigured: true,
      translatorConfigured: false,
      keyPoolAvailable: 1,
      keyPoolCount: 3,
    }).badges,
    ["OCR：已配置", "翻译：未配置", "Key：1/3 可用"],
  );
});
