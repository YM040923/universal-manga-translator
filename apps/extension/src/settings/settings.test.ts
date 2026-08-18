import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  enableSiteForUrl,
  getEffectiveSiteSettings,
  isSiteEnabled,
  loadSettings,
  normalizeSettings,
  primaryDomainFromUrl,
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

test("saveSettings keeps API keys and glossary out of synced storage", async () => {
  const makeStore = (initial: Record<string, unknown> = {}) => {
    const data: Record<string, unknown> = { ...initial };
    return {
      saved: undefined as unknown,
      async get() { return { ...data }; },
      async set(value: Record<string, unknown>) { Object.assign(data, value); this.saved = { ...data }; },
    };
  };
  const syncStorage = makeStore();
  const localStorage = makeStore();
  await saveSettings({
    targetLanguage: "en",
    directOcr: { ...DEFAULT_SETTINGS.directOcr, apiKeys: ["sk-ocr-secret"] },
    directTranslator: { ...DEFAULT_SETTINGS.directTranslator, apiKey: "sk-translate-secret" },
    glossaryText: "Clark = 克拉克",
  }, syncStorage, localStorage);

  const synced = syncStorage.saved as ExtensionSettings;
  assert.equal(synced.targetLanguage, "en");
  assert.equal((synced as unknown as Record<string, unknown>).directOcr, undefined);
  assert.equal((synced as unknown as Record<string, unknown>).directTranslator, undefined);
  assert.equal((synced as unknown as Record<string, unknown>).glossaryText, undefined);

  const local = localStorage.saved as ExtensionSettings;
  assert.deepEqual(local.directOcr.apiKeys, ["sk-ocr-secret"]);
  assert.equal(local.directTranslator.apiKey, "sk-translate-secret");
  assert.equal(local.glossaryText, "Clark = 克拉克");

  const merged = await loadSettings(makeStore({ targetLanguage: "en" }), localStorage);
  assert.deepEqual(merged.directOcr.apiKeys, ["sk-ocr-secret"]);
  assert.equal(merged.directTranslator.apiKey, "sk-translate-secret");
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

test("primaryDomainFromUrl keeps IP and localhost hosts intact", () => {
  assert.equal(primaryDomainFromUrl("http://192.168.1.5/manga"), "192.168.1.5");
  assert.equal(primaryDomainFromUrl("http://10.0.0.1:8080/comic"), "10.0.0.1");
  assert.equal(primaryDomainFromUrl("http://localhost:9000/comic"), "localhost");
});

test("normalizeSettings keeps enabled IP sites", () => {
  const settings = normalizeSettings({ enabledSites: { "192.168.1.5": true, "localhost": true } });
  assert.equal(settings.enabledSites["192.168.1.5"], true);
  assert.equal(settings.enabledSites["localhost"], true);
});

test("sites are disabled until explicitly enabled by primary domain", () => {
  const settings = normalizeSettings({});
  assert.equal(isSiteEnabled(settings, "https://asurascans.com/comics/a"), false);

  const enabled = enableSiteForUrl(settings, "https://www.asurascans.com/comics/a");

  assert.equal(isSiteEnabled(enabled, "https://asurascans.com/other/chapter"), true);
  assert.equal(isSiteEnabled(enabled, "https://cdn.asurascans.com/assets/page.webp"), true);
  assert.deepEqual(enabled.enabledSites, { "asurascans.com": true });
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
    fontScale: 1.3,
    maskScale: 4,
    ellipseX: 90,
    ellipseY: 20,
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

test("normalizeSettings allows wider ellipse tuning for large speech bubbles", () => {
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
  assert.equal(settings.overlayAppearance.ellipseX, 85);
  assert.equal(settings.overlayAppearance.ellipseY, 78);
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
