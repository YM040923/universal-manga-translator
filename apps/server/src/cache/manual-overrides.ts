import type { SurfaceResult } from "@umt/shared";
import type { UmtDatabase } from "./db.js";

export interface ManualOverride {
  imageHash: string;
  targetLanguage: string;
  regionId: string;
  translatedText: string;
}

interface ManualOverrideRow {
  image_hash: string;
  target_language: string;
  region_id: string;
  translated_text: string;
}

export class ManualOverrideStore {
  constructor(private readonly db: UmtDatabase) {}

  save(override: ManualOverride): void {
    this.db.prepare(`
      INSERT INTO manual_overrides (image_hash, target_language, region_id, translated_text, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(image_hash, target_language, region_id)
      DO UPDATE SET translated_text = excluded.translated_text, updated_at = excluded.updated_at
    `).run(override.imageHash, override.targetLanguage, override.regionId, override.translatedText, Date.now());
  }

  listForImage(imageHash: string, targetLanguage: string): ManualOverride[] {
    const rows = this.db.prepare(`
      SELECT image_hash, target_language, region_id, translated_text
      FROM manual_overrides
      WHERE image_hash = ? AND target_language = ?
      ORDER BY region_id ASC
    `).all(imageHash, targetLanguage) as ManualOverrideRow[];
    return rows.map((row) => ({ imageHash: row.image_hash, targetLanguage: row.target_language, regionId: row.region_id, translatedText: row.translated_text }));
  }
}

export function applyManualOverrides(result: SurfaceResult, overrides: ManualOverride[]): SurfaceResult {
  if (!overrides.length) return result;
  const byRegion = new Map(overrides.map((override) => [override.regionId, override.translatedText]));
  return {
    ...result,
    regions: result.regions.map((region) => byRegion.has(region.id) ? { ...region, translatedText: byRegion.get(region.id)! } : region),
  };
}