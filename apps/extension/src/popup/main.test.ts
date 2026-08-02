import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountPopupPage, type PopupDeps } from "./main.js";
import type { UmtDirectHttpRequest, UmtDirectHttpResponse } from "../content/messages.js";
import { DEFAULT_SETTINGS, enableSiteForUrl, setSiteSettings, type ExtensionSettings, type SettingsStorageArea } from "../settings/settings.js";

test("popup shows an enable button before a site is activated", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ tabUrl: "https://www.asurascans.com/chapter/1" }));

  assert.equal((root.textContent ?? "").includes("\u6b64\u7f51\u7ad9\u672a\u542f\u7528"), true);
  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='activate-site']")?.disabled, false);
  assert.equal(root.querySelector("[data-action='options']"), null);
  assert.equal(root.querySelector("[data-field='target-language']"), null);
});

test("popup enables current primary domain through the background", async () => {
  const dom = setupDom();
  const storage = fakeStorage(DEFAULT_SETTINGS);
  const activated: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, activated, tabUrl: "https://www.asurascans.com/chapter/1" }));
  root.querySelector<HTMLButtonElement>("[data-action='activate-site']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(activated, [{ tabId: 123, url: "https://www.asurascans.com/chapter/1" }]);
  assert.equal(storage.current.enabledSites["asurascans.com"], true);
  assert.equal((root.textContent ?? "").includes("\u5df2\u542f\u7528"), true);
});

test("popup sends page commands only after site is enabled", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://reader.asurascans.com/chapter/1" }));
  for (const action of ["translate", "retranslate", "cancel"]) {
    root.querySelector<HTMLButtonElement>(`[data-action='${action}']`)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.deepEqual(sent, [
    { tabId: 123, message: { source: "umt-popup", command: "translate" } },
    { tabId: 123, message: { source: "umt-popup", command: "retranslateVisible" } },
    { tabId: 123, message: { source: "umt-popup", command: "cancelQueue" } },
  ]);
});

test("popup ensures content script is injected when opening an already enabled site", async () => {
  const dom = setupDom();
  const ensured: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, ensured, tabUrl: "https://asurascans.com/a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(ensured, [{ tabId: 123, url: "https://asurascans.com/a" }]);
});

test("popup does not inject content script before a site is enabled", async () => {
  const dom = setupDom();
  const ensured: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ ensured, tabUrl: "https://asurascans.com/a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(ensured, []);
});

test("popup primary controls are all wired to page commands", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  for (const action of ["translate", "retranslate", "pause", "clear", "cancel", "select-region"]) {
    root.querySelector<HTMLButtonElement>(`[data-action='${action}']`)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.deepEqual(sent.map((entry) => (entry as { message: { command: string } }).message.command), [
    "translate",
    "retranslateVisible",
    "togglePause",
    "clearPage",
    "cancelQueue",
    "selectRegion",
  ]);
});


test("popup locks page actions while a command is being sent and confirms acceptance", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveSend!: () => void;
  const pendingSend = new Promise<void>((resolve) => { resolveSend = resolve; });
  let sends = 0;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async () => { sends += 1; await pendingSend; },
  }));

  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();

  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='translate']")?.disabled, true);
  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='cancel']")?.disabled, false);
  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u6b63\u5728\u53d1\u9001/);
  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();
  assert.equal(sends, 1);

  resolveSend();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='translate']")?.disabled, false);
  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u7ffb\u8bd1\u672c\u9875.*\u5df2\u63a5\u6536/);
});

test("popup moves focus to cancel while a focused page action is pending and restores it afterward", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveSend!: () => void;
  const pendingSend = new Promise<void>((resolve) => { resolveSend = resolve; });

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async () => { await pendingSend; },
  }));

  const translate = root.querySelector<HTMLButtonElement>("[data-action='translate']")!;
  translate.focus();
  assert.equal(dom.window.document.activeElement, translate);

  translate.click();

  assert.equal(dom.window.document.activeElement, root.querySelector<HTMLButtonElement>("[data-action='cancel']"));

  resolveSend();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(dom.window.document.activeElement, root.querySelector<HTMLButtonElement>("[data-action='translate']"));
});

