import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountOptionsPage, type OptionsPageDeps } from "./main.js";
import { DEFAULT_SETTINGS, type ExtensionSettings, type SettingsStorageArea } from "../settings/settings.js";

test("settings page renders backend provider defaults and performance sections", async () => {
  setupDom();
  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, deps());

  assert.equal(document.querySelector("[data-section='backend']") !== null, true);
  assert.equal(document.querySelector("[data-section='provider']") !== null, true);
  assert.equal(document.querySelector("[data-section='defaults']") !== null, true);
  assert.equal(document.querySelector("[data-section='performance']") !== null, true);
  const text = document.body.textContent ?? "";
  assert.match(text, /\u540e\u7aef\u8fde\u63a5/u);
  assert.match(text, /\u63d0\u4f9b\u5546/u);
  assert.match(text, /\u7ffb\u8bd1\u9ed8\u8ba4\u503c/u);
  assert.match(text, /\u6027\u80fd/u);
  assert.match(text, /API key \u5bc6\u94a5/u);
  assert.match(text, /OpenAI \u517c\u5bb9 Base URL/u);
  assert.match(text, /\u5f53\u524d\u9875\u9762\u7f13\u5b58/u);
  assert.doesNotMatch(text, /Backend connection|Provider \/ model|Translation defaults|Performance \/ cache|Save settings|Not checked/);
  assert.doesNotMatch(text, /\\u[0-9a-fA-F]{4}/);
});

test("settings page saves advanced fields while preserving site settings", async () => {
  setupDom();
  const storage = fakeStorage({
    ...DEFAULT_SETTINGS,
    siteSettings: { "https://manga.example": { autoTranslate: false, scope: "similarPath", pathPrefix: "/series" } },
  });
  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, deps({ storage }));

  setValue("backendUrl", "http://127.0.0.1:5000/");
  setValue("providerProfile", "openai-compatible");
  setValue("translationModel", "gpt-4o-mini");
  setValue("openAICompatibleBaseUrl", "https://api.example.com/v1/");
  setValue("targetLanguage", "en");
  setValue("imageRange", "fullPage");
  setChecked("pretranslateNextPage", true);
  setChecked("floatingButtonEnabled", false);
  setChecked("autoTranslateDefault", false);
  setValue("requestTimeoutMs", "45000");
  setValue("maxConcurrentSubmissions", "4");
  setValue("maxFullPageSurfaces", "120");
  setValue("retryCount", "3");

  document.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(storage.saved.backendUrl, "http://127.0.0.1:5000");
  assert.equal(storage.saved.providerProfile, "openai-compatible");
  assert.equal(storage.saved.translationModel, "gpt-4o-mini");
  assert.equal(storage.saved.openAICompatibleBaseUrl, "https://api.example.com/v1");
  assert.equal(storage.saved.targetLanguage, "en");
  assert.equal(storage.saved.imageRange, "fullPage");
  assert.equal(storage.saved.pretranslateNextPage, true);
  assert.equal(storage.saved.floatingButtonEnabled, false);
  assert.equal(storage.saved.autoTranslateDefault, false);
  assert.equal(storage.saved.requestTimeoutMs, 45000);
  assert.equal(storage.saved.maxConcurrentSubmissions, 4);
  assert.equal(storage.saved.maxFullPageSurfaces, 120);
  assert.equal(storage.saved.retryCount, 3);
  assert.deepEqual(storage.saved.siteSettings, { "https://manga.example": { autoTranslate: false, scope: "similarPath", pathPrefix: "/series" } });
});

test("settings page checks backend health", async () => {
  setupDom();
  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, deps({ checkBackend: async () => true }));

  document.querySelector<HTMLButtonElement>("[data-action='check-backend']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.querySelector<HTMLElement>("[data-backend-health]")?.textContent, "\u5df2\u8fde\u63a5");
});

function setupDom(): void {
  const dom = new JSDOM('<body><main id="app"></main></body>', { url: "chrome-extension://umt/options.html" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
}

function deps(options: {
  storage?: SettingsStorageArea;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  configStatus?: OptionsPageDeps["configStatus"];
  cacheStats?: OptionsPageDeps["cacheStats"];
  clearCache?: OptionsPageDeps["clearCache"];
} = {}): OptionsPageDeps {
  const result: OptionsPageDeps = { storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS) };
  if (options.checkBackend) result.checkBackend = options.checkBackend;
  if (options.configStatus) result.configStatus = options.configStatus;
  if (options.cacheStats) result.cacheStats = options.cacheStats;
  if (options.clearCache) result.clearCache = options.clearCache;
  return result;
}

function setValue(name: string, value: string): void {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name='${name}']`)!;
  field.value = value;
}

function setChecked(name: string, checked: boolean): void {
  document.querySelector<HTMLInputElement>(`[name='${name}']`)!.checked = checked;
}

function fakeStorage(initial: ExtensionSettings): SettingsStorageArea & { saved: ExtensionSettings } {
  return {
    saved: structuredClone(initial),
    async get() {
      return this.saved as unknown as Record<string, unknown>;
    },
    async set(value: Record<string, unknown>) {
      this.saved = { ...this.saved, ...value } as ExtensionSettings;
    },
  };
}

test("settings page displays backend provider status without secrets", async () => {
  setupDom();
  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, deps({
    configStatus: async () => ({
      ok: true,
      provider: "openai-compatible",
      targetLanguage: "zh-CN",
      providerProfile: "openai-compatible:gpt-4.1-mini",
      openAICompatible: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", apiKeyConfigured: true },
    }),
  }));

  document.querySelector<HTMLButtonElement>("[data-action='check-provider']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const status = document.querySelector<HTMLElement>("[data-provider-status]")?.textContent ?? "";
  assert.match(status, /openai-compatible/);
  assert.match(status, /gpt-4\.1-mini/);
  assert.match(status, /API key 已配置/);
  assert.doesNotMatch(status, /sk-/);
});

test("settings page shows cache stats and clears backend cache", async () => {
  setupDom();
  let cleared = false;
  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, deps({
    cacheStats: async () => ({ ok: true, stats: { entries: 3, bytes: 2048, updatedAt: 123 } }),
    clearCache: async () => { cleared = true; return { ok: true, deleted: 3 }; },
  }));

  document.querySelector<HTMLButtonElement>("[data-action='cache-stats']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(document.querySelector<HTMLElement>("[data-cache-status]")?.textContent ?? "", /3/);
  assert.match(document.querySelector<HTMLElement>("[data-cache-status]")?.textContent ?? "", /2 KB/);

  document.querySelector<HTMLButtonElement>("[data-action='clear-cache']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cleared, true);
  assert.match(document.querySelector<HTMLElement>("[data-cache-status]")?.textContent ?? "", /已清理 3/);
});
