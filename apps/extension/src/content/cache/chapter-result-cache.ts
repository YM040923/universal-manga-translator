import type { SurfaceResult } from "@umt/shared/types";

export interface ChapterResultCacheEntry {
  surfaceId: string;
  imageUrlHash: string;
  result: SurfaceResult;
  savedAt: number;
}

export interface ChapterResultCacheDocument {
  version: 2;
  key: string;
  entries: Record<string, ChapterResultCacheEntry>;
}

interface LegacyChapterResultCacheEntry {
  surfaceId: string;
  imageUrl: string;
  result: SurfaceResult;
  savedAt: number;
}

interface LegacyChapterResultCacheDocument {
  version: 1;
  key: string;
  entries: Record<string, LegacyChapterResultCacheEntry>;
}

export interface ChapterResultCacheContext {
  pageUrl: string;
  targetLanguage: string;
  providerProfile: string;
}

export interface ChapterResultCacheStorage {
  get(key: string): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(key: string | string[]): Promise<void> | void;
}

const V1_PREFIX = "umt.chapter-cache:v1:";
const V2_PREFIX = "umt.chapter-cache:v2:";

export function chapterResultCacheKey(context: ChapterResultCacheContext): string {
  return `${V2_PREFIX}${opaqueContext(context)}`;
}

export function legacyChapterResultCacheKey(context: ChapterResultCacheContext): string {
  const url = normalizedPageUrl(context.pageUrl);
  return `${V1_PREFIX}${url}:${context.targetLanguage}:${context.providerProfile}`;
}

export class ChapterResultCache {
  constructor(private readonly storage: ChapterResultCacheStorage = getDefaultStorage()) {}

  async read(context: ChapterResultCacheContext): Promise<ChapterResultCacheDocument> {
    const v2 = await this.readV2(context);
    const legacy = await this.readLegacyDocument(context);
    if (!legacy) return v2;
    const migrated: ChapterResultCacheDocument = {
      ...v2,
      entries: { ...legacyEntries(legacy), ...v2.entries },
    };
    await this.storage.set({ [migrated.key]: migrated });
    await this.storage.remove(legacy.key);
    return migrated;
  }

  async get(context: ChapterResultCacheContext, imageUrl: string): Promise<ChapterResultCacheEntry | null> {
    if (!imageUrl) return null;
    return (await this.read(context)).entries[imageUrlHash(imageUrl)] ?? null;
  }

  async save(context: ChapterResultCacheContext, imageUrl: string, result: SurfaceResult | { status: string; regions?: unknown }): Promise<void> {
    if (!imageUrl || !isReusableResult(result)) return;
    const imageUrlId = imageUrlHash(imageUrl);
    const entry: ChapterResultCacheEntry = { surfaceId: result.surfaceId, imageUrlHash: imageUrlId, result: cloneResult(result), savedAt: Date.now() };
    const v2 = await this.read(context);
    v2.entries[imageUrlId] = entry;
    await this.storage.set({ [v2.key]: v2 });
  }

  async clear(context: ChapterResultCacheContext): Promise<void> {
    await this.storage.remove([chapterResultCacheKey(context), legacyChapterResultCacheKey(context)]);
  }

  private async readV2(context: ChapterResultCacheContext): Promise<ChapterResultCacheDocument> {
    const key = chapterResultCacheKey(context);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ChapterResultCacheDocument | undefined;
    if (!isV2Document(doc, key)) return { version: 2, key, entries: {} };
    return { ...doc, entries: Object.fromEntries(Object.entries(doc.entries).filter(([, entry]) => isReusableEntry(entry))) };
  }

  private async readLegacyDocument(context: ChapterResultCacheContext): Promise<LegacyChapterResultCacheDocument | null> {
    const key = legacyChapterResultCacheKey(context);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as LegacyChapterResultCacheDocument | undefined;
    if (!isV1Document(doc, key)) return null;
    return { ...doc, entries: Object.fromEntries(Object.entries(doc.entries).filter(([, entry]) => isLegacyReusableEntry(entry))) };
  }
}

function legacyEntries(doc: LegacyChapterResultCacheDocument): Record<string, ChapterResultCacheEntry> {
  return Object.fromEntries(Object.values(doc.entries).map((entry) => [
    imageUrlHash(entry.imageUrl),
    { surfaceId: entry.surfaceId, imageUrlHash: imageUrlHash(entry.imageUrl), result: cloneResult(entry.result), savedAt: entry.savedAt },
  ]));
}

function isV2Document(value: unknown, key: string): value is ChapterResultCacheDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<ChapterResultCacheDocument>;
  return doc.version === 2 && doc.key === key && Boolean(doc.entries) && typeof doc.entries === "object" && !Array.isArray(doc.entries);
}

function isV1Document(value: unknown, key: string): value is LegacyChapterResultCacheDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<LegacyChapterResultCacheDocument>;
  return doc.version === 1 && doc.key === key && Boolean(doc.entries) && typeof doc.entries === "object" && !Array.isArray(doc.entries);
}

function isReusableEntry(value: unknown): value is ChapterResultCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ChapterResultCacheEntry>;
  return typeof entry.surfaceId === "string" && typeof entry.imageUrlHash === "string" && isReusableResult(entry.result);
}

function isLegacyReusableEntry(value: unknown): value is LegacyChapterResultCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<LegacyChapterResultCacheEntry>;
  return typeof entry.surfaceId === "string" && typeof entry.imageUrl === "string" && isReusableResult(entry.result);
}

function isReusableResult(value: unknown): value is SurfaceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<SurfaceResult>;
  return (result.status === "completed" || result.status === "cached") && Array.isArray(result.regions) && result.regions.length > 0
    && typeof result.surfaceId === "string" && typeof result.imageHash === "string";
}

function normalizedPageUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  return `${url.origin}${url.pathname}`;
}

function imageUrlHash(imageUrl: string): string {
  return `u${opaqueId(imageUrl)}`;
}

function opaqueContext(context: ChapterResultCacheContext): string {
  return opaqueId(JSON.stringify([normalizedPageUrl(context.pageUrl), context.targetLanguage, context.providerProfile]));
}

function opaqueId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `c${hash.toString(16).padStart(8, "0")}`;
}

function cloneResult(result: SurfaceResult): SurfaceResult { return JSON.parse(JSON.stringify(result)) as SurfaceResult; }

function getDefaultStorage(): ChapterResultCacheStorage {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  const data: Record<string, unknown> = {};
  return { async get(key: string) { return { [key]: data[key] }; }, async set(value: Record<string, unknown>) { Object.assign(data, value); }, async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
}
