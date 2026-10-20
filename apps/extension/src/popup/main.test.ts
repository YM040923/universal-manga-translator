import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountPopupPage, mountSettingsPage, type PopupDeps } from "./main.js";
import type { UmtDirectHttpRequest, UmtDirectHttpResponse } from "../content/messages.js";
import { DEFAULT_SETTINGS, enableSiteForUrl, loadSettings, setSiteSettings, singleAreaStores, type ExtensionSettings, type SettingsStorageArea } from "../settings/settings.js";

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

test("popup revokes an enabled site through the deactivate button", async () => {
  const dom = setupDom();
  const seeded = enableSiteForUrl(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"), "https://mangadex.org/a");
  const storage = fakeStorage(seeded);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://www.asurascans.com/chapter/1" }));
  const deactivate = root.querySelector<HTMLButtonElement>("[data-action='deactivate-site']");
  assert.ok(deactivate);

  deactivate!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(storage.current.enabledSites["asurascans.com"], undefined);
  assert.equal(storage.current.enabledSites["mangadex.org"], true);
  assert.ok(root.querySelector<HTMLButtonElement>("[data-action='activate-site']"));
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
  }
  await Promise.resolve();

  assert.deepEqual(sent.map((entry) => (entry as { message: { command: string } }).message.command), [
    "translate",
    "retranslateVisible",
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

test("settings widget switches persist and send real page commands", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
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

test("settings page persists overlay appearance controls for the extension renderer", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const sent: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  const shape = root.querySelector<HTMLSelectElement>("[data-field='overlay-mask-shape']")!;
  const font = root.querySelector<HTMLInputElement>("[data-field='overlay-font-scale']")!;
  const ellipseY = root.querySelector<HTMLInputElement>("[data-field='overlay-ellipse-y']")!;
  assert.equal(font.min, "0.5");
  assert.equal(font.max, "1.8");
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='overlay-ellipse-x']")?.max, "50");
  assert.equal(root.querySelector("[data-field='overlay-opacity']")?.parentElement?.textContent?.includes("100%"), true);
  shape.value = "rounded";
  shape.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  font.value = "1.2";
  font.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  font.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  ellipseY.value = "40";
  ellipseY.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  ellipseY.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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

test("appearance sliders preview while dragging but only save the final value", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  let writes = 0;
  const set = storage.set.bind(storage);
  storage.set = async (value) => { writes += 1; await set(value); };
  const sent: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
  const font = root.querySelector<HTMLInputElement>("[data-field='overlay-font-scale']")!;
  font.value = "1.2";
  font.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  font.value = "1.5";
  font.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(writes, 0);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(sent.length, 1);
  assert.equal(writes, 0);

  font.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();
  assert.equal(writes, 1);
  assert.equal(storage.current.overlayAppearance.fontScale, 1.5);
});

test("settings page can reset overlay appearance controls to defaults", async () => {
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

  await mountSettingsPage(root, deps({ storage, sentMessages: sent, tabUrl: "https://asurascans.com/a" }));
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
  assert.equal(text.includes("API 已配置"), true);
  assert.equal(text.includes("gpt-test"), false);
  assert.equal(text.includes("key-a"), false);
  assert.equal(text.includes("\u540e\u7aef\u79bb\u7ebf"), false);
});

test("settings page can switch between direct and backend mode", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  const select = root.querySelector<HTMLSelectElement>("[data-field='run-mode']")!;
  select.value = "backend";
  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await Promise.resolve();

  assert.equal(storage.current.runMode, "backend");
});

test("settings page exposes complete direct API configuration fields", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));

  for (const field of [
    "direct-ocr-url",
    "direct-ocr-key",
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
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-ocr-image-field']")?.getAttribute("type"), "text");
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-translator-api-key']")?.type, "password");
  assert.equal(root.textContent?.includes("全局配置"), true);
  assert.equal(root.textContent?.includes("asurascans.com"), false);
});

test("advanced OCR mapping explains its purpose and stays optional", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps());

  const details = root.querySelector<HTMLDetailsElement>(".advanced-config")!;
  assert.equal(details.open, false);
  assert.match(details.querySelector("summary")?.textContent ?? "", /自定义 OCR 接口适配.*一般无需修改/);
  assert.match(details.querySelector(".mapping-help")?.textContent ?? "", /无法识别返回结果/);
  assert.equal(details.querySelectorAll(".mapping-grid .api-field").length, 5);
  assert.ok(details.querySelector("[data-field='direct-ocr-static-fields']")?.closest(".mapping-wide"));
});

