import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountPopupPage, type PopupDeps } from "./main.js";
import { DEFAULT_SETTINGS, type ExtensionSettings, type SettingsStorageArea } from "../settings/settings.js";

test("popup renders active site settings and backend status", async () => {
  const dom = setupDom();
  const storage = fakeStorage(DEFAULT_SETTINGS);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage, backendOnline: true, tabUrl: "https://manga.example/series/a/1" }));

  assert.match(root.textContent ?? "", /\u672c\u7ad9\u81ea\u52a8\u7ffb\u8bd1/u);
  assert.match(root.textContent ?? "", /\u540e\u7aef\u5df2\u8fde\u63a5/u);
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='site-auto']")?.checked, true);
  assert.equal(root.querySelector<HTMLSelectElement>("[data-field='target-language']")?.value, "zh-CN");
});

test("popup uses compact density and omits long scope hint", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ tabUrl: "https://manga.example/series/a/1" }));

  assert.equal(root.querySelector<HTMLElement>(".umt-popup")?.dataset.density, "compact");
  assert.equal(root.querySelector(".hint"), null);
  assert.equal(root.querySelector("[data-section='quick-toggles']") !== null, true);
});

test("popup settings button opens options page", async () => {
  const dom = setupDom();
  let opened = false;
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ openOptionsPage: () => { opened = true; } }));
  root.querySelector<HTMLButtonElement>("[data-action='options']")!.click();

  assert.equal(opened, true);
});

test("popup disables site card on unsupported tab", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ tabUrl: "chrome://extensions" }));

  assert.match(root.textContent ?? "", /\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301/u);
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='site-auto']")?.disabled, true);
});

test("popup saves target language and image range", async () => {
  const dom = setupDom();
  const storage = fakeStorage(DEFAULT_SETTINGS);
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ storage }));

  const language = root.querySelector<HTMLSelectElement>("[data-field='target-language']")!;
  language.value = "en";
  language.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();

  const fullPage = root.querySelector<HTMLButtonElement>("[data-action='range-fullPage']")!;
  fullPage.click();
  await Promise.resolve();

  assert.equal(storage.current.targetLanguage, "en");
  assert.equal(storage.current.imageRange, "fullPage");
});

test("popup sends translate command to active tab", async () => {
  const dom = setupDom();
  const sent: unknown[] = [];
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ sentMessages: sent }));
  root.querySelector<HTMLButtonElement>("[data-action='translate']")!.click();
  await Promise.resolve();

  assert.deepEqual(sent, [{ tabId: 123, message: { source: "umt-popup", command: "translate" } }]);
});

function setupDom(): JSDOM {
  const dom = new JSDOM('<main id="app"></main>', { url: "chrome-extension://umt/popup.html" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return dom;
}

function deps(options: { storage?: SettingsStorageArea; backendOnline?: boolean; tabUrl?: string; sentMessages?: unknown[]; openOptionsPage?: () => void } = {}): PopupDeps {
  const sent = options.sentMessages;
  return {
    storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS),
    queryActiveTab: async () => ({ id: 123, url: options.tabUrl ?? "https://manga.example/series/a/1" }),
    checkBackend: async () => options.backendOnline ?? true,
    sendMessageToTab: async (tabId, message) => { sent?.push({ tabId, message }); },
    openOptionsPage: options.openOptionsPage ?? (() => undefined),
  };
}

function fakeStorage(initial: ExtensionSettings): SettingsStorageArea & { current: ExtensionSettings } {
  return {
    current: structuredClone(initial),
    async get() { return this.current as unknown as Record<string, unknown>; },
    async set(value) { this.current = { ...this.current, ...value } as ExtensionSettings; },
  };
}