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

test("concurrent saves for one chapter keep every page", async () => {
  const storage = fakeStorage();
  const cache = new ChapterResultCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await Promise.all([
    cache.save(context, "https://cdn.example/1.webp", fakeResult("s1")),
    cache.save(context, "https://cdn.example/2.webp", fakeResult("s2")),
    cache.save(context, "https://cdn.example/3.webp", fakeResult("s3")),
  ]);

  const doc = await cache.read(context);
  assert.deepEqual(Object.keys(doc.entries).sort(), [
    "https://cdn.example/1.webp",
    "https://cdn.example/2.webp",
    "https://cdn.example/3.webp",
  ]);
});

test("ChapterResultCache evicts the oldest pages once the chapter is full", async () => {
  const storage = fakeStorage();
  const cache = new ChapterResultCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  for (let page = 1; page <= 65; page += 1) {
    await cache.save(context, `https://cdn.example/${page}.webp`, fakeResult(`s${page}`));
  }

  const doc = await cache.read(context);
  assert.equal(Object.keys(doc.entries).length, 60);
  assert.equal(doc.entries["https://cdn.example/5.webp"], undefined);
  assert.ok(doc.entries["https://cdn.example/65.webp"]);
});

test("ChapterResultCache keeps queued writes flowing after a storage failure", async () => {
  const storage = fakeStorage({ failFirstWrite: true });
  const cache = new ChapterResultCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await assert.rejects(() => cache.save(context, "https://cdn.example/1.webp", fakeResult("s1")));
  await cache.save(context, "https://cdn.example/2.webp", fakeResult("s2"));

  const doc = await cache.read(context);
  assert.deepEqual(Object.keys(doc.entries), ["https://cdn.example/2.webp"]);
});

function fakeStorage(options: { failFirstWrite?: boolean } = {}): ChapterResultCacheStorage {
  const data: Record<string, unknown> = {};
  let writes = 0;
  return {
    async get(key?: string | string[] | Record<string, unknown> | null) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) {
      writes += 1;
      if (options.failFirstWrite && writes === 1) throw new Error("QUOTA_BYTES exceeded");
      Object.assign(data, value);
    },
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
