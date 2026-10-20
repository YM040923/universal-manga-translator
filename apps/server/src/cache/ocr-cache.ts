import type { OcrRegion } from "../providers/pipeline-provider.js";
import type { UmtDatabase } from "./db.js";

export interface OcrCacheStats {
  entries: number;
  bytes: number;
  updatedAt: number | null;
}

export interface OcrCacheClearResult {
  deleted: number;
}

export interface OcrCacheStore {
  get(cacheKey: string): OcrRegion[] | null;
  save(cacheKey: string, regions: OcrRegion[]): void;
}

export class OcrCache implements OcrCacheStore {
  constructor(private readonly db: UmtDatabase) {}

  get(cacheKey: string): OcrRegion[] | null {
    const row = this.db.prepare("SELECT regions_json FROM ocr_results WHERE cache_key = ?").get(cacheKey) as { regions_json: string } | undefined;
    return row ? (JSON.parse(row.regions_json) as OcrRegion[]) : null;
  }

  save(cacheKey: string, regions: OcrRegion[]): void {
    this.db.prepare(`
      INSERT INTO ocr_results (cache_key, regions_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET regions_json = excluded.regions_json, updated_at = excluded.updated_at
    `).run(cacheKey, JSON.stringify(regions), Date.now());
  }

  stats(): OcrCacheStats {
    const row = this.db.prepare("SELECT COUNT(*) AS entries, COALESCE(SUM(LENGTH(regions_json)), 0) AS bytes, MAX(updated_at) AS updatedAt FROM ocr_results").get() as { entries: number; bytes: number; updatedAt: number | null };
    return { entries: row.entries, bytes: row.bytes, updatedAt: row.updatedAt };
  }

  clear(): OcrCacheClearResult {
    const result = this.db.prepare("DELETE FROM ocr_results").run();
    return { deleted: result.changes };
  }
}