test("OCR image submission menu is styled and keyboard-selectable", async () => {
  const dom = setupDom();
  const storage = fakeStorage(DEFAULT_SETTINGS);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage }));

  const trigger = root.querySelector<HTMLButtonElement>("[data-custom-select='direct-ocr-input-mode'] .api-select-trigger")!;
  const nativeValue = root.querySelector<HTMLSelectElement>("[data-field='direct-ocr-input-mode']")!;
  const listbox = root.querySelector<HTMLElement>("#direct-ocr-input-mode-options")!;
  assert.equal(nativeValue.hidden, true);
  assert.equal(trigger.getAttribute("role"), "combobox");

  trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  assert.equal(trigger.getAttribute("aria-activedescendant"), "direct-ocr-input-mode-option-file");
  trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

  assert.equal(nativeValue.value, "file");
  assert.equal(trigger.querySelector("[data-select-value]")?.textContent, "文件上传");
  assert.equal(listbox.hidden, true);
  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(storage.current.directOcr.inputMode, "file");
});

test("settings page renders a dedicated workspace instead of popup controls", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps());

  assert.ok(root.querySelector(".settings-layout"));
  assert.ok(root.querySelector("#settings-service"));
  assert.ok(root.querySelector("#settings-translation"));
  assert.ok(root.querySelector("#settings-display"));
  assert.equal(root.querySelector(".umt-popup"), null);
  assert.equal(root.querySelector("[data-action='translate']"), null);
  assert.equal(root.querySelectorAll("[data-settings-nav]").length, 3);
  assert.ok(root.querySelector("#settings-service [data-action='self-test-ocr']"));
  assert.ok(root.querySelector("#settings-service [data-action='self-test-ai']"));
  assert.equal(root.querySelector("#settings-translation [data-action^='self-test-']"), null);
  assert.equal(root.querySelector("#settings-display [data-action^='self-test-']"), null);
  assert.equal(root.querySelector(".api-footer [data-action^='self-test-']"), null);
  assert.equal(root.querySelector<HTMLElement>("#settings-service")?.hidden, false);
  assert.equal(root.querySelector<HTMLElement>("#settings-translation")?.hidden, true);
  assert.equal(root.querySelector<HTMLElement>("#settings-display")?.hidden, true);

  const translationLink = root.querySelector<HTMLAnchorElement>("[href='#settings-translation']")!;
  const glossary = root.querySelector<HTMLTextAreaElement>("[data-field='glossary-text']")!;
  glossary.value = "Name = 名字";
  translationLink.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.location.hash, "#settings-translation");
  assert.equal(translationLink.getAttribute("aria-current"), "location");
  assert.equal(root.querySelector<HTMLElement>("#settings-service")?.hidden, true);
  assert.equal(root.querySelector<HTMLElement>("#settings-translation")?.hidden, false);
  assert.equal(root.querySelector<HTMLElement>("#settings-display")?.hidden, true);
  assert.equal(root.querySelector<HTMLTextAreaElement>("[data-field='glossary-text']")?.value, "Name = 名字");

  dom.window.location.hash = "#settings-display";
  dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
  assert.equal(root.querySelector<HTMLElement>("#settings-translation")?.hidden, true);
  assert.equal(root.querySelector<HTMLElement>("#settings-display")?.hidden, false);
});

