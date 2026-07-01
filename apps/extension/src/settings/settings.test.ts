import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  getEffectiveSiteSettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type ExtensionSettings,
  type SettingsStorageArea,
} from "./settings.js";

test("loadSettings returns extended defaults when storage is empty", async () => {
  const storage = fakeStorage();
  assert.deepEqual(await loadSettings(storage), DEFAULT_SETTINGS);
});

test("loadSettings merges old saved settings for backward compatibility", async () => {
  const storage = fakeStorage({ targetLanguage: "en", autoTranslate: false });
  const settings = await loadSettings(storage);
  assert.equal(settings.targetLanguage, "en");
  assert.equal(settings.autoTranslateDefault, false);
  assert.equal(settings.floatingButtonEnabled, true);
  assert.equal(settings.imageRange, "viewport");
});

test("normalizeSettings falls back from invalid primitive fields", () => {
  assert.deepEqual(
    normalizeSettings({
      backendUrl: "javascript:alert(1)",
      targetLanguage: "   ",
      translationModel: "   ",
      imageRange: "bad" as never,
      siteSettings: { "not a url": { autoTranslate: true, scope: "origin" } },
    }),
    DEFAULT_SETTINGS,
  );
});

test("saveSettings normalizes and persists extended settings", async () => {
  const storage = fakeStorage();
  await saveSettings({
    backendUrl: "http://127.0.0.1:5000/",
    targetLanguage: " ja ",
    translationModel: " gpt-4o-mini ",
    autoTranslateDefault: false,
    imageRange: "fullPage",
    pretranslateNextPage: true,
    floatingButtonEnabled: false,
    siteSettings: {
      "https://example.com": { autoTranslate: true, scope: "similarPath", pathPrefix: "/comic" },
    },
  }, storage);

  assert.deepEqual(storage.saved, {
    backendUrl: "http://127.0.0.1:5000",
    targetLanguage: "ja",
    translationModel: "gpt-4o-mini",
    autoTranslateDefault: false,
    imageRange: "fullPage",
    pretranslateNextPage: true,
    floatingButtonEnabled: false,
    siteSettings: {
      "https://example.com": { autoTranslate: true, scope: "similarPath", pathPrefix: "/comic" },
    },
  });
});

test("getEffectiveSiteSettings uses origin override", () => {
  const settings = normalizeSettings({
    autoTranslateDefault: false,
    siteSettings: {
      "https://manga.example": { autoTranslate: true, scope: "origin" },
    },
  });

  assert.deepEqual(getEffectiveSiteSettings(settings, "https://manga.example/chapter/1"), {
    origin: "https://manga.example",
    autoTranslate: true,
    scope: "origin",
    pathPrefix: "/",
    unsupported: false,
  });
});

test("getEffectiveSiteSettings computes similar path prefix", () => {
  const settings = normalizeSettings({
    siteSettings: {
      "https://manga.example": { autoTranslate: true, scope: "similarPath", pathPrefix: "/series/name" },
    },
  });

  assert.deepEqual(getEffectiveSiteSettings(settings, "https://manga.example/series/name/chapter-1"), {
    origin: "https://manga.example",
    autoTranslate: true,
    scope: "similarPath",
    pathPrefix: "/series/name",
    unsupported: false,
  });
});

test("getEffectiveSiteSettings marks unsupported urls", () => {
  assert.equal(getEffectiveSiteSettings(DEFAULT_SETTINGS, "chrome://extensions").unsupported, true);
});

function fakeStorage(initial: Partial<ExtensionSettings> & { autoTranslate?: boolean } = {}): SettingsStorageArea & { saved: unknown } {
  return {
    saved: undefined,
    async get() { return initial as Record<string, unknown>; },
    async set(value) { this.saved = value; },
  };
}
