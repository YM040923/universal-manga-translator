export interface CacheCleanupStorage {
  get(key?: string | null): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(keys: string | string[]): Promise<void> | void;
}

export interface CacheCleanupSummary {
  alreadyRun: boolean;
  removedKeys: number;
  updatedKeys: number;
}

export const ROLLBACK_CACHE_CLEANUP_MARKER = "umt.rollback-cache-cleanup:2026-08-06";

const TRANSLATION_PREFIXES = [
  "umt.chapter-cache:",
  "umt.content-fingerprint-cache:",
  "umt.bubble-result-cache:",
  "umt.manual-selection-cache:",
];

export async function cleanupTranslationCachesForDate(
  storage: CacheCleanupStorage,
  startMs: number,
  endMs: number,
  markerKey = ROLLBACK_CACHE_CLEANUP_MARKER,
): Promise<CacheCleanupSummary> {
  const all = await storage.get(null) ?? {};
  if (all[markerKey]) return { alreadyRun: true, removedKeys: 0, updatedKeys: 0 };

  const removeKeys: string[] = [];
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!TRANSLATION_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const cleaned = cleanTranslationDocument(value, startMs, endMs);
    if (cleaned === null) removeKeys.push(key);
    else if (cleaned !== value) updates[key] = cleaned;
  }

  await storage.set({ ...updates, [markerKey]: { cleanedAt: Date.now(), startMs, endMs } });
  if (removeKeys.length) await storage.remove(removeKeys);
  return { alreadyRun: false, removedKeys: removeKeys.length, updatedKeys: Object.keys(updates).length };
}

function cleanTranslationDocument(value: unknown, startMs: number, endMs: number): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const document = value as Record<string, unknown>;
  if (isRecord(document.entries)) {
    const entries = Object.fromEntries(Object.entries(document.entries).filter(([, entry]) => !isTodaySavedEntry(entry, startMs, endMs)));
    if (!Object.keys(entries).length) return null;
    if (Object.keys(entries).length !== Object.keys(document.entries).length) return { ...document, entries };
    return value;
  }
  if (Array.isArray(document.entries)) {
    const entries = document.entries.filter((entry) => !isTodaySavedEntry(entry, startMs, endMs));
    if (!entries.length) return null;
    if (entries.length !== document.entries.length) return { ...document, entries };
    return value;
  }
  return isTodayTimestamp(document.savedAt, startMs, endMs) ? null : value;
}

function isTodaySavedEntry(value: unknown, startMs: number, endMs: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return isTodayTimestamp((value as Record<string, unknown>).savedAt, startMs, endMs);
}

function isTodayTimestamp(value: unknown, startMs: number, endMs: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= startMs && value < endMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
