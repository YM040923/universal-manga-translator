import test from "node:test";
import assert from "node:assert/strict";

test("BubbleResultCache fuzzy-matches normalized source text across modest coordinate drift", async () => {
  const { BubbleResultCache } = await import("./" + "bubble-result-cache.js");
  const cache = new BubbleResultCache(fakeStorage());
  const context = cacheContext();
  await cache.save(context, [{
    id: "old-bubble",
    sourceText: "  HELLO,   WORLD! ",
    box: { x: 100, y: 200, width: 220, height: 80 },
    neighborhood: ["BEFORE", "AFTER"],
    translatedText: "你好，世界！",
    priority: "auto",
  }]);

  const match = await cache.match(context, {
    sourceText: "hello, world!",
    box: { x: 112, y: 207, width: 220, height: 80 },
    neighborhood: ["before", "after"],
  });

  assert.equal(match?.translatedText, "你好，世界！");
});

test("BubbleResultCache gives manual selection precedence over edits and deletion tombstones", async () => {
  const { BubbleResultCache } = await import("./" + "bubble-result-cache.js");
  const cache = new BubbleResultCache(fakeStorage());
  const context = cacheContext();
  await cache.save(context, [
    entry("auto", "machine"),
    entry("forced-retranslate", "forced"),
    entry("manual-selection", "selected"),
    entry("manual-tombstone", ""),
  ]);

  const match = await cache.match(context, probe());

  assert.equal(match?.priority, "manual-selection");
  assert.equal(match?.translatedText, "selected");
});

test("BubbleResultCache keeps a manual selection for the same bubble when a later edit or tombstone conflicts", async () => {
  const { BubbleResultCache } = await import("./" + "bubble-result-cache.js");
  const cache = new BubbleResultCache(fakeStorage());
  const context = cacheContext();
  await cache.save(context, [
    { id: "same-bubble", ...probe(), translatedText: "selection", priority: "manual-selection" },
    { id: "same-bubble", ...probe(), translatedText: "", priority: "manual-tombstone" },
  ]);

  const match = await cache.match(context, probe());

  assert.equal(match?.priority, "manual-selection");
  assert.equal(match?.translatedText, "selection");
});

test("BubbleResultCache gives manual selection priority over forced retranslate and auto/cache", async () => {
  const { BubbleResultCache } = await import("./" + "bubble-result-cache.js");
  const cache = new BubbleResultCache(fakeStorage());
  const context = cacheContext();
  await cache.save(context, [
    entry("auto", "machine"),
    entry("forced-retranslate", "forced"),
    entry("manual-selection", "selected"),
  ]);

  assert.equal((await cache.match(context, probe()))?.translatedText, "selected");
});

test("BubbleResultCache requires matching text, trustworthy geometry, and reading neighbors", async () => {
  const { BubbleResultCache } = await import("./" + "bubble-result-cache.js");
  const cache = new BubbleResultCache(fakeStorage());
  const context = cacheContext();
  await cache.save(context, [entry("auto", "machine")]);

  assert.equal(await cache.match(context, { ...probe(), sourceText: "HELLO THERE" }), null);
  assert.equal(await cache.match(context, { ...probe(), neighborhood: [] }), null);
  assert.equal(await cache.match(context, { ...probe(), box: { x: 800, y: 900, width: 200, height: 80 } }), null);
});

test("BubbleResultCache misses ambiguous candidates whose best scores are too close", async () => {
  const { BubbleResultCache } = await import("./" + "bubble-result-cache.js");
  const cache = new BubbleResultCache(fakeStorage());
  const context = cacheContext();
  await cache.save(context, [
    { id: "candidate-a", ...probe(), translatedText: "A", priority: "auto" },
    { id: "candidate-b", ...probe(), translatedText: "B", priority: "auto" },
  ]);

  assert.equal(await cache.match(context, probe()), null);
});

test("BubbleResultCache migrates a raw-profile v1 document to v2 and purges the legacy entry", async () => {
  const { BubbleResultCache, bubbleResultCacheKey, legacyBubbleResultCacheKey } = await import("./" + "bubble-result-cache.js");
  const storage = fakeStorage();
  const cache = new BubbleResultCache(storage);
  const context = {
    ...cacheContext(),
    ocrProfile: "https://ocr.private.example/v1",
    translationProfile: "https://translate.private.example/v1:model",
  };
  const key = legacyBubbleResultCacheKey(context);
  await storage.set({ [key]: {
    version: 1,
    fingerprint: context,
    entries: [{ id: "legacy", ...probe(), translatedText: "migrated", priority: "auto" }],
    savedAt: 1,
  } });

  assert.equal((await cache.read(context))[0]?.translatedText, "migrated");
  assert.equal(storage.snapshot()[key], undefined);
  assert.equal((storage.snapshot()[bubbleResultCacheKey(context)] as { version?: unknown }).version, 2);
  assert.doesNotMatch(JSON.stringify(storage.snapshot()), /ocr\.private\.example|translate\.private\.example/);
});

function cacheContext() {
  return {
    imageHash: "image-hash",
    naturalWidth: 1200,
    naturalHeight: 1800,
    ocrProfile: "ocr:v1",
    preprocessingVersion: "preprocess:v1",
    targetLanguage: "zh-CN",
    translationProfile: "translator:v1",
    promptVersion: "prompt:v1",
    layoutVersion: "layout:v1",
  };
}

function probe() {
  return { sourceText: "HELLO WORLD", box: { x: 100, y: 200, width: 200, height: 80 }, neighborhood: ["before", "after"] };
}

function entry(priority: string, translatedText: string) {
  return { id: priority, ...probe(), translatedText, priority };
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
    snapshot() { return { ...data }; },
  };
}