test("popup preserves focus when the user moves away from cancel while a page action is pending", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveSend!: () => void;
  const pendingSend = new Promise<void>((resolve) => { resolveSend = resolve; });

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async () => { await pendingSend; },
  }));

  const translate = root.querySelector<HTMLButtonElement>("[data-action='translate']")!;
  translate.focus();
  translate.click();
  assert.equal(dom.window.document.activeElement, root.querySelector<HTMLButtonElement>("[data-action='cancel']"));

  const apiSettings = root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!;
  apiSettings.focus();
  assert.equal(dom.window.document.activeElement, apiSettings);

  resolveSend();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(dom.window.document.activeElement, root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']"));
});

test("popup keeps cancel available during another pending page action and sends cancel only once", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const sentCommands: string[] = [];
  let resolveTranslate!: () => void;
  let resolveCancel!: () => void;
  const pendingTranslate = new Promise<void>((resolve) => { resolveTranslate = resolve; });
  const pendingCancel = new Promise<void>((resolve) => { resolveCancel = resolve; });

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      sentCommands.push(message.command);
      if (message.command === "translate") await pendingTranslate;
      if (message.command === "cancelQueue") await pendingCancel;
    },
  }));

  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();

  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='translate']")?.disabled, true);
  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='cancel']")?.disabled, false);

  root.querySelector<HTMLButtonElement>("[data-action='cancel']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='cancel']")!.click();

  assert.deepEqual(sentCommands, ["translate", "cancelQueue"]);
  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='cancel']")?.disabled, true);

  resolveCancel();
  resolveTranslate();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("popup keeps pending cancel feedback when the interrupted page action completes first", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveTranslate!: () => void;
  let resolveCancel!: () => void;
  const pendingTranslate = new Promise<void>((resolve) => { resolveTranslate = resolve; });
  const pendingCancel = new Promise<void>((resolve) => { resolveCancel = resolve; });

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      if (message.command === "translate") await pendingTranslate;
      if (message.command === "cancelQueue") await pendingCancel;
    },
  }));

  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='cancel']")!.click();

  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u6b63\u5728\u53d1\u9001.*\u53d6\u6d88\u961f\u5217/);

  resolveTranslate();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u6b63\u5728\u53d1\u9001.*\u53d6\u6d88\u961f\u5217/);

  resolveCancel();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u53d6\u6d88\u961f\u5217.*\u5df2\u63a5\u6536/);
});

test("popup shows a later page action error after cancel succeeds first", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveTranslate!: () => void;
  let resolveCancel!: () => void;
  const pendingTranslate = new Promise<void>((resolve) => { resolveTranslate = resolve; });
  const pendingCancel = new Promise<void>((resolve) => { resolveCancel = resolve; });

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      if (message.command === "translate") {
        await pendingTranslate;
        throw new Error("translation transport failed");
      }
      if (message.command === "cancelQueue") await pendingCancel;
    },
  }));

  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='cancel']")!.click();

  resolveCancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u53d6\u6d88\u961f\u5217.*\u5df2\u63a5\u6536/);

  resolveTranslate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u7ffb\u8bd1\u672c\u9875.*\u5931\u8d25/);
  assert.equal(root.querySelector<HTMLElement>("[data-action-feedback]")?.classList.contains("error"), true);
});

test("popup restores page actions and shows a readable command error", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async () => { throw new Error("Could not establish connection. Receiving end does not exist."); },
  }));

  root.querySelector<HTMLButtonElement>("[data-action='retranslate']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='retranslate']")?.disabled, false);
  assert.match(root.querySelector<HTMLElement>("[data-action-feedback]")?.textContent ?? "", /\u91cd\u7ffb\u672c\u9875.*\u5931\u8d25/);
  assert.equal(root.querySelector<HTMLElement>("[data-action-feedback]")?.classList.contains("error"), true);
});

test("popup disables every page-affecting control before a site is activated", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ tabUrl: "https://asurascans.com/a" }));

  for (const node of root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("[data-requires-enabled]")) {
    assert.equal(node.disabled, true, `${node.outerHTML} should be disabled`);
  }
});