test("OCR and AI service checks call only their own API and keep results separate", async () => {
  const dom = setupDom();
  const configured = enableSiteForUrl({
    ...DEFAULT_SETTINGS,
    runMode: "direct",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"], textPaths: ["words"], boxPaths: ["location"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  }, "https://asurascans.com/a");
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const seenUrls: string[] = [];

  await mountSettingsPage(root, deps({
    storage: fakeStorage(configured),
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      seenUrls.push(request.url);
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [{ words: "HELLO", location: { left: 1, top: 1, width: 30, height: 12 } }] } }) };
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      if (request.url.endsWith("/chat/completions")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好"}]}' } }] }) };
      throw new Error(`unexpected request ${request.url}`);
    },
  }));

  const ocrTestButton = root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!;
  const aiTestButton = root.querySelector<HTMLButtonElement>("[data-action='self-test-ai']")!;
  assert.notEqual(ocrTestButton.closest(".api-section"), aiTestButton.closest(".api-section"));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seenUrls.some((url) => url.includes("api.example")), false);
  assert.match(root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "", /OCR 解析正常/);
  assert.equal(root.querySelector<HTMLElement>("[data-self-test-result='ai']")?.textContent, "");

  const requestsBeforeAiTest = seenUrls.length;
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ai']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const aiRequests = seenUrls.slice(requestsBeforeAiTest);
  assert.equal(aiRequests.some((url) => url.includes("ocr.example")), false);
  assert.equal(aiRequests.some((url) => url.endsWith("/chat/completions")), true);
  assert.match(root.querySelector<HTMLElement>("[data-self-test-result='ai']")?.textContent ?? "", /AI 调用正常/);
  assert.equal(root.querySelector("#settings-translation [data-self-test-result]"), null);
  assert.equal(root.querySelector("#settings-display [data-self-test-result]"), null);
});

test("backend mode exposes only its own test and never calls direct OCR or AI", async () => {
  const dom = setupDom();
  const configured = {
    ...DEFAULT_SETTINGS,
    runMode: "backend" as const,
    backendUrl: "http://127.0.0.1:47831",
  };
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const backendChecks: string[] = [];
  const directRequests: string[] = [];

  await mountSettingsPage(root, deps({
    storage: fakeStorage(configured),
    checkBackend: async (url) => { backendChecks.push(url); return true; },
    directHttp: async (request) => {
      directRequests.push(request.url);
      return { ok: false, status: 500, statusText: "unexpected", error: "unexpected direct request", headers: {}, bodyText: "unexpected direct request" };
    },
  }));

  assert.equal(root.querySelector<HTMLElement>("[data-mode-panel='backend']")?.hidden, false);
  assert.equal(root.querySelector<HTMLElement>("[data-mode-panel='direct']")?.hidden, true);
  assert.equal(root.querySelector("#settings-translation [data-self-test-result]"), null);
  assert.equal(root.querySelector("#settings-display [data-self-test-result]"), null);

  const checksBeforeClick = backendChecks.length;
  root.querySelector<HTMLButtonElement>("[data-action='self-test-backend']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(backendChecks.length > checksBeforeClick);
  assert.ok(backendChecks.every((url) => url === "http://127.0.0.1:47831"));
  assert.deepEqual(directRequests, []);
  assert.match(root.querySelector<HTMLElement>("[data-self-test-result='backend']")?.textContent ?? "", /后端连通正常/);
});

test("settings page avoids a misleading duplicate configuration checklist", async () => {
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

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));

  assert.equal(root.querySelector("[data-config-checklist]"), null);
  assert.equal(root.textContent?.includes("全局配置"), true);
  assert.equal(root.textContent?.includes("配置状态"), false);
  assert.equal(root.querySelectorAll("[data-field='direct-ocr-key']").length, 2);
});

test("backend status refreshes inside API settings without replacing edited fields", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl({ ...DEFAULT_SETTINGS, runMode: "backend" }, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let resolveHealth!: (value: boolean) => void;
  const health = new Promise<boolean>((resolve) => { resolveHealth = resolve; });

  await mountSettingsPage(root, deps({ storage, checkBackend: async () => health }));
  const url = root.querySelector<HTMLInputElement>("[data-field='backend-url']")!;
  url.value = "http://127.0.0.1:9999";
  resolveHealth(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(root.querySelector<HTMLElement>("[data-backend-status]")?.textContent, "本地后端已连接");
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='backend-url']")?.value, "http://127.0.0.1:9999");
});

