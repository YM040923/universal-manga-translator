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

export const ROLLBACK_CACHE_CLEANUP_START_MS = 1785945600000;
export const ROLLBACK_CACHE_CLEANUP_END_MS = 1786118400000;
export const ROLLBACK_CACHE_CLEANUP_MARKER = "umt.rollback-cache-cleanup:2026-08-06-through-2026-08-07";

const TRANSLATION_PREFIXES = [
  "umt.chapter-cache:",
  "umt.content-fingerprint-cache:",
  "umt.bubble-result-cache:",
  "umt.manual-selection-cache:",
];

export async function cleanupTranslationCachesForRange(
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
  if (!isRecord(value)) return value;
  if (isRecord(value.entries)) {
    const entries = Object.fromEntries(
      Object.entries(value.entries).filter(([, entry]) => !isSavedInRange(entry, startMs, endMs)),
    );
    if (!Object.keys(entries).length) return null;
    if (Object.keys(entries).length !== Object.keys(value.entries).length) return { ...value, entries };
    return value;
  }
  if (Array.isArray(value.entries)) {
    const entries = value.entries.filter((entry) => !isSavedInRange(entry, startMs, endMs));
    if (!entries.length) return null;
    if (entries.length !== value.entries.length) return { ...value, entries };
    return value;
  }
  return isTimestampInRange(value.savedAt, startMs, endMs) ? null : value;
}

function isSavedInRange(value: unknown, startMs: number, endMs: number): boolean {
  return isRecord(value) && isTimestampInRange(value.savedAt, startMs, endMs);
}

function isTimestampInRange(value: unknown, startMs: number, endMs: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= startMs && value < endMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
