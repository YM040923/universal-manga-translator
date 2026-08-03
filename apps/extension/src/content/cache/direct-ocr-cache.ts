import type { GenericOcrRegion } from "@umt/core";
import type { CoreOcrCache } from "@umt/core";

export interface DirectOcrCacheStorage {
  get(keys?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(keys: string | string[]): Promise<void> | void;
}

interface DirectOcrCacheDocument {
  version: 1 | 2;
  regions: GenericOcrRegion[];
  savedAt: number;
}

const V1_PREFIX = "umt.direct-ocr-cache:v1:";
const V2_PREFIX = "umt.direct-ocr-cache:v2:";

export class DirectOcrCache implements CoreOcrCache {
  private readonly storage: DirectOcrCacheStorage;

  constructor(storage?: DirectOcrCacheStorage) { this.storage = storage ?? getDefaultStorage(); }

  async get(key: string): Promise<GenericOcrRegion[] | null> {
    for (const storageKey of [toStorageKey(2, key), toStorageKey(1, key)]) {
      const raw = await this.storage.get(storageKey);
      const doc = raw?.[storageKey] as DirectOcrCacheDocument | undefined;
      if (!doc || (doc.version !== 1 && doc.version !== 2) || !Array.isArray(doc.regions)) continue;
      const regions = doc.regions.filter(isGenericOcrRegion);
      if (regions.length) return regions;
    }
    return null;
  }

  async set(key: string, regions: GenericOcrRegion[]): Promise<void> {
    const valid = regions.filter(isGenericOcrRegion);
    if (!valid.length) return;
    const savedAt = Date.now();
    await this.storage.set({
      [toStorageKey(2, key)]: { version: 2, regions: valid, savedAt } satisfies DirectOcrCacheDocument,
      [toStorageKey(1, key)]: { version: 1, regions: valid, savedAt } satisfies DirectOcrCacheDocument,
    });
  }

  async clearAll(): Promise<number> {
    const all = await this.storage.get(null);
    const v2Keys = Object.keys(all ?? {}).filter((key) => key.startsWith(V2_PREFIX));
    const v1Keys = Object.keys(all ?? {}).filter((key) => key.startsWith(V1_PREFIX));
    const keys = [...new Set([...v1Keys, ...v2Keys])];
    if (keys.length) await this.storage.remove(keys);
    return v2Keys.length || v1Keys.length;
  }

  async stats(): Promise<{ entries: number; bytes: number; updatedAt: number | null }> {
    const all = await this.storage.get(null);
    const v2 = Object.entries(all ?? {}).filter(([key]) => key.startsWith(V2_PREFIX));
    const entries = v2.length ? v2 : Object.entries(all ?? {}).filter(([key]) => key.startsWith(V1_PREFIX));
    let bytes = 0;
    let updatedAt: number | null = null;
    for (const [, value] of entries) {
      bytes += JSON.stringify(value).length;
      const savedAt = typeof (value as { savedAt?: unknown }).savedAt === "number" ? (value as { savedAt: number }).savedAt : null;
      if (savedAt !== null) updatedAt = Math.max(updatedAt ?? 0, savedAt);
    }
    return { entries: entries.length, bytes, updatedAt };
  }
}

function getDefaultStorage(): DirectOcrCacheStorage { if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local; const data: Record<string, unknown> = {}; return { async get(key?: unknown) { if (typeof key === "string") return { [key]: data[key] }; return { ...data }; }, async set(value: Record<string, unknown>) { Object.assign(data, value); }, async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } }; }
function toStorageKey(version: 1 | 2, key: string): string { return version === 1 ? `${V1_PREFIX}${key}` : `${V2_PREFIX}${opaqueKey(key)}`; }
function opaqueKey(key: string): string { let hash = 0x811c9dc5; for (let index = 0; index < key.length; index += 1) { hash ^= key.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return `o${hash.toString(16).padStart(8, "0")}`; }
function isGenericOcrRegion(value: unknown): value is GenericOcrRegion { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const region = value as Partial<GenericOcrRegion>; const box = region.box as Partial<GenericOcrRegion["box"]> | undefined; return typeof region.id === "string" && typeof region.sourceText === "string" && typeof region.confidence === "number" && typeof box?.x === "number" && typeof box.y === "number" && typeof box.width === "number" && typeof box.height === "number"; }
