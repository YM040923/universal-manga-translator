import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SurfaceResult } from "@umt/shared";
import { openDatabase } from "./db.js";
import { SurfaceCache } from "./surface-cache.js";

test("SurfaceCache persists and reloads results", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-cache-"));
  try {
    const dbPath = join(dir, "cache.sqlite");
    const result: SurfaceResult = { surfaceId: "s1", imageHash: "h1", status: "completed", regions: [], providerProfile: "mock", layoutVersion: 1, elapsedMs: 10 };
    const db1 = openDatabase(dbPath);
    new SurfaceCache(db1).save("key1", result);
    db1.close();
    const db2 = openDatabase(dbPath);
    assert.deepEqual(new SurfaceCache(db2).get("key1"), result);
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SurfaceCache reports stats and clears entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "umt-cache-stats-"));
  try {
    const db = openDatabase(join(dir, "cache.sqlite"));
    const cache = new SurfaceCache(db);
    const result: SurfaceResult = { surfaceId: "s1", imageHash: "h1", status: "completed", regions: [], providerProfile: "mock", layoutVersion: 1, elapsedMs: 10 };
    cache.save("key1", result);
    cache.save("key2", { ...result, surfaceId: "s2", imageHash: "h2" });

    assert.equal(cache.stats().entries, 2);
    assert.equal(cache.stats().bytes > 0, true);
    assert.equal(cache.clear().deleted, 2);
    assert.equal(cache.stats().entries, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