test("settings page saves direct OCR and translator API configuration", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  setValue(root, dom, "direct-ocr-url", "https://ocr.example/ocr");
  root.querySelector<HTMLInputElement>("[data-field='direct-ocr-key']")!.value = "ocr-a";
  root.querySelector<HTMLButtonElement>("[data-action='add-ocr-key']")!.click();
  root.querySelectorAll<HTMLInputElement>("[data-field='direct-ocr-key']")[1]!.value = "ocr-b";
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
  assert.deepEqual(storage.current.directOcr.apiKeys, []);
  assert.equal(storage.current.directOcr.inputMode, "file");
  assert.equal(storage.current.directOcr.imageField, "file");
  assert.equal(storage.current.directTranslator.baseUrl, "https://api.example/v1");
  assert.equal(storage.current.directTranslator.apiKey, "");
  assert.equal(storage.current.directTranslator.model, "gpt-test");

  const persisted = await loadSettings(singleAreaStores(storage));
  assert.deepEqual(persisted.directOcr.apiKeys, ["ocr-a", "ocr-b"]);
  assert.equal(persisted.directTranslator.apiKey, "sk-test-secret");
  assert.deepEqual(storage.current.directOcr.regionsPaths, ["data.regions", "words_result"]);
  assert.deepEqual(storage.current.directOcr.textPaths, ["text", "words"]);
  assert.deepEqual(storage.current.directOcr.boxPaths, ["bbox", "location"]);
  assert.deepEqual(storage.current.directOcr.confidencePaths, ["confidence", "score"]);
  assert.equal(storage.current.directOcr.staticFieldsText, "{\"language\":\"en\"}");
  assert.equal(storage.current.glossaryText, "Clark = 克拉克\nMurim = 武林");
  assert.deepEqual(storage.current.glossary, { Clark: "克拉克", Murim: "武林" });
});

test("settings page self-test reports missing direct configuration without leaking keys", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ai']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const text = root.textContent ?? "";
  assert.match(root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "", /OCR 未配置/);
  assert.match(root.querySelector<HTMLElement>("[data-self-test-result='ai']")?.textContent ?? "", /翻译 API 未配置/);
  assert.equal(text.includes("uapi-ak"), false);
});

test("settings self-test does not imply a manga page check when opened without page context", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  const storage = fakeStorage({
    ...DEFAULT_SETTINGS,
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
  });

  await mountSettingsPage(root, deps({
    storage,
    querySettingsTab: async () => null,
    directHttp: async () => ({ ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) }),
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const summary = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
  assert.match(summary, /内置测试图未返回文字区域/);
  assert.match(summary, /当前没有关联漫画页样本/);
  assert.doesNotMatch(summary, /当前网站未启用/);
});

test("settings self-test keeps unsaved API values and masks OCR keys", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  await mountSettingsPage(root, deps({
    tabUrl: "https://asurascans.com/a",
    directHttp: async () => ({ ok: false, status: 500, statusText: "failed", error: "failed", headers: {}, bodyText: "failed" }),
  }));
  setValue(root, dom, "direct-ocr-url", "https://unsaved.example/ocr");
  const key = root.querySelector<HTMLInputElement>("[data-field='direct-ocr-key']")!;
  key.value = "unsaved-secret";

  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-ocr-url']")?.value, "https://unsaved.example/ocr");
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-ocr-key']")?.value, "unsaved-secret");
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='direct-ocr-key']")?.type, "password");
  assert.match(root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "", /OCR 失败/);
});


test("settings slider changes do not replace the page or interrupt focus", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  let panel = root.querySelector<HTMLElement>(".umt-settings")!;
  panel.scrollTop = 180;

  const input = root.querySelector<HTMLInputElement>("[data-field='overlay-mask-scale']")!;
  input.value = "1.35";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await Promise.resolve();

  panel = root.querySelector<HTMLElement>(".umt-settings")!;
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='overlay-mask-scale']"), input);
  assert.equal(panel.scrollTop, 180);
});

