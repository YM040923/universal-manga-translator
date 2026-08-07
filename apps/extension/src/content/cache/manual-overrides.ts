import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { SurfaceResult } from "@umt/shared/types";

export interface ManualOverrideStorage {
  get(key?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(keys: string | string[]): Promise<void> | void;
}

interface ManualOverrideDocument {
  version: 1;
  imageHash: string;
  targetLanguage: string;
  overrides: Record<string, ManualOverridePayload>;
  updatedAt: number;
}

const PREFIX = "umt.manual-overrides:v1:";

export class ExtensionManualOverrideStore {
  private readonly storage: ManualOverrideStorage;

  constructor(storage?: ManualOverrideStorage) {
    this.storage = storage ?? getDefaultStorage();
  }

  async save(override: ManualOverridePayload): Promise<void> {
    if (!override.imageHash || !override.targetLanguage || !override.regionId) return;
    const doc = await this.readDocument(override.imageHash, override.targetLanguage);
    doc.overrides[override.regionId] = override;
    doc.updatedAt = Date.now();
    await this.storage.set({ [storageKey(override.imageHash, override.targetLanguage)]: doc });
  }

  async listForImage(imageHash: string, targetLanguage: string): Promise<ManualOverridePayload[]> {
    const doc = await this.readDocument(imageHash, targetLanguage);
    return Object.values(doc.overrides);
  }

  async applyToResult(result: SurfaceResult, targetLanguage: string): Promise<SurfaceResult> {
    return applyManualOverridesToResult(result, await this.listForImage(result.imageHash, targetLanguage));
  }

  private async readDocument(imageHash: string, targetLanguage: string): Promise<ManualOverrideDocument> {
    const key = storageKey(imageHash, targetLanguage);
    const raw = await this.storage.get(key);
    const doc = raw?.[key] as ManualOverrideDocument | undefined;
    if (!isManualOverrideDocument(doc, imageHash, targetLanguage)) {
      return { version: 1, imageHash, targetLanguage, overrides: {}, updatedAt: 0 };
    }
    return doc;
  }
}

export function applyManualOverridesToResult(result: SurfaceResult, overrides: ManualOverridePayload[]): SurfaceResult {
  if (!overrides.length) return result;
  const byRegion = new Map(overrides.map((override) => [override.regionId, override.translatedText]));
  const regions = result.regions
    .map((region) => byRegion.has(region.id) ? { ...region, translatedText: byRegion.get(region.id)! } : region)
    .filter((region) => region.translatedText.trim() !== "");
  return { ...result, regions };
}

function storageKey(imageHash: string, targetLanguage: string): string {
  return `${PREFIX}${encodeURIComponent(imageHash)}:${encodeURIComponent(targetLanguage)}`;
}

function isManualOverrideDocument(value: unknown, imageHash: string, targetLanguage: string): value is ManualOverrideDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<ManualOverrideDocument>;
  return doc.version === 1
    && doc.imageHash === imageHash
    && doc.targetLanguage === targetLanguage
    && Boolean(doc.overrides)
    && typeof doc.overrides === "object"
    && !Array.isArray(doc.overrides);
}

function getDefaultStorage(): ManualOverrideStorage {
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
