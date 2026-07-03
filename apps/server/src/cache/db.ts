import Database from "better-sqlite3";

export type UmtDatabase = Database.Database;

export function openDatabase(path: string): UmtDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS surface_results (
      cache_key TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manual_overrides (
      image_hash TEXT NOT NULL,
      target_language TEXT NOT NULL,
      region_id TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (image_hash, target_language, region_id)
    );

    CREATE TABLE IF NOT EXISTS ocr_results (
      cache_key TEXT PRIMARY KEY,
      regions_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}
