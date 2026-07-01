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
  assert.match(document.body.textContent ?? "", /API key/);
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

  assert.equal(document.querySelector<HTMLElement>("[data-backend-health]")?.textContent, "Connected");
});

function setupDom(): void {
  const dom = new JSDOM('<body><main id="app"></main></body>', { url: "chrome-extension://umt/options.html" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.HTMLElement = dom.window.HTMLElement;
}

function deps(options: { storage?: SettingsStorageArea; checkBackend?: (backendUrl: string) => Promise<boolean> } = {}): OptionsPageDeps {
  const result: OptionsPageDeps = { storage: options.storage ?? fakeStorage(DEFAULT_SETTINGS) };
  if (options.checkBackend) result.checkBackend = options.checkBackend;
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
