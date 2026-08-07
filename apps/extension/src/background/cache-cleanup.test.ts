import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLLBACK_CACHE_CLEANUP_END_MS,
  ROLLBACK_CACHE_CLEANUP_MARKER,
  ROLLBACK_CACHE_CLEANUP_START_MS,
  cleanupTranslationCachesForRange,
  type CacheCleanupStorage,
} from "./cache-cleanup.js";

const START_MS = 1785945600000; // 2026-08-06 00:00:00 +08:00
const END_MS = 1786118400000; // 2026-08-08 00:00:00 +08:00

test("rollback cleanup covers Aug 6 and Aug 7 in China Standard Time", () => {
  assert.equal(ROLLBACK_CACHE_CLEANUP_START_MS, START_MS);
  assert.equal(ROLLBACK_CACHE_CLEANUP_END_MS, END_MS);
});

test("rollback cleanup removes Aug 6-7 translation results but preserves OCR, settings, and manual edits", async () => {
  const chapterKey = "umt.chapter-cache:v1:https://reader.example/ch/1:zh-CN:provider";
  const manualSelectionKey = "umt.manual-selection-cache:v1:https://reader.example/ch/1:zh-CN:provider";
  const directOcrKey = "umt.direct-ocr-cache:v1:image";
  const manualOverrideKey = "umt.manual-overrides:v1:image:zh-CN";
  const storage = fakeStorage({
    [chapterKey]: {
      version: 1,
      key: chapterKey,
      entries: {
        old: { savedAt: START_MS - 1, result: { regions: [{ translatedText: "旧译文" }] } },
        aug6: { savedAt: START_MS, result: { regions: [{ translatedText: "错误译文一" }] } },
        aug7: { savedAt: END_MS - 1, result: { regions: [{ translatedText: "错误译文二" }] } },
      },
    },
    [manualSelectionKey]: {
      version: 1,
      key: manualSelectionKey,
      entries: [
        { id: "old", savedAt: START_MS - 1 },
        { id: "aug7", savedAt: END_MS - 1 },
      ],
    },
    [directOcrKey]: { version: 1, savedAt: END_MS - 1, regions: [{ sourceText: "OCR" }] },
    [manualOverrideKey]: { version: 1, updatedAt: END_MS - 1, overrides: { r1: { translatedText: "我的修改" } } },
    "umt.settings": { directOcr: { apiKeys: ["secret"] } },
    "umt.rollback-cache-cleanup:2026-08-06": { cleanedAt: START_MS },
  });

  const summary = await cleanupTranslationCachesForRange(storage, START_MS, END_MS);
  const data = storage.snapshot();

  assert.deepEqual(Object.keys((data[chapterKey] as { entries: Record<string, unknown> }).entries), ["old"]);
  assert.deepEqual((data[manualSelectionKey] as { entries: Array<{ id: string }> }).entries.map((entry) => entry.id), ["old"]);
  assert.deepEqual(data[directOcrKey], { version: 1, savedAt: END_MS - 1, regions: [{ sourceText: "OCR" }] });
  assert.deepEqual(data[manualOverrideKey], { version: 1, updatedAt: END_MS - 1, overrides: { r1: { translatedText: "我的修改" } } });
  assert.deepEqual(data["umt.settings"], { directOcr: { apiKeys: ["secret"] } });
  assert.equal(Boolean(data[ROLLBACK_CACHE_CLEANUP_MARKER]), true);
  assert.deepEqual(summary, { alreadyRun: false, removedKeys: 0, updatedKeys: 2 });
});

test("rollback cleanup removes translation documents containing only affected entries and runs once per marker", async () => {
  const chapterKey = "umt.chapter-cache:v1:https://reader.example/ch/2:zh-CN:provider";
  const storage = fakeStorage({
    [chapterKey]: {
      version: 1,
      key: chapterKey,
      entries: {
        aug7: { savedAt: END_MS - 1 },
      },
    },
  });

  assert.deepEqual(
    await cleanupTranslationCachesForRange(storage, START_MS, END_MS),
    { alreadyRun: false, removedKeys: 1, updatedKeys: 0 },
  );
  assert.equal(chapterKey in storage.snapshot(), false);
  assert.deepEqual(
    await cleanupTranslationCachesForRange(storage, START_MS, END_MS),
    { alreadyRun: true, removedKeys: 0, updatedKeys: 0 },
  );
});

function fakeStorage(initial: Record<string, unknown>): CacheCleanupStorage & { snapshot(): Record<string, unknown> } {
  const data = structuredClone(initial);
  return {
    async get() {
      return structuredClone(data);
    },
    async set(value) {
      Object.assign(data, structuredClone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    snapshot() {
      return structuredClone(data);
    },
  };
}
