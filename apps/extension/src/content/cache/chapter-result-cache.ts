import type { SurfaceResult } from "@umt/shared/types";

export interface ChapterResultCacheEntry {
  surfaceId: string;
  imageUrl: string;
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
  constructor(private readonly storage: ChapterResultCacheStorage = chrome.storage.local) {}

  async read(context: ChapterResultCacheContext): Promise<ChapterResultCacheDocument> {
    const key = chapterResultCacheKey(context);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ChapterResultCacheDocument | undefined;
    if (!doc || doc.version !== 1 || doc.key !== key || !doc.entries || typeof doc.entries !== "object") return { version: 1, key, entries: {} };
    return doc;
  }

  async save(context: ChapterResultCacheContext, imageUrl: string, result: SurfaceResult): Promise<void> {
    if (!imageUrl || result.status === "empty" || result.regions.length === 0) return;
    const doc = await this.read(context);
    doc.entries[imageUrl] = { surfaceId: result.surfaceId, imageUrl, result, savedAt: Date.now() };
    await this.storage.set({ [doc.key]: doc });
  }

  async clear(context: ChapterResultCacheContext): Promise<void> {
    await this.storage.remove(chapterResultCacheKey(context));
  }
}