test("popup toggles translation overlay visibility and persists it", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  const toggle = root.querySelector<HTMLInputElement>("[data-field='overlay-visible']")!;
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();

  assert.equal(storage.current.translationOverlayVisible, false);
  assert.deepEqual(sent, [{ tabId: 123, message: { source: "umt-popup", command: "setOverlayVisibility", visible: false } }]);
});

test("popup widget switches persist and send real page commands", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  const floating = root.querySelector<HTMLInputElement>("[data-field='floating-button-enabled']")!;
  const progress = root.querySelector<HTMLInputElement>("[data-field='progress-widget-enabled']")!;
  floating.checked = false;
  floating.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  progress.checked = false;
  progress.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();

  assert.equal(storage.current.floatingButtonEnabled, false);
  assert.equal(storage.current.progressWidgetEnabled, false);
  assert.deepEqual(sent.slice(-2), [
    { tabId: 123, message: { source: "umt-popup", command: "applyWidgetSettings", floatingButtonEnabled: false } },
    { tabId: 123, message: { source: "umt-popup", command: "applyWidgetSettings", progressWidgetEnabled: false } },
  ]);
});

test("popup auto translate switch controls the current site and cancels queued auto work when off", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const enabled = enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a");
  const storage = fakeStorage(setSiteSettings(enabled, "https://asurascans.com/a", { autoTranslate: true }));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  const toggle = root.querySelector<HTMLInputElement>("[data-field='auto-translate']")!;
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();

  assert.equal(storage.current.siteSettings["https://asurascans.com"]?.autoTranslate, false);
  assert.deepEqual(sent.at(-1), {
    tabId: 123,
    message: { source: "umt-popup", command: "applySiteSettings", autoTranslate: false },
  });
});

test("popup persists overlay appearance controls for the extension renderer", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const sent: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  const shape = root.querySelector<HTMLSelectElement>("[data-field='overlay-mask-shape']")!;
  const font = root.querySelector<HTMLInputElement>("[data-field='overlay-font-scale']")!;
  const ellipseY = root.querySelector<HTMLInputElement>("[data-field='overlay-ellipse-y']")!;
  shape.value = "rounded";
  shape.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  font.value = "1.2";
  font.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  ellipseY.value = "40";
  ellipseY.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await Promise.resolve();

  assert.equal(storage.current.overlayAppearance.maskShape, "rounded");
  assert.equal(storage.current.overlayAppearance.fontScale, 1.2);
  assert.equal(storage.current.overlayAppearance.ellipseY, 40);
  assert.deepEqual(sent.at(-1), {
    tabId: 123,
    message: {
      source: "umt-popup",
      command: "applyOverlayAppearance",
      appearance: storage.current.overlayAppearance,
    },
  });
  assert.equal((root.textContent ?? "").includes("\u663e\u793a\u8c03\u6821"), true);
});

test("popup can reset overlay appearance controls to defaults", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    overlayAppearance: {
      maskShape: "rounded",
      fontScale: 1.25,
      maskScale: 0.35,
      ellipseX: 38,
      ellipseY: 34,
      opacity: 0.5,
    },
  }, "https://asurascans.com/a"));
  const sent: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='reset-appearance']")!.click();
  await Promise.resolve();

  assert.deepEqual(storage.current.overlayAppearance, DEFAULT_SETTINGS.overlayAppearance);
  assert.deepEqual(sent.at(-1), {
    tabId: 123,
    message: {
      source: "umt-popup",
      command: "applyOverlayAppearance",
      appearance: DEFAULT_SETTINGS.overlayAppearance,
    },
  });
});

test("popup shows backend status without exposing backend configuration controls", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl({ ...DEFAULT_SETTINGS, runMode: "backend" }, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, backendOnline: true }));

  const text = root.textContent ?? "";
  assert.equal(text.includes("\u540e\u7aef\u5df2\u8fde\u63a5"), true);
  assert.doesNotMatch(text, /OCR/);
  assert.equal(text.includes("\u6a21\u578b"), false);
});

test("popup shows direct mode status as primary when plugin-only mode is selected", async () => {
  const dom = setupDom();
  const configured = {
    ...DEFAULT_SETTINGS,
    runMode: "direct" as const,
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["key-a", "key-b"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  };
  const storage = fakeStorage(enableSiteForUrl(configured, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, backendOnline: false }));

  const text = root.textContent ?? "";
  assert.equal(text.includes("插件直连"), true);
  assert.equal(text.includes("OCR 2 key"), true);
  assert.equal(text.includes("gpt-test"), true);
  assert.equal(text.includes("\u540e\u7aef\u79bb\u7ebf"), false);
});

