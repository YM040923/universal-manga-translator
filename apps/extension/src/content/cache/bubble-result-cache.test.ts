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

test("BubbleResultCache gives deletion tombstones precedence over every other source", async () => {
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

  assert.equal(match?.priority, "manual-tombstone");
  assert.equal(match?.translatedText, "");
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
  };
}