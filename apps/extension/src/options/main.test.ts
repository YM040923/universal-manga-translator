import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountOptionsPage } from "./main.js";
import type { ExtensionSettings, SettingsStorageArea } from "../settings/settings.js";

test("options page renders saved settings and saves edits", async () => {
  const dom = new JSDOM(`<body><main id="app"></main></body>`, { url: "chrome-extension://umt/options.html" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  const storage = fakeStorage({ backendUrl: "http://127.0.0.1:47831", targetLanguage: "zh-CN", autoTranslate: true });

  await mountOptionsPage(document.querySelector<HTMLElement>("#app")!, { storage });

  const backend = document.querySelector<HTMLInputElement>("[name='backendUrl']")!;
  const target = document.querySelector<HTMLInputElement>("[name='targetLanguage']")!;
  const auto = document.querySelector<HTMLInputElement>("[name='autoTranslate']")!;
  assert.equal(backend.value, "http://127.0.0.1:47831");
  assert.equal(target.value, "zh-CN");
  assert.equal(auto.checked, true);

  backend.value = "http://127.0.0.1:5000/";
  target.value = "ja";
  auto.checked = false;
  document.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(storage.saved, { backendUrl: "http://127.0.0.1:5000", targetLanguage: "ja", autoTranslate: false });
  assert.equal(document.querySelector("[data-options-status]")?.textContent, "Saved");
});

function fakeStorage(initial: Partial<ExtensionSettings>): SettingsStorageArea & { saved: unknown } {
  return {
    saved: undefined,
    async get() {
      return initial;
    },
    async set(value: Record<string, unknown>) {
      this.saved = value;
    },
  };
}