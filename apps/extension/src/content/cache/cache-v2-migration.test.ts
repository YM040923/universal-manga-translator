import test from "node:test";
import assert from "node:assert/strict";
import { ChapterResultCache, chapterResultCacheKey, type ChapterResultCacheStorage } from "./chapter-result-cache.js";
import { ManualSelectionCache, type ManualSelectionCacheStorage } from "./manual-selection-cache.js";
import { DirectOcrCache, type DirectOcrCacheStorage } from "./direct-ocr-cache.js";

test("v2 chapter cache double-writes and never restores failed or empty entries", async () => {
  const storage = fakeStorage();
  const context = { pageUrl: "https://reader.example/ch/1?token=secret", targetLanguage: "zh-CN", providerProfile: "direct:test" };
  const cache = new ChapterResultCache(storage);
  await cache.save(context, "https://cdn.example/a.webp", result());

  assert.match(chapterResultCacheKey(context), /^umt\.chapter-cache:v2:/);
  assert.equal(Object.keys(storage.snapshot()).filter((key) => key.startsWith("umt.chapter-cache:v")).length, 2);

  await storage.set({
    [chapterResultCacheKey(context)]: {
      version: 2,
      key: chapterResultCacheKey(context),
      entries: {
        failed: { surfaceId: "failed", imageUrl: "https://cdn.example/failed.webp", result: { status: "failed", regions: [] }, savedAt: Date.now() },
        empty: { surfaceId: "empty", imageUrl: "https://cdn.example/empty.webp", result: { ...result(), status: "empty", regions: [] }, savedAt: Date.now() },
      },
    },
  });
  await storage.remove(Object.keys(storage.snapshot()).filter((key) => key.startsWith("umt.chapter-cache:v1:")));
  assert.deepEqual((await cache.read(context)).entries, {});
});

test("v2 manual selections double-write and retain their highest-priority marker", async () => {
  const storage = fakeStorage();
  const cache = new ManualSelectionCache(storage);
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "direct:test" };
  await cache.save(context, {
    id: "manual:1",
    documentRect: { x: 1, y: 2, width: 30, height: 40 },
    naturalSize: { width: 30, height: 40 },
    result: result(),
  });
  const doc = await cache.read(context);

  assert.equal(doc.version, 2);
  assert.equal((doc.entries[0] as any)?.priority, "manual-selection");
  assert.equal(Object.keys(storage.snapshot()).filter((key) => key.startsWith("umt.manual-selection-cache:v")).length, 2);
});

test("DirectOcrCache double-reads v1 and double-writes v2 without caching empty OCR", async () => {
  const storage = fakeStorage();
  const cache = new DirectOcrCache(storage);
  await cache.set("legacy-key", [ocrRegion()]);
  assert.equal(Object.keys(storage.snapshot()).filter((key) => key.startsWith("umt.direct-ocr-cache:v")).length, 2);

  const v1Key = Object.keys(storage.snapshot()).find((key) => key.startsWith("umt.direct-ocr-cache:v1:"))!;
  const v1Value = storage.snapshot()[v1Key];
  await storage.remove(Object.keys(storage.snapshot()).filter((key) => key.startsWith("umt.direct-ocr-cache:v2:")));
  assert.deepEqual(await cache.get("legacy-key"), [ocrRegion()]);
  await storage.set({ [v1Key]: { ...(v1Value as Record<string, unknown>), regions: [] } });
  assert.equal(await cache.get("legacy-key"), null);
});

function result() {
  return {
    surfaceId: "s1", imageHash: "hash", status: "completed" as const, providerProfile: "direct:test", layoutVersion: 1, elapsedMs: 1,
    regions: [{ id: "r1", box: { x: 1, y: 2, width: 30, height: 10 }, sourceText: "HELLO", translatedText: "你好", confidence: 1, orientation: "horizontal" as const, kind: "dialogue" as const, style: { fontSize: 16, writingMode: "horizontal-tb" as const, align: "center" as const, background: "#fff", color: "#111" } }],
  };
}
function ocrRegion() { return { id: "o1", box: { x: 1, y: 2, width: 3, height: 4 }, sourceText: "HELLO", confidence: 1, orientation: "horizontal" as const, kind: "dialogue" as const }; }
function fakeStorage(): ChapterResultCacheStorage & ManualSelectionCacheStorage & DirectOcrCacheStorage & { snapshot(): Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) { if (typeof key === "string") return { [key]: data[key] }; return { ...data }; },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    snapshot() { return { ...data }; },
  };
}
