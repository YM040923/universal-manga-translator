import type { Rect, Size, SurfaceResult } from "@umt/shared/types";

export interface ManualSelectionCacheContext {
  pageUrl: string;
  targetLanguage: string;
  providerProfile: string;
}

export interface ManualSelectionCacheEntry {
  id: string;
  documentRect: Rect;
  naturalSize: Size;
  result: SurfaceResult;
  savedAt?: number;
}

export interface ManualSelectionCacheDocument {
  version: 1;
  key: string;
  entries: ManualSelectionCacheEntry[];
}

export interface ManualSelectionCacheStorage {
  get(key: string): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export function manualSelectionCacheKey(context: ManualSelectionCacheContext): string {
  const url = new URL(context.pageUrl);
  url.search = "";
  url.hash = "";
  return `umt.manual-selection-cache:v1:${url.origin}${url.pathname}:${context.targetLanguage}:${context.providerProfile}`;
}

export class ManualSelectionCache {
  constructor(private readonly storage: ManualSelectionCacheStorage = chrome.storage.local) {}

  async read(context: ManualSelectionCacheContext): Promise<ManualSelectionCacheDocument> {
    const key = manualSelectionCacheKey(context);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ManualSelectionCacheDocument | undefined;
    if (!isManualSelectionCacheDocument(doc, key)) return { version: 1, key, entries: [] };
    return { ...doc, entries: doc.entries.filter(isManualSelectionCacheEntry) };
  }

  async save(context: ManualSelectionCacheContext, entry: ManualSelectionCacheEntry): Promise<void> {
    if (!entry.id || entry.result.status === "empty" || entry.result.regions.length === 0) return;
    const doc = await this.read(context);
    const nextEntry = { ...entry, savedAt: Date.now() };
    const index = doc.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) doc.entries[index] = nextEntry;
    else doc.entries.push(nextEntry);
    await this.storage.set({ [doc.key]: doc });
  }

  async clear(context: ManualSelectionCacheContext): Promise<void> {
    await this.storage.remove(manualSelectionCacheKey(context));
  }
}

function isManualSelectionCacheDocument(value: unknown, key: string): value is ManualSelectionCacheDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<ManualSelectionCacheDocument>;
  return doc.version === 1 && doc.key === key && Array.isArray(doc.entries);
}

function isManualSelectionCacheEntry(value: unknown): value is ManualSelectionCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ManualSelectionCacheEntry>;
  return typeof entry.id === "string"
    && isRect(entry.documentRect)
    && isSize(entry.naturalSize)
    && isSurfaceResult(entry.result);
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rect = value as Partial<Rect>;
  return typeof rect.x === "number" && typeof rect.y === "number" && typeof rect.width === "number" && typeof rect.height === "number";
}

function isSize(value: unknown): value is Size {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const size = value as Partial<Size>;
  return typeof size.width === "number" && typeof size.height === "number";
}

function isSurfaceResult(value: unknown): value is SurfaceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<SurfaceResult>;
  return typeof result.surfaceId === "string"
    && typeof result.imageHash === "string"
    && (result.status === "completed" || result.status === "cached")
    && Array.isArray(result.regions);
}
