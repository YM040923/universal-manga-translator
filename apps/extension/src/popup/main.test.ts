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

  assert.match(root.textContent ?? "", /本站自动翻译/);
  assert.match(root.textContent ?? "", /后端已连接/);
  assert.equal(root.querySelector<HTMLInputElement>("[data-field='site-auto']")?.checked, true);
  assert.equal(root.querySelector<HTMLSelectElement>("[data-field='target-language']")?.value, "zh-CN");
});

test("popup disables site card on unsupported tab", async () => {
  const dom = setupDom();
  const root = dom.window.document.querySelector<HTMLElement>("#app")!;

  await mountPopupPage(root, deps({ tabUrl: "chrome://extensions" }));

  assert.match(root.textContent ?? "", /当前页面不支持/);
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

function deps(options: { storage?: SettingsStorageArea; backendOnline?: boolean; tabUrl?: string; sentMessages?: unknown[] } = {}): PopupDeps {
  const sent = options.sentMessages;
  return {
    storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS),
    queryActiveTab: async () => ({ id: 123, url: options.tabUrl ?? "https://manga.example/series/a/1" }),
    checkBackend: async () => options.backendOnline ?? true,
    sendMessageToTab: async (tabId, message) => { sent?.push({ tabId, message }); },
    openOptionsPage: () => undefined,
  };
}

function fakeStorage(initial: ExtensionSettings): SettingsStorageArea & { current: ExtensionSettings } {
  return {
    current: structuredClone(initial),
    async get() { return this.current as unknown as Record<string, unknown>; },
    async set(value) { this.current = { ...this.current, ...value } as ExtensionSettings; },
  };
}