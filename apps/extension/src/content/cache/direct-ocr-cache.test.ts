import test from "node:test";
import assert from "node:assert/strict";
import { DirectOcrCache, type DirectOcrCacheStorage } from "./direct-ocr-cache.js";
import type { GenericOcrRegion } from "@umt/core";

test("DirectOcrCache saves and reads OCR regions", async () => {
  const storage = fakeStorage();
  const cache = new DirectOcrCache(storage);

  await cache.set("ocr-key", [region("r1")]);

  assert.deepEqual(await cache.get("ocr-key"), [region("r1")]);
});

test("DirectOcrCache does not save empty OCR results", async () => {
  const storage = fakeStorage();
  const cache = new DirectOcrCache(storage);

  await cache.set("empty", []);

  assert.equal(await cache.get("empty"), null);
});

test("DirectOcrCache clears only direct OCR entries and reports stats", async () => {
  const storage = fakeStorage();
  const cache = new DirectOcrCache(storage);
  await cache.set("one", [region("r1")]);
  await cache.set("two", [region("r2")]);
  await storage.set({ "other:key": true });

  const stats = await cache.stats();
  const deleted = await cache.clearAll();

  assert.equal(stats.entries, 2);
  assert.equal(stats.bytes > 0, true);
  assert.equal(deleted, 2);
  assert.equal(await cache.get("one"), null);
  assert.deepEqual(await storage.get("other:key"), { "other:key": true });
});

function fakeStorage(): DirectOcrCacheStorage {
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function region(id: string): GenericOcrRegion {
  return {
    id,
    box: { x: 1, y: 2, width: 30, height: 12 },
    sourceText: "HELLO",
    confidence: 0.99,
    orientation: "horizontal",
    kind: "dialogue",
  };
}
