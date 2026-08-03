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
  priority?: "manual-selection";
  savedAt?: number;
}

export interface ManualSelectionCacheDocument {
  version: 1 | 2;
  key: string;
  entries: ManualSelectionCacheEntry[];
}

export interface ManualSelectionCacheStorage {
  get(key: string): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(key: string | string[]): Promise<void> | void;
}

const V1_PREFIX = "umt.manual-selection-cache:v1:";
const V2_PREFIX = "umt.manual-selection-cache:v2:";

export function manualSelectionCacheKey(context: ManualSelectionCacheContext): string {
  return `${V2_PREFIX}${opaqueContext(context)}`;
}

export function legacyManualSelectionCacheKey(context: ManualSelectionCacheContext): string {
  const url = normalizedPageUrl(context.pageUrl);
  return `${V1_PREFIX}${url}:${context.targetLanguage}:${context.providerProfile}`;
}

export class ManualSelectionCache {
  constructor(private readonly storage: ManualSelectionCacheStorage = getDefaultStorage()) {}

  async read(context: ManualSelectionCacheContext): Promise<ManualSelectionCacheDocument> {
    const v1 = await this.readVersion(1, context);
    const v2 = await this.readVersion(2, context);
    const byId = new Map(v1.entries.map((entry) => [entry.id, entry]));
    for (const entry of v2.entries) byId.set(entry.id, entry);
    return { version: 2, key: manualSelectionCacheKey(context), entries: [...byId.values()].map((entry) => ({ ...entry, priority: "manual-selection" as const })) };
  }

  async save(context: ManualSelectionCacheContext, entry: ManualSelectionCacheEntry): Promise<void> {
    if (!entry.id || !isReusableResult(entry.result)) return;
    const doc = await this.read(context);
    const nextEntry: ManualSelectionCacheEntry = { ...entry, priority: "manual-selection", savedAt: Date.now() };
    const index = doc.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) doc.entries[index] = nextEntry;
    else doc.entries.push(nextEntry);
    const v2: ManualSelectionCacheDocument = { ...doc, version: 2, key: manualSelectionCacheKey(context) };
    const v1: ManualSelectionCacheDocument = { ...doc, version: 1, key: legacyManualSelectionCacheKey(context) };
    await this.storage.set({ [v2.key]: v2, [v1.key]: v1 });
  }

  async clear(context: ManualSelectionCacheContext): Promise<void> {
    await this.storage.remove([manualSelectionCacheKey(context), legacyManualSelectionCacheKey(context)]);
  }

  private async readVersion(version: 1 | 2, context: ManualSelectionCacheContext): Promise<ManualSelectionCacheDocument> {
    const key = version === 2 ? manualSelectionCacheKey(context) : legacyManualSelectionCacheKey(context);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ManualSelectionCacheDocument | undefined;
    if (!isDocument(doc, version, key)) return { version, key, entries: [] };
    return { ...doc, entries: doc.entries.filter(isManualSelectionCacheEntry) };
  }
}

function isDocument(value: unknown, version: 1 | 2, key: string): value is ManualSelectionCacheDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<ManualSelectionCacheDocument>;
  return doc.version === version && doc.key === key && Array.isArray(doc.entries);
}

function isManualSelectionCacheEntry(value: unknown): value is ManualSelectionCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ManualSelectionCacheEntry>;
  return typeof entry.id === "string" && isRect(entry.documentRect) && isSize(entry.naturalSize) && isReusableResult(entry.result);
}

function isReusableResult(value: unknown): value is SurfaceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<SurfaceResult>;
  return (result.status === "completed" || result.status === "cached") && Array.isArray(result.regions) && result.regions.length > 0
    && typeof result.surfaceId === "string" && typeof result.imageHash === "string";
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
function normalizedPageUrl(pageUrl: string): string { const url = new URL(pageUrl); url.search = ""; url.hash = ""; return `${url.origin}${url.pathname}`; }
function opaqueContext(context: ManualSelectionCacheContext): string { return opaqueId(JSON.stringify([normalizedPageUrl(context.pageUrl), context.targetLanguage, context.providerProfile])); }
function opaqueId(value: string): string { let hash = 0x811c9dc5; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return `m${hash.toString(16).padStart(8, "0")}`; }
function getDefaultStorage(): ManualSelectionCacheStorage { if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local; const data: Record<string, unknown> = {}; return { async get(key: string) { return { [key]: data[key] }; }, async set(value: Record<string, unknown>) { Object.assign(data, value); }, async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } }; }