test("popup can switch between direct and backend mode", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  const select = root.querySelector<HTMLSelectElement>("[data-field='run-mode']")!;
  select.value = "backend";
  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await Promise.resolve();

  assert.equal(storage.current.runMode, "backend");
});

test("popup exposes complete direct API configuration fields in plugin-only settings page", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();

  for (const field of [
    "direct-ocr-url",
    "direct-ocr-keys",
    "direct-ocr-input-mode",
    "direct-ocr-image-field",
    "direct-translator-base-url",
    "direct-translator-api-key",
    "direct-translator-model",
    "direct-ocr-regions-paths",
    "direct-ocr-text-paths",
    "direct-ocr-box-paths",
    "direct-ocr-confidence-paths",
    "direct-ocr-static-fields",
    "glossary-text",
  ]) {
    assert.ok(root.querySelector(`[data-field='${field}']`), `${field} should be rendered`);
  }
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-translator-api-key']")?.type, "password");
});

test("popup API settings show a read-only configuration status checklist", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: {
      ...DEFAULT_SETTINGS.directOcr,
      apiUrl: "https://ocr.example/ocr",
      apiKeys: ["key-a", "key-b"],
      regionsPaths: ["words_result"],
      textPaths: ["words"],
      boxPaths: ["location"],
    },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();

  const checklist = root.querySelector<HTMLElement>("[data-config-checklist]");
  assert.notEqual(checklist, null);
  const text = checklist?.textContent ?? "";
  assert.match(text, /配置状态/);
  assert.match(text, /OCR URL/);
  assert.match(text, /OCR Key：2/);
  assert.match(text, /字段映射/);
  assert.match(text, /Base URL/);
  assert.match(text, /翻译 Key/);
  assert.match(text, /模型：gpt-test/);
});

test("popup saves direct OCR and translator API configuration", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  setValue(root, dom, "direct-ocr-url", "https://ocr.example/ocr");
  setValue(root, dom, "direct-ocr-keys", "ocr-a\nocr-b");
  setValue(root, dom, "direct-ocr-input-mode", "file");
  setValue(root, dom, "direct-ocr-image-field", "file");
  setValue(root, dom, "direct-translator-base-url", "https://api.example/v1");
  setValue(root, dom, "direct-translator-api-key", "sk-test-secret");
  setValue(root, dom, "direct-translator-model", "gpt-test");
  setValue(root, dom, "direct-ocr-regions-paths", "data.regions\nwords_result");
  setValue(root, dom, "direct-ocr-text-paths", "text\nwords");
  setValue(root, dom, "direct-ocr-box-paths", "bbox\nlocation");
  setValue(root, dom, "direct-ocr-confidence-paths", "confidence\nscore");
  setValue(root, dom, "direct-ocr-static-fields", "{\"language\":\"en\"}");
  setValue(root, dom, "glossary-text", "Clark = 克拉克\nMurim = 武林");
  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(storage.current.directOcr.apiUrl, "https://ocr.example/ocr");
  assert.deepEqual(storage.current.directOcr.apiKeys, ["ocr-a", "ocr-b"]);
  assert.equal(storage.current.directOcr.inputMode, "file");
  assert.equal(storage.current.directOcr.imageField, "file");
  assert.equal(storage.current.directTranslator.baseUrl, "https://api.example/v1");
  assert.equal(storage.current.directTranslator.apiKey, "sk-test-secret");
  assert.equal(storage.current.directTranslator.model, "gpt-test");
  assert.deepEqual(storage.current.directOcr.regionsPaths, ["data.regions", "words_result"]);
  assert.deepEqual(storage.current.directOcr.textPaths, ["text", "words"]);
  assert.deepEqual(storage.current.directOcr.boxPaths, ["bbox", "location"]);
  assert.deepEqual(storage.current.directOcr.confidencePaths, ["confidence", "score"]);
  assert.equal(storage.current.directOcr.staticFieldsText, "{\"language\":\"en\"}");
  assert.equal(storage.current.glossaryText, "Clark = 克拉克\nMurim = 武林");
  assert.deepEqual(storage.current.glossary, { Clark: "克拉克", Murim: "武林" });
});

