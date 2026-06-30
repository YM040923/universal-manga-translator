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
