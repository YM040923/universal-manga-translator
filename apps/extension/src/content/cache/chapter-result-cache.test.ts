import test from "node:test";
import assert from "node:assert/strict";
import { ChapterResultCache, chapterResultCacheKey, type ChapterResultCacheStorage } from "./chapter-result-cache.js";
import type { SurfaceResult } from "@umt/shared/types";

test("chapterResultCacheKey normalizes URL and includes target/provider", () => {
  assert.equal(
    chapterResultCacheKey({ pageUrl: "https://reader.example/comic/1?x=1#p2", targetLanguage: "zh-CN", providerProfile: "generic-ocr+gpt" }),
    "umt.chapter-cache:v1:https://reader.example/comic/1:zh-CN:generic-ocr+gpt",
  );
});

test("ChapterResultCache saves and reads renderable results by image URL", async () => {
  const storage = fakeStorage();
  const cache = new ChapterResultCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await cache.save(context, "https://cdn.example/1.webp", fakeResult("s1"));
  const doc = await cache.read(context);

  assert.equal(doc.entries["https://cdn.example/1.webp"]?.result.surfaceId, "s1");
  assert.equal(doc.entries["https://cdn.example/1.webp"]?.result.regions.length, 1);
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
