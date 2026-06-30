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
  `);
  return db;
}
