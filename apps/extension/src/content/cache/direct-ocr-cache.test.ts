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

test("DirectOcrCache does not save garbled OCR results", async () => {
  const storage = fakeStorage();
  const cache = new DirectOcrCache(storage);

  await cache.set("garbled", [region("r1", "ãƒ†ã‚¹ãƒˆ")]);

  assert.equal(await cache.get("garbled"), null);
});

test("DirectOcrCache evicts a legacy garbled entry on read", async () => {
  const storage = fakeStorage();
  const storageKey = "umt.direct-ocr-cache:v1:legacy";
  await storage.set({ [storageKey]: { version: 1, regions: [region("r1", "ãƒ†ã‚¹ãƒˆ")], savedAt: 1 } });
  const cache = new DirectOcrCache(storage);

  assert.equal(await cache.get("legacy"), null);
  const remaining = await storage.get(storageKey);
  assert.equal((remaining ?? {})[storageKey], undefined);
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

function region(id: string, sourceText = "HELLO"): GenericOcrRegion {
  return {
    id,
    box: { x: 1, y: 2, width: 30, height: 12 },
    sourceText,
    confidence: 0.99,
    orientation: "horizontal",
    kind: "dialogue",
  };
}