test("popup settings button opens a dedicated page with the active tab context", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let openedTab: number | undefined;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a", openSettingsPage: (tabId) => { openedTab = tabId; } }));

  assert.equal(root.querySelector("[data-field='direct-ocr-url']"), null);
  assert.equal(root.querySelector("[data-field='overlay-mask-scale']"), null);
  root.querySelector<HTMLButtonElement>("[data-action='open-settings']")!.click();

  assert.equal(openedTab, 123);
});
function setupDom(): JSDOM {
  const dom = new JSDOM('<main id="app"></main>', { url: "chrome-extension://umt/popup.html" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

function deps(options: { storage?: SettingsStorageArea; backendOnline?: boolean; tabUrl?: string; sentMessages?: unknown[]; activated?: unknown[]; ensured?: unknown[]; checkBackend?: (backendUrl: string) => Promise<boolean>; directHttp?: (request: Omit<UmtDirectHttpRequest, "source" | "command">) => Promise<UmtDirectHttpResponse>; sendMessageToTab?: PopupDeps["sendMessageToTab"]; querySettingsTab?: PopupDeps["querySettingsTab"]; openSettingsPage?: PopupDeps["openSettingsPage"]; useDefaultSendMessageToTab?: boolean } = {}): PopupDeps {
  const sent = options.sentMessages;
  const activated = options.activated;
  const ensured = options.ensured;
  const result: PopupDeps = {
    storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS),
    queryActiveTab: async () => ({ id: 123, url: options.tabUrl ?? "https://asurascans.com/chapter/1" }),
    querySettingsTab: options.querySettingsTab ?? (async () => ({ id: 123, url: options.tabUrl ?? "https://asurascans.com/chapter/1" })),
    checkBackend: options.checkBackend ?? (async () => options.backendOnline ?? true),
    activateSite: async (tabId: number, url: string) => { activated?.push({ tabId, url }); return { ok: true }; },
    ensureContentScript: async (tabId: number, url: string) => { ensured?.push({ tabId, url }); return { ok: true }; },
  };
  if (options.openSettingsPage) result.openSettingsPage = options.openSettingsPage;
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

test("popup keeps settings out of the popup and exposes a separate settings entry", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));

  assert.equal(root.querySelector("[data-field='direct-ocr-url']"), null);
  assert.ok(root.querySelector("[data-action='open-settings']"));
  assert.equal(root.querySelector("[data-field='overlay-mask-scale']"), null);
  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
  assert.ok(root.querySelector("[data-field='direct-ocr-url']"));
  assert.ok(root.querySelector("[data-action='save-api-settings']"));
});

