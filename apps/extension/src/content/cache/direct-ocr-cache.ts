import type { GenericOcrRegion } from "@umt/core";
import type { CoreOcrCache } from "@umt/core";

export interface DirectOcrCacheStorage {
  get(keys?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(keys: string | string[]): Promise<void> | void;
}

interface DirectOcrCacheDocument {
  version: 1;
  regions: GenericOcrRegion[];
  savedAt: number;
}

const PREFIX = "umt.direct-ocr-cache:v1:";

export class DirectOcrCache implements CoreOcrCache {
  private readonly storage: DirectOcrCacheStorage;

  constructor(storage?: DirectOcrCacheStorage) {
    this.storage = storage ?? getDefaultStorage();
  }

  async get(key: string): Promise<GenericOcrRegion[] | null> {
    const storageKey = toStorageKey(key);
    const raw = await this.storage.get(storageKey);
    const doc = raw?.[storageKey] as DirectOcrCacheDocument | undefined;
    if (!doc || doc.version !== 1 || !Array.isArray(doc.regions)) return null;
    return doc.regions.filter(isGenericOcrRegion);
  }

  async set(key: string, regions: GenericOcrRegion[]): Promise<void> {
    if (!regions.length) return;
    await this.storage.set({ [toStorageKey(key)]: { version: 1, regions, savedAt: Date.now() } satisfies DirectOcrCacheDocument });
  }

  async clearAll(): Promise<number> {
    const all = await this.storage.get(null);
    const keys = Object.keys(all ?? {}).filter((key) => key.startsWith(PREFIX));
    if (keys.length) await this.storage.remove(keys);
    return keys.length;
  }

  async stats(): Promise<{ entries: number; bytes: number; updatedAt: number | null }> {
    const all = await this.storage.get(null);
    let entries = 0;
    let bytes = 0;
    let updatedAt: number | null = null;
    for (const [key, value] of Object.entries(all ?? {})) {
      if (!key.startsWith(PREFIX)) continue;
      entries += 1;
      bytes += JSON.stringify(value).length;
      const savedAt = typeof (value as { savedAt?: unknown }).savedAt === "number" ? (value as { savedAt: number }).savedAt : null;
      if (savedAt !== null) updatedAt = Math.max(updatedAt ?? 0, savedAt);
    }
    return { entries, bytes, updatedAt };
  }
}

function getDefaultStorage(): DirectOcrCacheStorage {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  const data: Record<string, unknown> = {};
  return {
    async get(key?: unknown) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}

function toStorageKey(key: string): string {
  return `${PREFIX}${key}`;
}

function isGenericOcrRegion(value: unknown): value is GenericOcrRegion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const region = value as Partial<GenericOcrRegion>;
  const box = region.box as Partial<GenericOcrRegion["box"]> | undefined;
  return typeof region.id === "string"
    && typeof region.sourceText === "string"
    && typeof region.confidence === "number"
    && typeof box?.x === "number"
    && typeof box.y === "number"
    && typeof box.width === "number"
    && typeof box.height === "number";
}
