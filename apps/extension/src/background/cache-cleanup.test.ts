import test from "node:test";
import assert from "node:assert/strict";
import { cleanupTranslationCachesForDate, type CacheCleanupStorage } from "./cache-cleanup.js";

const DAY_START = 1785945600000;
const DAY_END = 1786032000000;

test("rollback cache cleanup removes only today's translation cache and preserves OCR/configuration", async () => {
  const storage = fakeStorage({
    "umt.content-fingerprint-cache:v2:today": { savedAt: DAY_START + 100, result: { status: "completed" } },
    "umt.content-fingerprint-cache:v2:old": { savedAt: DAY_START - 100, result: { status: "completed" } },
    "umt.chapter-cache:v2:chapter": {
      version: 2,
      entries: {
        today: { savedAt: DAY_START + 200, result: { status: "completed", regions: [{}] } },
        old: { savedAt: DAY_START - 200, result: { status: "completed", regions: [{}] } },
      },
    },
    "umt.bubble-result-cache:v2:bubbles": {
      savedAt: DAY_START + 300,
      entries: [
        { id: "today", savedAt: DAY_START + 300, translatedText: "今天" },
        { id: "old", savedAt: DAY_START - 300, translatedText: "旧缓存" },
      ],
    },
    "umt.direct-ocr-cache:v2:ocr": { savedAt: DAY_START + 400, regions: [{}] },
    "umt.settings": { directOcr: { apiKeys: ["keep-me"] } },
  });

  const summary = await cleanupTranslationCachesForDate(storage, DAY_START, DAY_END);
  const remaining = storage.snapshot();

  assert.equal(summary.alreadyRun, false);
  assert.equal(remaining["umt.content-fingerprint-cache:v2:today"], undefined);
  assert.ok(remaining["umt.content-fingerprint-cache:v2:old"]);
  assert.deepEqual(Object.keys((remaining["umt.chapter-cache:v2:chapter"] as { entries: Record<string, unknown> }).entries), ["old"]);
  assert.deepEqual((remaining["umt.bubble-result-cache:v2:bubbles"] as { entries: Array<{ id: string }> }).entries.map((entry) => entry.id), ["old"]);
  assert.ok(remaining["umt.direct-ocr-cache:v2:ocr"]);
  assert.ok(remaining["umt.settings"]);
});

test("rollback cache cleanup is idempotent after its marker is written", async () => {
  const storage = fakeStorage({});
  const first = await cleanupTranslationCachesForDate(storage, DAY_START, DAY_END);
  const second = await cleanupTranslationCachesForDate(storage, DAY_START, DAY_END);

  assert.equal(first.alreadyRun, false);
  assert.equal(second.alreadyRun, true);
});

function fakeStorage(initial: Record<string, unknown>): CacheCleanupStorage & { snapshot(): Record<string, unknown> } {
  const data = { ...initial };
  return {
    async get() { return { ...data }; },
    async set(value) { Object.assign(data, value); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    snapshot() { return { ...data }; },
  };
}