test("settings configuration is saved only when pressing save", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));
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

  await mountSettingsPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: false, status: 402, statusText: "Payment Required", error: "INSUFFICIENT_CREDITS 账户积分不足", headers: {}, bodyText: "{}" };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "text/html" }, bodyText: "<!doctype html>" };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ai']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const text = root.textContent ?? "";
  assert.match(text, /OCR 失败：402/);
  assert.match(text, /INSUFFICIENT_CREDITS/);
  assert.match(text, /账户积分不足/);
  assert.match(text, /Base URL.*\/v1|非 JSON/);
  const ocrResult = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
  const aiResult = root.querySelector<HTMLElement>("[data-self-test-result='ai']")?.textContent ?? "";
  assert.match(ocrResult, /OCR 失败：402/);
  assert.match(aiResult, /AI 失败/);
  assert.equal(ocrResult.includes("ocr-key"), false);
  assert.equal(aiResult.includes("llm-key"), false);
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

  await mountSettingsPage(root, deps({
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
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
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

  await mountSettingsPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      seenUrls.push(request.url);
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      if (request.url.endsWith("/chat/completions")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
      throw new Error("must not call directHttp for insecure OCR URL");
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
  assert.match(selfTest, /OCR 失败/);
  assert.match(selfTest, /https/);
  assert.equal(selfTest.includes("ocr-secret"), false);
  assert.deepEqual(seenUrls, []);
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

  await mountSettingsPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ result: [] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
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

  await mountSettingsPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
  assert.match(selfTest, /OCR 接口连通正常/);
  assert.doesNotMatch(selfTest, /自检图片可能没有文字/);
  assert.doesNotMatch(selfTest, /OCR 失败/);
});

test("popup self-test labels empty OCR test image as unverified when the current site is disabled", async () => {
  const dom = setupDom();
  const configured = {
    ...DEFAULT_SETTINGS,
    runMode: "direct" as const,
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-key"], regionsPaths: ["data.words_result"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-key", model: "gpt-test" },
  };
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;
  let pageSampleRequested = false;

  await mountSettingsPage(root, deps({
    storage: fakeStorage(configured),
    tabUrl: "https://not-enabled.example/chapter",
    sendMessageToTab: async () => { pageSampleRequested = true; return undefined; },
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
  assert.match(selfTest, /OCR 接口可连接/);
  assert.match(selfTest, /识字效果未验证/);
  assert.match(selfTest, /当前网站未启用/);
  assert.match(selfTest, /不表示真实漫画 OCR 故障/);
  assert.doesNotMatch(selfTest, /OCR 失败/);
  assert.equal(pageSampleRequested, false);
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

  await mountSettingsPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      if (message.command === "sampleOcrSelfTest") return { ok: true, status: "ok", surfaceIndex: 1, regionCount: 7, elapsedMs: 3210 };
    },
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
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
    await mountSettingsPage(root, deps({
      storage,
      tabUrl: "https://asurascans.com/a",
      directHttp: async (request) => {
        if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
        if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
        return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
      },
      useDefaultSendMessageToTab: true,
    }));
    root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
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

  await mountSettingsPage(root, deps({
    storage,
    tabUrl: "https://asurascans.com/a",
    sendMessageToTab: async (_tabId, message) => {
      if (message.command === "sampleOcrSelfTest") return undefined;
    },
    directHttp: async (request) => {
      if (request.url.includes("ocr")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: { words_result: [] } }) };
      if (request.url.endsWith("/models")) return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ data: [{ id: "gpt-test" }] }) };
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const selfTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
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

  await mountSettingsPage(root, deps({
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
        return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
      }
      throw new Error(`unexpected self-test request ${request.url}`);
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const ocrTest = root.querySelector<HTMLElement>("[data-self-test-result='ocr']")?.textContent ?? "";
  assert.match(ocrTest, /OCR 解析正常/);
  assert.match(ocrTest, /识别 1 行/);
  assert.match(ocrTest, /HELLO OCR/);
  assert.equal(root.querySelector<HTMLElement>("[data-self-test-result='ai']")?.textContent, "");

  root.querySelector<HTMLButtonElement>("[data-action='self-test-ai']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const aiTest = root.querySelector<HTMLElement>("[data-self-test-result='ai']")?.textContent ?? "";
  assert.match(aiTest, /AI 调用正常/);
  assert.match(aiTest, /你好 OCR/);
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

  await mountSettingsPage(root, deps({
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
      return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"self-test","translatedText":"你好 OCR"}]}' } }] }) };
    },
  }));
  root.querySelector<HTMLButtonElement>("[data-action='self-test-ocr']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(textFieldValue(ocrFields, "need_location"), "true");
  assert.equal(textFieldValue(ocrFields, "lang"), "en");
});







test("popup saves OCR cost protection settings", async () => {
  const dom = setupDom();
  const storage = fakeStorage(enableSiteForUrl(DEFAULT_SETTINGS, "https://asurascans.com/a"));
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountSettingsPage(root, deps({ storage, tabUrl: "https://asurascans.com/a" }));

  assert.ok(root.querySelector("[data-field='direct-ocr-max-auto-pages']"));
  assert.ok(root.querySelector("[data-field='direct-ocr-stop-after-failures']"));
  setValue(root, dom, "direct-ocr-max-auto-pages", "25");
  setValue(root, dom, "direct-ocr-stop-after-failures", "3");
  root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(storage.current.directOcr.maxAutoOcrPages, 25);
  assert.equal(storage.current.directOcr.stopAfterConsecutiveFailures, 3);
});
