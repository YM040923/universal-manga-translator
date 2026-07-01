import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountOptionsPage } from "./main.js";
import { DEFAULT_SETTINGS, type ExtensionSettings, type SettingsStorageArea } from "../settings/settings.js";

test("options page renders saved settings and preserves popup fields when saving", async () => {
  const dom = new JSDOM('<body><main id="app"></main></body>', { url: "chrome-extension://umt/options.html" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;

  const storage = fakeStorage({ ...DEFAULT_SETTINGS, imageRange: "fullPage", floatingButtonEnabled: false });
  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, { storage });

  const backend = document.querySelector<HTMLInputElement>("[name='backendUrl']")!;
  const target = document.querySelector<HTMLInputElement>("[name='targetLanguage']")!;
  const model = document.querySelector<HTMLInputElement>("[name='translationModel']")!;
  backend.value = "http://127.0.0.1:5000/";
  target.value = "ja";
  model.value = "gpt-4o-mini";
  document.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(storage.saved.backendUrl, "http://127.0.0.1:5000");
  assert.equal(storage.saved.targetLanguage, "ja");
  assert.equal(storage.saved.translationModel, "gpt-4o-mini");
  assert.equal(storage.saved.imageRange, "fullPage");
  assert.equal(storage.saved.floatingButtonEnabled, false);
  assert.equal(document.querySelector("[data-options-status]")?.textContent, "Saved");
});

function fakeStorage(initial: ExtensionSettings): SettingsStorageArea & { saved: ExtensionSettings } {
  return {
    saved: initial,
    async get() {
      return this.saved as unknown as Record<string, unknown>;
    },
    async set(value: Record<string, unknown>) {
      this.saved = { ...this.saved, ...value } as ExtensionSettings;
    },
  };
}