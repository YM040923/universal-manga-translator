import test from "node:test";
import assert from "node:assert/strict";
import { ChapterResultCache, chapterResultCacheKey, type ChapterResultCacheStorage } from "./chapter-result-cache.js";
import type { SurfaceResult } from "@umt/shared/types";

test("chapterResultCacheKey normalizes URL and keeps its v2 storage identifier opaque", () => {
  const left = chapterResultCacheKey({ pageUrl: "https://reader.example/comic/1?x=1#p2", targetLanguage: "zh-CN", providerProfile: "generic-ocr+gpt" });
  const right = chapterResultCacheKey({ pageUrl: "https://reader.example/comic/1?x=2#p3", targetLanguage: "zh-CN", providerProfile: "generic-ocr+gpt" });
  assert.match(left, /^umt\.chapter-cache:v2:/);
  assert.equal(left, right);
  assert.doesNotMatch(left, /reader\.example|generic-ocr/);
});

test("ChapterResultCache saves and reads renderable results by image URL", async () => {
  const storage = fakeStorage();
  const cache = new ChapterResultCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await cache.save(context, "https://cdn.example/1.webp", fakeResult("s1"));
  const entry = await cache.get(context, "https://cdn.example/1.webp");

  assert.equal(entry?.result.surfaceId, "s1");
  assert.equal(entry?.result.regions.length, 1);
});

test("ChapterResultCache ignores empty results and can clear a chapter", async () => {
  const storage = fakeStorage();
  const cache = new ChapterResultCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await cache.save(context, "https://cdn.example/empty.webp", { ...fakeResult("empty"), status: "empty", regions: [] });
  assert.deepEqual((await cache.read(context)).entries, {});

  await cache.save(context, "https://cdn.example/1.webp", fakeResult("s1"));
  await cache.clear(context);
  assert.deepEqual((await cache.read(context)).entries, {});
});

function fakeStorage(): ChapterResultCacheStorage {
  const data: Record<string, unknown> = {};
  return {
    async get(key?: string | string[] | Record<string, unknown> | null) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}

function fakeResult(surfaceId: string): SurfaceResult {
  return {
    surfaceId,
    imageHash: "hash",
    status: "completed",
    providerProfile: "generic-ocr",
    layoutVersion: 1,
    elapsedMs: 10,
    regions: [{
      id: "r1",
      box: { x: 1, y: 2, width: 3, height: 4 },
      sourceText: "hi",
      translatedText: "你好",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 14, writingMode: "horizontal-tb", align: "center", background: "#fff", color: "#111" },
    }],
  };
}
