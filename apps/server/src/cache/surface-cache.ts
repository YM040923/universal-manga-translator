import type { SurfaceResult } from "@umt/shared";
import type { UmtDatabase } from "./db.js";

export class SurfaceCache {
  constructor(private readonly db: UmtDatabase) {}

  get(cacheKey: string): SurfaceResult | null {
    const row = this.db.prepare("SELECT result_json FROM surface_results WHERE cache_key = ?").get(cacheKey) as { result_json: string } | undefined;
    return row ? (JSON.parse(row.result_json) as SurfaceResult) : null;
  }

  save(cacheKey: string, result: SurfaceResult): void {
    this.db.prepare(`
      INSERT INTO surface_results (cache_key, result_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET result_json = excluded.result_json, updated_at = excluded.updated_at
    `).run(cacheKey, JSON.stringify(result), Date.now());
  }
}
