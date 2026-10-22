import type { SurfaceResult } from "@umt/shared/types";

/** A chapter doc holds one full translation per page, so it is bounded to keep `chrome.storage.local` writes cheap. */
const MAX_CACHED_PAGES = 60;

export interface ChapterResultCacheEntry {
  surfaceId: string;
  /** Page url for an `<img>` or background surface, the surface id for a canvas that has no url. */
  cacheKey: string;
  result: SurfaceResult;
  savedAt: number;
}

export interface ChapterResultCacheDocument {
  version: 1;
  key: string;
  entries: Record<string, ChapterResultCacheEntry>;
}

export interface ChapterResultCacheContext {
  pageUrl: string;
  targetLanguage: string;
  providerProfile: string;
}

export interface ChapterResultCacheStorage {
  get(key: string): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export function chapterResultCacheKey(context: ChapterResultCacheContext): string {
  const url = new URL(context.pageUrl);
  url.search = "";
  url.hash = "";
  return `umt.chapter-cache:v1:${url.origin}${url.pathname}:${context.targetLanguage}:${context.providerProfile}`;
}

export class ChapterResultCache {
  /** Saving is read-modify-write, so concurrent page completions must not interleave on one key. */
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(private readonly storage: ChapterResultCacheStorage = chrome.storage.local) {}

  async read(context: ChapterResultCacheContext): Promise<ChapterResultCacheDocument> {
    const key = chapterResultCacheKey(context);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ChapterResultCacheDocument | undefined;
    if (!doc || doc.version !== 1 || doc.key !== key || !doc.entries || typeof doc.entries !== "object") return { version: 1, key, entries: {} };
    return doc;
  }

  async save(context: ChapterResultCacheContext, cacheKey: string, result: SurfaceResult): Promise<void> {
    if (!cacheKey || result.status === "empty" || result.regions.length === 0) return;
    const key = chapterResultCacheKey(context);
    const entry: ChapterResultCacheEntry = { surfaceId: result.surfaceId, cacheKey, result, savedAt: Date.now() };
    const previous = this.pendingWrites.get(key) ?? Promise.resolve();
    const write = previous.then(() => this.writeEntry(key, context, entry), () => this.writeEntry(key, context, entry));
    const tracked = write.catch(() => undefined);
    this.pendingWrites.set(key, tracked);
    void tracked.finally(() => {
      if (this.pendingWrites.get(key) === tracked) this.pendingWrites.delete(key);
    });
    await write;
  }

  private async writeEntry(key: string, context: ChapterResultCacheContext, entry: ChapterResultCacheEntry): Promise<void> {
    const doc = await this.read(context);
    doc.entries[entry.cacheKey] = entry;
    evictOldestPages(doc.entries);
    await this.storage.set({ [key]: doc });
  }

  async clear(context: ChapterResultCacheContext): Promise<void> {
    await this.storage.remove(chapterResultCacheKey(context));
  }
}

function evictOldestPages(entries: Record<string, ChapterResultCacheEntry>): void {
  const cacheKeys = Object.keys(entries);
  if (cacheKeys.length <= MAX_CACHED_PAGES) return;
  cacheKeys.sort((a, b) => (entries[a]?.savedAt ?? 0) - (entries[b]?.savedAt ?? 0));
  for (const cacheKey of cacheKeys.slice(0, cacheKeys.length - MAX_CACHED_PAGES)) delete entries[cacheKey];
}
