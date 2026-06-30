import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ExtensionSettings, type SettingsStorageArea } from "./settings.js";

test("loadSettings returns defaults when storage is empty", async () => {
  const storage = fakeStorage();
  assert.deepEqual(await loadSettings(storage), DEFAULT_SETTINGS);
});

test("loadSettings merges partial saved settings", async () => {
  const storage = fakeStorage({ targetLanguage: "en", autoTranslate: false });
  assert.deepEqual(await loadSettings(storage), { ...DEFAULT_SETTINGS, targetLanguage: "en", autoTranslate: false });
});

test("loadSettings falls back from invalid backend url", async () => {
  const storage = fakeStorage({ backendUrl: "javascript:alert(1)", targetLanguage: "   " });
  assert.deepEqual(await loadSettings(storage), DEFAULT_SETTINGS);
});

test("saveSettings normalizes and persists settings", async () => {
  const storage = fakeStorage();
  await saveSettings({ backendUrl: "http://127.0.0.1:5000/", targetLanguage: " ja ", autoTranslate: false }, storage);
  assert.deepEqual(storage.saved, { backendUrl: "http://127.0.0.1:5000", targetLanguage: "ja", autoTranslate: false });
});

function fakeStorage(initial: Partial<ExtensionSettings> = {}): SettingsStorageArea & { saved: unknown } {
  return {
    saved: undefined,
    async get() {
      return initial;
    },
    async set(value: unknown) {
      this.saved = value;
    },
  };
}