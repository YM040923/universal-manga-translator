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
    ...DEFAULT_SETTINGS,
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


test("loadSettings includes backend and performance defaults", async () => {
  const settings = await loadSettings(fakeStorage());
  assert.equal(settings.providerProfile, "mock");
  assert.equal(settings.openAICompatibleBaseUrl, "");
  assert.equal(settings.requestTimeoutMs, 60000);
  assert.equal(settings.maxConcurrentSubmissions, 2);
  assert.equal(settings.maxFullPageSurfaces, 80);
  assert.equal(settings.retryCount, 1);
});

test("normalizeSettings clamps invalid backend and performance fields", () => {
  const settings = normalizeSettings({
    providerProfile: "   ",
    openAICompatibleBaseUrl: "file:///secret",
    requestTimeoutMs: -1,
    maxConcurrentSubmissions: 99,
    maxFullPageSurfaces: 0,
    retryCount: 20,
  });
  assert.equal(settings.providerProfile, DEFAULT_SETTINGS.providerProfile);
  assert.equal(settings.openAICompatibleBaseUrl, "");
  assert.equal(settings.requestTimeoutMs, DEFAULT_SETTINGS.requestTimeoutMs);
  assert.equal(settings.maxConcurrentSubmissions, 8);
  assert.equal(settings.maxFullPageSurfaces, DEFAULT_SETTINGS.maxFullPageSurfaces);
  assert.equal(settings.retryCount, 5);
});

test("saveSettings persists valid backend and performance fields", async () => {
  const storage = fakeStorage();
  await saveSettings({
    providerProfile: " openai-compatible ",
    openAICompatibleBaseUrl: "https://api.example.com/v1/",
    requestTimeoutMs: 45000,
    maxConcurrentSubmissions: 4,
    maxFullPageSurfaces: 120,
    retryCount: 3,
  }, storage);
  const saved = storage.saved as ExtensionSettings;
  assert.equal(saved.providerProfile, "openai-compatible");
  assert.equal(saved.openAICompatibleBaseUrl, "https://api.example.com/v1");
  assert.equal(saved.requestTimeoutMs, 45000);
  assert.equal(saved.maxConcurrentSubmissions, 4);
  assert.equal(saved.maxFullPageSurfaces, 120);
  assert.equal(saved.retryCount, 3);
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

