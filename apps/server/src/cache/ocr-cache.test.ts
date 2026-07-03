import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.js";
import { OcrCache } from "./ocr-cache.js";
import type { OcrRegion } from "../providers/pipeline-provider.js";

const regions: OcrRegion[] = [
  { id: "r1", box: { x: 1, y: 2, width: 30, height: 40 }, sourceText: "HELLO", confidence: 0.9, orientation: "horizontal", kind: "dialogue" },
];

test("OcrCache saves, reads, stats and clears OCR regions", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-ocr-cache-"));
  const db = openDatabase(join(dir, "cache.sqlite"));
  try {
    const cache = new OcrCache(db);

    assert.equal(cache.get("missing"), null);
    cache.save("key-a", regions);

    assert.deepEqual(cache.get("key-a"), regions);
    assert.equal(cache.stats().entries, 1);
    assert.equal(cache.clear().deleted, 1);
    assert.equal(cache.get("key-a"), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
