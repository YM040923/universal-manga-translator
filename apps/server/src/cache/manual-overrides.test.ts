import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SurfaceResult } from "@umt/shared";
import { openDatabase } from "./db.js";
import { ManualOverrideStore, applyManualOverrides } from "./manual-overrides.js";

test("ManualOverrideStore persists and lists overrides by image hash and target language", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-overrides-"));
  try {
    const dbPath = join(dir, "cache.sqlite");
    const db1 = openDatabase(dbPath);
    new ManualOverrideStore(db1).save({ imageHash: "hash1", targetLanguage: "zh-CN", regionId: "r1", translatedText: "人工修正" });
    db1.close();

    const db2 = openDatabase(dbPath);
    assert.deepEqual(new ManualOverrideStore(db2).listForImage("hash1", "zh-CN"), [{ imageHash: "hash1", targetLanguage: "zh-CN", regionId: "r1", translatedText: "人工修正" }]);
    assert.deepEqual(new ManualOverrideStore(db2).listForImage("hash1", "en"), []);
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyManualOverrides replaces matching region translated text", () => {
  const result: SurfaceResult = {
    surfaceId: "s1",
    imageHash: "hash1",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 0, y: 0, width: 100, height: 100 },
      sourceText: "hello",
      translatedText: "机器译文",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  };

  const applied = applyManualOverrides(result, [{ imageHash: "hash1", targetLanguage: "zh-CN", regionId: "r1", translatedText: "人工修正" }]);

  assert.equal(applied.regions[0]?.translatedText, "人工修正");
  assert.equal(result.regions[0]?.translatedText, "机器译文");
});
test("applyManualOverrides removes regions overridden with empty text", () => {
  const result: SurfaceResult = {
    surfaceId: "s1",
    imageHash: "hash1",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 0, y: 0, width: 100, height: 100 },
      sourceText: "hello",
      translatedText: "machine translation",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  };

  const applied = applyManualOverrides(result, [{ imageHash: "hash1", targetLanguage: "zh-CN", regionId: "r1", translatedText: "   " }]);

  assert.deepEqual(applied.regions, []);
});