test("popup self-test button reports missing direct configuration without leaking keys", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const text = root.textContent ?? "";
  assert.equal(text.includes("OCR 未配置"), true);
  assert.equal(text.includes("翻译 API 未配置"), true);
  assert.equal(text.includes("uapi-ak"), false);
});


test("popup preserves scroll position when changing controls", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  let panel = root.querySelector<HTMLElement>(".umt-popup")!;
  panel.scrollTop = 180;

  const input = root.querySelector<HTMLInputElement>("[data-field='overlay-mask-scale']")!;
  input.value = "1.35";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await Promise.resolve();

  panel = root.querySelector<HTMLElement>(".umt-popup")!;
  assert.equal(panel.scrollTop, 180);
});

test("popup starts settings pages at the top instead of reusing main-panel scroll", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLElement>(".umt-popup")!.scrollTop = 180;

  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();

  assert.equal(root.querySelector<HTMLElement>(".umt-popup")!.scrollTop, 0);
});
function setupDom(): JSDOM {
  const dom = new JSDOM('<main id="app"></main>', { url: "chrome-extension://umt/popup.html" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

function deps(options: { storage?: SettingsStorageArea; backendOnline?: boolean; tabUrl?: string; sentMessages?: unknown[]; activated?: unknown[]; ensured?: unknown[]; checkBackend?: (backendUrl: string) => Promise<boolean>; directHttp?: (request: Omit<UmtDirectHttpRequest, "source" | "command">) => Promise<UmtDirectHttpResponse>; sendMessageToTab?: PopupDeps["sendMessageToTab"]; useDefaultSendMessageToTab?: boolean } = {}): PopupDeps {
  const sent = options.sentMessages;
  const activated = options.activated;
  const ensured = options.ensured;
  const result: PopupDeps = {
    storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS),
    queryActiveTab: async () => ({ id: 123, url: options.tabUrl ?? "https://asurascans.com/chapter/1" }),
    checkBackend: options.checkBackend ?? (async () => options.backendOnline ?? true),
    activateSite: async (tabId: number, url: string) => { activated?.push({ tabId, url }); return { ok: true }; },
    ensureContentScript: async (tabId: number, url: string) => { ensured?.push({ tabId, url }); return { ok: true }; },
  };
  if (!options.useDefaultSendMessageToTab) {
    result.sendMessageToTab = options.sendMessageToTab ?? (async (tabId, message) => { sent?.push({ tabId, message }); });
  }
  if (options.directHttp) result.directHttp = options.directHttp;
  return result;
}

function fakeStorage(initial: ExtensionSettings): SettingsStorageArea & { current: ExtensionSettings } {
  return {
    current: structuredClone(initial),
    async get() { return this.current as unknown as Record<string, unknown>; },
    async set(value) { this.current = { ...this.current, ...value } as ExtensionSettings; },
  };
}

function setValue(root: HTMLElement, dom: JSDOM, field: string, value: string): void {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-field='${field}']`)!;
  input.value = value;
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function textFieldValue(fields: NonNullable<UmtDirectHttpRequest["init"]>["formFields"], name: string): string | undefined {
  const field = fields?.find((item) => item.type === "text" && item.name === name);
  return field?.type === "text" ? field.value : undefined;
}

test("popup renders immediately before a slow backend health check finishes", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl({ ...DEFAULT_SETTINGS, runMode: "backend" }, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveHealth!: (value: boolean) => void;
  const slowHealth = new Promise<boolean>((resolve) => { resolveHealth = resolve; });

  const mounted = mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    checkBackend: async () => slowHealth,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal((root.textContent ?? "").includes("\u6f2b\u8bd1"), true);
  assert.equal((root.textContent ?? "").includes("\u6b63\u5728\u68c0\u6d4b\u540e\u7aef"), true);
  assert.equal(root.querySelector<HTMLButtonElement>("[data-action='translate']")?.disabled, false);

  resolveHealth(true);
  await mounted;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((root.textContent ?? "").includes("\u540e\u7aef\u5df2\u8fde\u63a5"), true);
});

test("popup retranslate button targets only visible surfaces", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='retranslate']")!.click();
  await Promise.resolve();

  assert.deepEqual(sent, [{ tabId: 123, message: { source: "umt-popup", command: "retranslateVisible" } }]);
});

test("popup keeps API configuration behind a separate settings page with explicit save", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));

  assert.equal(root.querySelector("[data-field='direct-ocr-url']"), null);
  assert.ok(root.querySelector("[data-action='open-api-settings']"));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  assert.ok(root.querySelector("[data-field='direct-ocr-url']"));
  assert.ok(root.querySelector("[data-action='save-api-settings']"));
});

test("popup API settings are saved only when pressing save", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  setValue(root, dom, "direct-ocr-url", "https://ocr.example/ocr");
  await Promise.resolve();
  assert.equal(storage.current.directOcr.apiUrl, "");

  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await Promise.resolve();
  assert.equal(storage.current.directOcr.apiUrl, "https://ocr.example/ocr");
});

test("popup direct self-test surfaces real OCR and AI API failures", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"] },
    directTranslator: { baseUrl: "https://api.example", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: false, status: 402, statusText: "Payment Required", error: "INSUFFICIENT_CREDITS 账户积分不足", headers: {}, bodyText: "{}" };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "text/html" }, bodyText: "<!doctype html>" };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const text = root.textContent ?? "";
  assert.match(text, /OCR 失败：402/);
  assert.match(text, /INSUFFICIENT_CREDITS/);
  assert.match(text, /账户积分不足/);
  assert.match(text, /Base URL.*\/v1|非 JSON/);
  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.equal(selfTest.includes("ocr-key"), false);
  assert.equal(selfTest.includes("llm-key"), false);
});

test("popup direct self-test explains OCR quota failures without leaking keys", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-secret"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-secret", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) {
        return {
          ok: false,
          status: 402,
          statusText: "Payment Required",
          error: "Payment Required",
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ code: "INSUFFICIENT_CREDITS", message: "账户积分不足" }),
        };
      }
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /OCR 失败/);
  assert.match(selfTest, /402/);
  assert.match(selfTest, /账户积分不足/);
  assert.match(selfTest, /额度不足|积分不足|切换 API Key/);
  assert.equal(selfTest.includes("ocr-secret"), false);
  assert.equal(selfTest.includes("llm-secret"), false);
});

test("popup direct self-test rejects remote plain HTTP before sending API keys", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "http://ocr.example/ocr", apiKeys: ["ocr-secret"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-secret", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const seenUrls: string[] = [];

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      seenUrls.push(request.url);
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      if (request.url.endsWith("/chat/completions")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: "你好 OCR" } }] }) };
      throw new Error("must not call directHttp for insecure OCR URL");
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /OCR 失败/);
  assert.match(selfTest, /https/);
  assert.equal(selfTest.includes("ocr-secret"), false);
  assert.deepEqual(seenUrls, ["https://api.example/v1/models", "https://api.example/v1/chat/completions"]);
});

test("popup direct self-test reports OCR mapping guidance when no configured regions are parsed", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ result: [] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /未解析到文字区域|字段映射/);
  assert.match(selfTest, /regionsPaths|textPaths|boxPaths|字段映射/);
});

test("popup direct self-test treats an empty OCR sample as connectivity success instead of a hard failure", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /OCR 接口连通正常/);
  assert.doesNotMatch(selfTest, /自检图片可能没有文字/);
  assert.doesNotMatch(selfTest, /OCR 失败/);
});

test("popup direct self-test prefers a real current-page sample when the synthetic OCR image is empty", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      if (message.command === "sampleOcrSelfTest") return { ok: true, status: "ok", surfaceIndex: 1, regionCount: 7, elapsedMs: 3210 };
    },
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: "你好 OCR" } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /页面样本 OCR 正常/);
  assert.match(selfTest, /第 1 张/);
  assert.match(selfTest, /7 个区域/);
  assert.doesNotMatch(selfTest, /测试图未返回文字区域/);
});

test("popup direct self-test uses the default chrome tabs message response for current-page samples", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      sendMessage: async (_tabId: number, message: { command: string }) => {
        if (message.command === "sampleOcrSelfTest") return { ok: true, status: "ok", surfaceIndex: 2, regionCount: 9, elapsedMs: 1200 };
        return undefined;
      },
    },
    runtime: { sendMessage: async () => undefined },
  } as never;

  try {
    await mountPopupPage(root, deps({
      storage,
      tabUrl: "https://asurascans.com/a",
      directHttp: async (request) => {
        if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
        if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
        return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: "你好 OCR" } }] }) };
      },
      useDefaultSendMessageToTab: true,
    }));
    root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
    root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
    assert.match(selfTest, /页面样本 OCR 正常/);
    assert.match(selfTest, /第 2 张/);
    assert.match(selfTest, /9 个区域/);
  } finally {
    globalThis.chrome = previousChrome;
  }
});

test("popup direct self-test reports why current-page sample did not run instead of silently falling back", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      if (message.command === "sampleOcrSelfTest") return undefined;
    },
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: "你好 OCR" } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /页面样本自检未返回/);
  assert.doesNotMatch(selfTest, /测试图未返回文字区域，真实漫画 OCR 时会继续验证字段映射/);
});

test("popup direct self-test validates OCR parsing and a real translator chat call", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: {
      ...DEFAULT_SETTINGS.directOcr,
      apiUrl: "https://ocr.example/ocr",
      apiKeys: ["ocr-key"],
      regionsPaths: ["data.words_result"],
      textPaths: ["words"],
      boxPaths: ["location"],
    },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const seenUrls: string[] = [];

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      seenUrls.push(request.url);
      if (request.url.includes("ocr")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ data: { words_result: [{ words: "HELLO OCR", location: { left: 1, top: 2, width: 30, height: 12 } }] } }),
        };
      }
      if (request.url.endsWith("/models")) {
        return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      }
      if (request.url.endsWith("/chat/completions")) {
        return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: "你好 OCR" } }] }) };
      }
      throw new Error(`unexpected self-test request ${request.url}`);
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>(".self-test")?.textContent ?? "";
  assert.match(selfTest, /OCR 解析正常/);
  assert.match(selfTest, /识别 1 行/);
  assert.match(selfTest, /HELLO OCR/);
  assert.match(selfTest, /AI 调用正常/);
  assert.match(selfTest, /你好 OCR/);
  assert.equal(seenUrls.some((url) => url.endsWith("/chat/completions")), true);
});

test("popup direct self-test sends configured OCR static fields like real translation", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: {
      ...DEFAULT_SETTINGS.directOcr,
      apiUrl: "https://ocr.example/ocr",
      apiKeys: ["ocr-key"],
      staticFieldsText: JSON.stringify({ need_location: true, lang: "en" }),
      regionsPaths: ["data.words_result"],
      textPaths: ["words"],
      boxPaths: ["location"],
    },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const storage = fakeStorage(configured);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let ocrFields: NonNullable<UmtDirectHttpRequest["init"]>["formFields"] = [];

  await mountPopupPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) {
        ocrFields = request.init?.formFields ?? [];
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ data: { words_result: [{ words: "HELLO OCR", location: { left: 1, top: 2, width: 30, height: 12 } }] } }),
        };
      }
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: "你好 OCR" } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(textFieldValue(ocrFields, "need_location"), "true");
  assert.equal(textFieldValue(ocrFields, "lang"), "en");
});







test("popup saves OCR cost protection settings", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")!.click();

  assert.ok(root.querySelector("[data-field='direct-ocr-max-auto-pages']"));
  assert.ok(root.querySelector("[data-field='direct-ocr-max-tiles-per-image']"));
  assert.ok(root.querySelector("[data-field='direct-ocr-stop-after-failures']"));
  setValue(root, dom, "direct-ocr-max-auto-pages", "25");
  setValue(root, dom, "direct-ocr-max-tiles-per-image", "7");
  setValue(root, dom, "direct-ocr-stop-after-failures", "3");
  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(storage.current.directOcr.maxAutoOcrPages, 25);
  assert.equal(storage.current.directOcr.maxOcrTilesPerImage, 7);
  assert.equal(storage.current.directOcr.stopAfterConsecutiveFailures, 3);
});
