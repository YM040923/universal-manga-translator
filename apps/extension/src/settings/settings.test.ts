import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  disableSiteForUrl,
  enableSiteForUrl,
  getEffectiveSiteSettings,
  isSiteEnabled,
  loadSettings,
  normalizeSettings,
  primaryDomainFromUrl,
  saveSettings,
  singleAreaStores,
  SECRET_STORAGE_KEY,
  type ExtensionSettings,
  type SettingsStorageArea,
  type SettingsStores,
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
  assert.equal(settings.progressWidgetEnabled, true);
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
    progressWidgetEnabled: false,
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
    progressWidgetEnabled: false,
    siteSettings: {
      "https://example.com": { autoTranslate: true, scope: "similarPath", pathPrefix: "/comic" },
    },
  });
});


test("loadSettings includes backend and performance defaults", async () => {
  const settings = await loadSettings(fakeStorage());
  assert.equal(settings.runMode, "direct");
  assert.equal(settings.providerProfile, "network-ocr-openai-compatible");
  assert.equal(settings.translationModel, "gpt-4.1-mini");
  assert.equal(settings.openAICompatibleBaseUrl, "");
  assert.equal(settings.requestTimeoutMs, 60000);
  assert.equal(settings.maxConcurrentSubmissions, 2);
  assert.equal(settings.maxFullPageSurfaces, 80);
  assert.equal(settings.retryCount, 1);
});

test("loadSettings includes plugin-only direct API defaults", async () => {
  const settings = await loadSettings(fakeStorage());

  assert.deepEqual(settings.directOcr, {
    apiUrl: "",
    apiKeys: [],
    inputMode: "image_base64",
    imageField: "image_base64",
    staticFieldsText: "{}",
    regionsPaths: ["words_result", "data.words_result", "data.result", "data.regions", "result", "regions"],
    textPaths: ["words", "text", "content"],
    boxPaths: ["location", "box", "bbox", "vertexes_location"],
    confidencePaths: ["score", "confidence"],
    maxAutoOcrPages: 80,
    stopAfterConsecutiveFailures: 4,
  });
  assert.deepEqual(settings.directTranslator, {
    baseUrl: "",
    apiKey: "",
    model: "gpt-4.1-mini",
  });
  assert.equal(settings.glossaryText, "");
});

test("normalizeSettings accepts direct mode API configuration", () => {
  const settings = normalizeSettings({
    runMode: "backend",
    directOcr: {
      apiUrl: "https://ocr.example.com/v1/ocr/",
      apiKeys: [" key-a ", "", "key-b"],
      inputMode: "file",
      imageField: " image ",
      staticFieldsText: "{\"lang\":\"en\"}",
      regionsPaths: [" data.items ", ""],
      textPaths: [" text "],
      boxPaths: [" box "],
      confidencePaths: [" score "],
      maxAutoOcrPages: 80,
      stopAfterConsecutiveFailures: 4,
    },
    directTranslator: {
      baseUrl: "https://api.example.com/v1/",
      apiKey: " sk-test ",
      model: " gpt-test ",
    },
  });

  assert.equal(settings.runMode, "backend");
  assert.deepEqual(settings.directOcr, {
    apiUrl: "https://ocr.example.com/v1/ocr",
    apiKeys: ["key-a", "key-b"],
    inputMode: "file",
    imageField: "image",
    staticFieldsText: "{\"lang\":\"en\"}",
    regionsPaths: ["data.items"],
    textPaths: ["text"],
    boxPaths: ["box"],
    confidencePaths: ["score"],
    maxAutoOcrPages: 80,
    stopAfterConsecutiveFailures: 4,
  });
  assert.deepEqual(settings.directTranslator, {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-test",
  });
});

test("normalizeSettings preserves user glossary text and exposes a stable glossary hash", () => {
  const settings = normalizeSettings({
    glossaryText: "Clark = 克拉克\nMurim: 武林\n\n# comment\nbad line",
  });

  assert.equal(settings.glossaryText, "Clark = 克拉克\nMurim = 武林");
  assert.deepEqual(settings.glossary, { Clark: "克拉克", Murim: "武林" });
  assert.match(settings.glossaryHash, /^glossary:[a-f0-9]{16}$/);
  assert.equal(normalizeSettings({ glossaryText: "Murim=武林\nClark=克拉克" }).glossaryHash, settings.glossaryHash);
});

