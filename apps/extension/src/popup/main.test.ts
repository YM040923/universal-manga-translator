import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountPopupPage, type PopupDeps } from "./main.js";
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
  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='retranslate']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='cancel']")!.click();
  await Promise.resolve();

  assert.deepEqual(sent, [
    { tabId: 123, message: { source: "umt-popup", command: "translate" } },
    { tabId: 123, message: { source: "umt-popup", command: "retranslate" } },
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
  }
  await Promise.resolve();

  assert.deepEqual(sent.map((entry) => (entry as { message: { command: string } }).message.command), [
    "translate",
    "retranslate",
    "togglePause",
    "clearPage",
    "cancelQueue",
    "selectRegion",
  ]);
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
  const select = root.querySelector<HTMLSelectElement>("[data-field='run-mode']")!;
  select.value = "backend";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();

  assert.equal(storage.current.runMode, "backend");
});

test("popup exposes complete direct API configuration fields in plugin-only mode", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));

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
  ]) {
    assert.ok(root.querySelector(`[data-field='${field}']`), `${field} should be rendered`);
  }
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-translator-api-key']")?.type, "password");
});

test("popup saves direct OCR and translator API configuration", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
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
});

test("popup self-test button reports missing direct configuration without leaking keys", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const text = root.textContent ?? "";
  assert.equal(text.includes("OCR 未配置"), true);
  assert.equal(text.includes("翻译 API 未配置"), true);
  assert.equal(text.includes("uapi-ak"), false);
});

function setupDom(): JSDOM {
  const dom = new JSDOM('<main id="app"></main>', { url: "chrome-extension://umt/popup.html" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

function deps(options: { storage?: SettingsStorageArea; backendOnline?: boolean; tabUrl?: string; sentMessages?: unknown[]; activated?: unknown[]; ensured?: unknown[]; checkBackend?: (backendUrl: string) => Promise<boolean> } = {}): PopupDeps {
  const sent = options.sentMessages;
  const activated = options.activated;
  const ensured = options.ensured;
  return {
    storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS),
    queryActiveTab: async () => ({ id: 123, url: options.tabUrl ?? "https://asurascans.com/chapter/1" }),
    checkBackend: options.checkBackend ?? (async () => options.backendOnline ?? true),
    sendMessageToTab: async (tabId, message) => { sent?.push({ tabId, message }); },
    activateSite: async (tabId: number, url: string) => { activated?.push({ tabId, url }); return { ok: true }; },
    ensureContentScript: async (tabId: number, url: string) => { ensured?.push({ tabId, url }); return { ok: true }; },
  };
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
