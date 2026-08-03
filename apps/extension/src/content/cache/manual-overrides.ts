import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { Rect, SurfaceResult } from "@umt/shared/types";
import { resolveBubbleResult, type BubbleResultCacheEntry } from "./bubble-result-cache.js";

export interface ManualOverrideStorage {
  get(key?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(keys: string | string[]): Promise<void> | void;
}

export interface VersionedManualOverride extends ManualOverridePayload {
  sourceText?: string;
  box?: Rect;
  neighborhood?: string[];
  kind?: "edit" | "tombstone";
  updatedAt?: number;
}

interface ManualOverrideDocument {
  version: 1 | 2;
  imageHash: string;
  targetLanguage: string;
  overrides: Record<string, VersionedManualOverride>;
  updatedAt: number;
}

const V1_PREFIX = "umt.manual-overrides:v1:";
const V2_PREFIX = "umt.manual-overrides:v2:";

export class ExtensionManualOverrideStore {
  private readonly storage: ManualOverrideStorage;

  constructor(storage?: ManualOverrideStorage) {
    this.storage = storage ?? getDefaultStorage();
  }

  async save(override: VersionedManualOverride): Promise<void> {
    if (!override.imageHash || !override.targetLanguage || !override.regionId) return;
    const now = Date.now();
    const stored: VersionedManualOverride = {
      ...override,
      translatedText: override.translatedText.trim(),
      kind: override.translatedText.trim() === "" ? "tombstone" : "edit",
      updatedAt: now,
    };
    const v2 = await this.readVersion(2, override.imageHash, override.targetLanguage);
    v2.overrides[override.regionId] = stored;
    v2.updatedAt = now;
    const v1: ManualOverrideDocument = { ...v2, version: 1 };
    await this.storage.set({
      [storageKey(2, override.imageHash, override.targetLanguage)]: v2,
      [storageKey(1, override.imageHash, override.targetLanguage)]: v1,
    });
  }

  async listForImage(imageHash: string, targetLanguage: string): Promise<VersionedManualOverride[]> {
    const v1 = await this.readVersion(1, imageHash, targetLanguage);
    const v2 = await this.readVersion(2, imageHash, targetLanguage);
    return Object.values({ ...v1.overrides, ...v2.overrides });
  }

  async applyToResult(result: SurfaceResult, targetLanguage: string): Promise<SurfaceResult> {
    return applyManualOverridesToResult(result, await this.listForImage(result.imageHash, targetLanguage));
  }

  private async readVersion(version: 1 | 2, imageHash: string, targetLanguage: string): Promise<ManualOverrideDocument> {
    const key = storageKey(version, imageHash, targetLanguage);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ManualOverrideDocument | undefined;
    if (!isManualOverrideDocument(doc, version, imageHash, targetLanguage)) return { version, imageHash, targetLanguage, overrides: {}, updatedAt: 0 };
    return doc;
  }
}

export function applyManualOverridesToResult(result: SurfaceResult, overrides: readonly VersionedManualOverride[]): SurfaceResult {
  if (!overrides.length) return result;
  const byRegion = new Map(overrides.map((override) => [override.regionId, override]));
  const fuzzyEntries = overrides.flatMap(toBubbleEntry);
  const regions = result.regions
    .map((region, index, all) => {
      const override = byRegion.get(region.id) ?? fromBubbleMatch(resolveBubbleResult(fuzzyEntries, {
        sourceText: region.sourceText,
        box: region.box,
        neighborhood: readingNeighborhood(all, index),
      }));
      return override ? { ...region, translatedText: override.translatedText } : region;
    })
    .filter((region) => region.translatedText.trim() !== "");
  return { ...result, regions };
}

function toBubbleEntry(override: VersionedManualOverride): BubbleResultCacheEntry[] {
  if (!override.sourceText || !isRect(override.box)) return [];
  return [{
    id: override.regionId,
    sourceText: override.sourceText,
    box: override.box,
    ...(override.neighborhood ? { neighborhood: override.neighborhood } : {}),
    translatedText: override.translatedText.trim(),
    priority: override.translatedText.trim() === "" ? "manual-tombstone" : "manual-edit",
    ...(override.updatedAt !== undefined ? { savedAt: override.updatedAt } : {}),
  }];
}

function fromBubbleMatch(match: BubbleResultCacheEntry | null): VersionedManualOverride | undefined {
  if (!match) return undefined;
  return { imageHash: "", targetLanguage: "", regionId: match.id, translatedText: match.translatedText };
}

function readingNeighborhood(regions: SurfaceResult["regions"], index: number): string[] {
  return [regions[index - 1]?.sourceText, regions[index + 1]?.sourceText].filter((value): value is string => Boolean(value));
}

function storageKey(version: 1 | 2, imageHash: string, targetLanguage: string): string {
  if (version === 1) return `${V1_PREFIX}${encodeURIComponent(imageHash)}:${encodeURIComponent(targetLanguage)}`;
  return `${V2_PREFIX}${opaqueId(`${imageHash}\u0000${targetLanguage}`)}`;
}

function opaqueId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `o${hash.toString(16).padStart(8, "0")}`;
}

function isManualOverrideDocument(value: unknown, version: 1 | 2, imageHash: string, targetLanguage: string): value is ManualOverrideDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<ManualOverrideDocument>;
  return doc.version === version && doc.imageHash === imageHash && doc.targetLanguage === targetLanguage
    && Boolean(doc.overrides) && typeof doc.overrides === "object" && !Array.isArray(doc.overrides);
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rect = value as Partial<Rect>;
  return [rect.x, rect.y, rect.width, rect.height].every((item) => typeof item === "number" && Number.isFinite(item));
}

function getDefaultStorage(): ManualOverrideStorage {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) { if (typeof key === "string") return { [key]: data[key] }; return { ...data }; },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}