test("normalizeSettings adds /v1 to bare OpenAI-compatible translator domains", () => {
  const settings = normalizeSettings({
    directTranslator: {
      baseUrl: "https://translator.example.test/",
      apiKey: "sk-test",
      model: "gpt-test",
    },
  });

  assert.equal(settings.directTranslator.baseUrl, "https://translator.example.test/v1");
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
  assert.equal(settings.maxConcurrentSubmissions, 4);
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

function fakeStorage(initial: Partial<ExtensionSettings> & { autoTranslate?: boolean } = {}): SettingsStores & { saved: unknown } {
  const area: SettingsStorageArea & { saved: unknown } = {
    saved: undefined,
    async get() { return initial as Record<string, unknown>; },
    async set(value) { this.saved = value; },
  };
  return { ...singleAreaStores(area), get saved() { return area.saved; } };
}

test("loadSettings includes debug overlay default", async () => {
  const settings = await loadSettings(fakeStorage());
  assert.equal(settings.debugOverlayEnabled, false);
});

test("saveSettings persists debug overlay setting", async () => {
  const storage = fakeStorage();
  await saveSettings({ debugOverlayEnabled: true }, storage);
  const saved = storage.saved as ExtensionSettings;
  assert.equal(saved.debugOverlayEnabled, true);
});


test("new sites do not auto translate by default to avoid localhost permission prompts", async () => {
  const settings = await loadSettings(fakeStorage({}));
  const effective = getEffectiveSiteSettings(settings, "https://auth.huaweicloud.com/login");

  assert.equal(effective.autoTranslate, false);
});


test("primaryDomainFromUrl normalizes subdomains to a main site key", () => {
  assert.equal(primaryDomainFromUrl("https://www.asurascans.com/comics/a"), "asurascans.com");
  assert.equal(primaryDomainFromUrl("https://reader.manga.example.co.uk/chapter/1"), "example.co.uk");
  assert.equal(primaryDomainFromUrl("chrome://extensions"), null);
});

test("sites are disabled until explicitly enabled by primary domain", () => {
  const settings = normalizeSettings({});
  assert.equal(isSiteEnabled(settings, "https://asurascans.com/comics/a"), false);

  const enabled = enableSiteForUrl(settings, "https://www.asurascans.com/comics/a");

  assert.equal(isSiteEnabled(enabled, "https://asurascans.com/other/chapter"), true);
  assert.equal(isSiteEnabled(enabled, "https://cdn.asurascans.com/assets/page.webp"), true);
  assert.deepEqual(enabled.enabledSites, { "asurascans.com": true });
});

test("revoking a site drops its grant instead of leaving a false entry", () => {
  const enabled = enableSiteForUrl(enableSiteForUrl(normalizeSettings({}), "https://asurascans.com/comics/a"), "https://mangadex.org/title/b");
  const sameSettings = enableSiteForUrl(enabled, "https://asurascans.com/comics/a");
  const revoked = disableSiteForUrl(sameSettings, "https://cdn.asurascans.com/assets/page.webp");

  assert.equal(isSiteEnabled(revoked, "https://asurascans.com/comics/a"), false);
  assert.equal(isSiteEnabled(revoked, "https://mangadex.org/title/b"), true);
  assert.deepEqual(revoked.enabledSites, { "mangadex.org": true });
  assert.equal(disableSiteForUrl(enabled, "https://never-enabled.example/comic"), enabled);
  assert.equal(Object.prototype.hasOwnProperty.call(revoked.enabledSites, "asurascans.com"), false);
});

test("loadSettings includes site activation and overlay visibility defaults", async () => {
  const settings = await loadSettings(fakeStorage());
  assert.deepEqual(settings.enabledSites, {});
  assert.equal(settings.translationOverlayVisible, true);
});

test("loadSettings includes overlay appearance defaults", async () => {
  const settings = await loadSettings(fakeStorage());
  assert.deepEqual(settings.overlayAppearance, {
    maskShape: "auto",
    fontScale: 1,
    maskScale: 1,
    ellipseX: 50,
    ellipseY: 42,
    opacity: 1,
  });
});

test("normalizeSettings clamps overlay appearance fields", () => {
  const settings = normalizeSettings({
    overlayAppearance: {
      maskShape: "bad" as never,
      fontScale: 9,
      maskScale: 9,
      ellipseX: 99,
      ellipseY: 1,
      opacity: 2,
    },
  });

  assert.deepEqual(settings.overlayAppearance, {
    maskShape: "auto",
    fontScale: 1.8,
    maskScale: 4,
    ellipseX: 50,
    ellipseY: 10,
    opacity: 1,
  });
});

test("normalizeSettings allows a much smaller overlay mask scale", () => {
  const settings = normalizeSettings({
    overlayAppearance: {
      maskShape: "auto",
      fontScale: 1,
      maskScale: 0.2,
      ellipseX: 50,
      ellipseY: 42,
      opacity: 1,
    },
  });

  assert.equal(settings.overlayAppearance.maskScale, 0.2);
});

test("normalizeSettings clamps ellipse radii to the range that changes the visible shape", () => {
  const settings = normalizeSettings({
    overlayAppearance: {
      maskShape: "ellipse",
      fontScale: 1,
      maskScale: 3.5,
      ellipseX: 85,
      ellipseY: 78,
      opacity: 1,
    },
  });

  assert.equal(settings.overlayAppearance.maskScale, 3.5);
  assert.equal(settings.overlayAppearance.ellipseX, 50);
  assert.equal(settings.overlayAppearance.ellipseY, 50);
});

test("normalizeSettings keeps the expanded typography and low-opacity endpoints", () => {
  const settings = normalizeSettings({
    overlayAppearance: {
      maskShape: "auto",
      fontScale: 0.5,
      maskScale: 1,
      ellipseX: 50,
      ellipseY: 42,
      opacity: 0.05,
    },
  });

  assert.equal(settings.overlayAppearance.fontScale, 0.5);
  assert.equal(settings.overlayAppearance.opacity, 0.05);
});

test("normalizeSettings clamps OCR cost protection fields", () => {
  const settings = normalizeSettings({
    directOcr: {
      ...DEFAULT_SETTINGS.directOcr,
      maxAutoOcrPages: 999,
      stopAfterConsecutiveFailures: 99,
    } as never,
  });

  assert.equal(settings.directOcr.maxAutoOcrPages, 120);
  assert.equal(settings.directOcr.stopAfterConsecutiveFailures, 10);
  assert.equal(normalizeSettings({ directOcr: { ...DEFAULT_SETTINGS.directOcr, maxAutoOcrPages: 0, stopAfterConsecutiveFailures: 0 } as never }).directOcr.maxAutoOcrPages, DEFAULT_SETTINGS.directOcr.maxAutoOcrPages);
});

test("saveSettings keeps API keys out of the synced preferences area", async () => {
  const preferences = recordingArea();
  const secrets = keyAwareArea();

  await saveSettings({
    ...DEFAULT_SETTINGS,
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["ocr-secret-a", "ocr-secret-b"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "llm-secret", model: "gpt-test" },
  }, { preferences, secrets });

  assert.deepEqual(secrets.store[SECRET_STORAGE_KEY], {
    version: 1,
    ocrApiKeys: ["ocr-secret-a", "ocr-secret-b"],
    translatorApiKey: "llm-secret",
  });
  assert.doesNotMatch(JSON.stringify(preferences.writes), /ocr-secret-a|ocr-secret-b|llm-secret/);
  assert.equal((preferences.writes.at(-1) as { directTranslator: { apiKey: string } }).directTranslator.apiKey, "");
});

test("loadSettings reads API keys back from the secrets area", async () => {
  const preferences = recordingArea({ targetLanguage: "ja" });
  const secrets = keyAwareArea({ [SECRET_STORAGE_KEY]: { version: 1, ocrApiKeys: ["ocr-x"], translatorApiKey: "llm-x" } });

  const settings = await loadSettings({ preferences, secrets });

  assert.deepEqual(settings.directOcr.apiKeys, ["ocr-x"]);
  assert.equal(settings.directTranslator.apiKey, "llm-x");
  assert.equal(settings.targetLanguage, "ja");
});

test("loadSettings migrates keys found in synced preferences into local secrets and scrubs the copy", async () => {
  const preferences = recordingArea({
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr", apiKeys: ["legacy-ocr-key"] },
    directTranslator: { baseUrl: "https://api.example/v1", apiKey: "legacy-llm-key", model: "gpt-test" },
  });
  const secrets = keyAwareArea();

  const settings = await loadSettings({ preferences, secrets });

  assert.deepEqual(settings.directOcr.apiKeys, ["legacy-ocr-key"]);
  assert.deepEqual((secrets.store[SECRET_STORAGE_KEY] as { ocrApiKeys: string[] }).ocrApiKeys, ["legacy-ocr-key"]);
  assert.doesNotMatch(JSON.stringify(preferences.writes), /legacy-ocr-key|legacy-llm-key/);
  const scrubbed = preferences.writes.at(-1) as { directOcr: { apiKeys: string[] }; directTranslator: { apiKey: string } };
  assert.deepEqual(scrubbed.directOcr.apiKeys, []);
  assert.equal(scrubbed.directTranslator.apiKey, "");
});

test("loadSettings does not rewrite preferences when no legacy keys are present", async () => {
  const preferences = recordingArea({ directOcr: { ...DEFAULT_SETTINGS.directOcr, apiUrl: "https://ocr.example/ocr" } });
  const secrets = keyAwareArea({ [SECRET_STORAGE_KEY]: { version: 1, ocrApiKeys: ["ocr-x"], translatorApiKey: "" } });

  await loadSettings({ preferences, secrets });

  assert.equal(preferences.writes.length, 0);
});

function recordingArea(initial: Record<string, unknown> = {}): SettingsStorageArea & { writes: Record<string, unknown>[] } {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    async get() { return { ...initial }; },
    async set(value) { writes.push({ ...value }); Object.assign(initial, value); },
  };
}

function keyAwareArea(store: Record<string, unknown> = {}): SettingsStorageArea & { store: Record<string, unknown> } {
  return {
    store,
    async get(keys) { return typeof keys === "string" ? { [keys]: store[keys] } : {}; },
    async set(value) { Object.assign(store, value); },
  };
}
