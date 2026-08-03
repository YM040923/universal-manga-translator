import test from "node:test";
import assert from "node:assert/strict";

test("ContentFingerprintCache reuses an exact completed result without URL-dependent keys", async () => {
  const { ContentFingerprintCache, contentFingerprintCacheKey } = await import("./" + "content-fingerprint-cache.js");
  const storage = fakeStorage();
  const cache = new ContentFingerprintCache(storage);
  const fingerprint = context();

  await cache.save(fingerprint, result());

  assert.deepEqual(await cache.get(fingerprint), result());
  const key = contentFingerprintCacheKey(fingerprint);
  assert.doesNotMatch(key, /https?:|cdn\.example|hash-same-content/);
});

test("ContentFingerprintCache hits for identical content after its image URL changes", async () => {
  const { ContentFingerprintCache } = await import("./" + "content-fingerprint-cache.js");
  const cache = new ContentFingerprintCache(fakeStorage());
  await cache.save(context(), result());

  const cached = await cache.get({ ...context(), imageUrl: "https://cdn.example/signed/new-url.webp" });

  assert.equal(cached?.regions[0]?.translatedText, "ÄãºÃ");
});

test("ContentFingerprintCache misses when any OCR or translation configuration changes", async () => {
  const { ContentFingerprintCache } = await import("./" + "content-fingerprint-cache.js");
  const cache = new ContentFingerprintCache(fakeStorage());
  await cache.save(context(), result());

  assert.equal(await cache.get({ ...context(), ocrProfile: "ocr:changed" }), null);
  assert.equal(await cache.get({ ...context(), translationProfile: "translator:changed" }), null);
  assert.equal(await cache.get({ ...context(), layoutVersion: "layout:v2" }), null);
});

test("ContentFingerprintCache never saves or returns empty and failed results", async () => {
  const { ContentFingerprintCache } = await import("./" + "content-fingerprint-cache.js");
  const cache = new ContentFingerprintCache(fakeStorage());
  await cache.save(context(), { ...result(), status: "empty", regions: [] });
  await cache.save(context(), { ...result(), status: "failed" });

  assert.equal(await cache.get(context()), null);
});

function context() {
  return {
    imageHash: "hash-same-content",
    naturalWidth: 1200,
    naturalHeight: 1800,
    ocrProfile: "ocr:stable",
    preprocessingVersion: "preprocess:v1",
    targetLanguage: "zh-CN",
    translationProfile: "translator:gpt-test",
    promptVersion: "prompt:v2",
    layoutVersion: "layout:v1",
  };
}

function result() {
  return {
    surfaceId: "s1",
    imageHash: "hash-same-content",
    status: "completed",
    providerProfile: "direct:test",
    layoutVersion: 1,
    elapsedMs: 5,
    regions: [{
      id: "bubble-1",
      box: { x: 10, y: 20, width: 120, height: 50 },
      sourceText: "HELLO",
      translatedText: "ÄãºÃ",
      confidence: 0.99,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 16, writingMode: "horizontal-tb", align: "center", background: "#fff", color: "#111" },
    }],
  };
}

function fakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}