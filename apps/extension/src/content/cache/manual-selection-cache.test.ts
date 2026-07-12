import test from "node:test";
import assert from "node:assert/strict";
import { ManualSelectionCache, manualSelectionCacheKey, type ManualSelectionCacheStorage } from "./manual-selection-cache.js";
import type { SurfaceResult } from "@umt/shared/types";

test("manualSelectionCacheKey normalizes URL and includes target/provider", () => {
  assert.equal(
    manualSelectionCacheKey({ pageUrl: "https://reader.example/ch/1?x=1#p3", targetLanguage: "zh-CN", providerProfile: "generic-ocr+gpt" }),
    "umt.manual-selection-cache:v1:https://reader.example/ch/1:zh-CN:generic-ocr+gpt",
  );
});

test("ManualSelectionCache saves and restores selected rectangle results", async () => {
  const cache = new ManualSelectionCache(fakeStorage());
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await cache.save(context, {
    id: "manual:10:20:100:80",
    documentRect: { x: 10, y: 20, width: 100, height: 80 },
    naturalSize: { width: 200, height: 160 },
    result: fakeResult("manual:10:20:100:80"),
  });

  const doc = await cache.read(context);
  assert.equal(doc.entries.length, 1);
  assert.equal(doc.entries[0]?.documentRect.y, 20);
  assert.equal(doc.entries[0]?.result.regions[0]?.translatedText, "你好");
});

test("ManualSelectionCache ignores empty results and can clear page selections", async () => {
  const cache = new ManualSelectionCache(fakeStorage());
  const context = { pageUrl: "https://reader.example/ch/1", targetLanguage: "zh-CN", providerProfile: "generic-ocr" };

  await cache.save(context, {
    id: "empty",
    documentRect: { x: 10, y: 20, width: 100, height: 80 },
    naturalSize: { width: 200, height: 160 },
    result: { ...fakeResult("empty"), status: "empty", regions: [] },
  });
  assert.equal((await cache.read(context)).entries.length, 0);

  await cache.save(context, {
    id: "manual:10:20:100:80",
    documentRect: { x: 10, y: 20, width: 100, height: 80 },
    naturalSize: { width: 200, height: 160 },
    result: fakeResult("manual:10:20:100:80"),
  });
  await cache.clear(context);
  assert.equal((await cache.read(context)).entries.length, 0);
});

function fakeStorage(): ManualSelectionCacheStorage {
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
