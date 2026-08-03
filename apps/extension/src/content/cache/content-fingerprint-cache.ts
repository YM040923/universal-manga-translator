import type { SurfaceResult } from "@umt/shared/types";

export interface ContentFingerprint {
  imageHash: string;
  naturalWidth: number;
  naturalHeight: number;
  ocrProfile: string;
  preprocessingVersion: string;
  targetLanguage: string;
  translationProfile: string;
  promptVersion: string;
  layoutVersion: string;
}

export interface ContentFingerprintCacheStorage {
  get(key: string): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
  remove(key: string | string[]): Promise<void> | void;
}

interface ContentFingerprintCacheDocument {
  version: 1 | 2;
  fingerprint: ContentFingerprint;
  result: SurfaceResult;
  savedAt: number;
}

const V1_PREFIX = "umt.content-fingerprint-cache:v1:";
const V2_PREFIX = "umt.content-fingerprint-cache:v2:";

export function contentFingerprintCacheKey(fingerprint: ContentFingerprint): string {
  return `${V2_PREFIX}${opaqueFingerprint(storageSafeContentFingerprint(fingerprint))}`;
}

export function legacyContentFingerprintCacheKey(fingerprint: ContentFingerprint): string {
  return `${V1_PREFIX}${opaqueFingerprint(fingerprint)}`;
}

export function storageSafeContentFingerprint(fingerprint: ContentFingerprint): ContentFingerprint {
  return {
    ...fingerprint,
    ocrProfile: contentProfileIdentifier(fingerprint.ocrProfile),
    translationProfile: contentProfileIdentifier(fingerprint.translationProfile),
  };
}

export class ContentFingerprintCache {
  constructor(private readonly storage: ContentFingerprintCacheStorage = getDefaultStorage()) {}

  async get(fingerprint: ContentFingerprint): Promise<SurfaceResult | null> {
    const safeFingerprint = storageSafeContentFingerprint(fingerprint);
    const v2Key = contentFingerprintCacheKey(safeFingerprint);
    const v2Raw = await this.storage.get(v2Key);
    const v2Document = v2Raw?.[v2Key];
    if (isContentFingerprintCacheDocument(v2Document, safeFingerprint)) return cloneResult(v2Document.result);
    const v1Key = legacyContentFingerprintCacheKey(fingerprint);
    const v1Raw = await this.storage.get(v1Key);
    const v1Document = v1Raw?.[v1Key];
    if (isContentFingerprintCacheDocument(v1Document, safeFingerprint) || isContentFingerprintCacheDocument(v1Document, fingerprint)) {
      const migrated: ContentFingerprintCacheDocument = {
        version: 2,
        fingerprint: safeFingerprint,
        result: cloneResult(v1Document.result),
        savedAt: v1Document.savedAt,
      };
      await this.storage.set({ [v2Key]: migrated });
      await this.storage.remove(v1Key);
      return cloneResult(migrated.result);
    }
    return null;
  }

  async save(fingerprint: ContentFingerprint, result: SurfaceResult | { status: string; regions?: unknown }): Promise<void> {
    if (!isReusableResult(result)) return;
    const safeFingerprint = storageSafeContentFingerprint(fingerprint);
    const savedAt = Date.now();
    const v2: ContentFingerprintCacheDocument = { version: 2, fingerprint: safeFingerprint, result: cloneResult(result), savedAt };
    const v1: ContentFingerprintCacheDocument = { ...v2, version: 1 };
    await this.storage.set({
      [contentFingerprintCacheKey(safeFingerprint)]: v2,
      [legacyContentFingerprintCacheKey(fingerprint)]: v1,
    });
  }

  async clear(fingerprint: ContentFingerprint): Promise<void> {
    await this.storage.remove([contentFingerprintCacheKey(fingerprint), legacyContentFingerprintCacheKey(fingerprint)]);
  }
}

function isContentFingerprintCacheDocument(value: unknown, fingerprint: ContentFingerprint): value is ContentFingerprintCacheDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Partial<ContentFingerprintCacheDocument>;
  return (document.version === 1 || document.version === 2)
    && sameFingerprint(document.fingerprint, fingerprint)
    && isReusableResult(document.result);
}

function sameFingerprint(value: unknown, expected: ContentFingerprint): value is ContentFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentFingerprint>;
  return candidate.imageHash === expected.imageHash
    && candidate.naturalWidth === expected.naturalWidth
    && candidate.naturalHeight === expected.naturalHeight
    && candidate.ocrProfile === expected.ocrProfile
    && candidate.preprocessingVersion === expected.preprocessingVersion
    && candidate.targetLanguage === expected.targetLanguage
    && candidate.translationProfile === expected.translationProfile
    && candidate.promptVersion === expected.promptVersion
    && candidate.layoutVersion === expected.layoutVersion;
}

function isReusableResult(value: unknown): value is SurfaceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<SurfaceResult> & { status?: unknown; regions?: unknown };
  return (result.status === "completed" || result.status === "cached")
    && Array.isArray(result.regions)
    && result.regions.length > 0
    && typeof result.surfaceId === "string"
    && typeof result.imageHash === "string";
}

function cloneResult(result: SurfaceResult): SurfaceResult {
  return JSON.parse(JSON.stringify(result)) as SurfaceResult;
}

function opaqueFingerprint(fingerprint: ContentFingerprint): string {
  const canonical = JSON.stringify([
    fingerprint.imageHash,
    fingerprint.naturalWidth,
    fingerprint.naturalHeight,
    fingerprint.ocrProfile,
    fingerprint.preprocessingVersion,
    fingerprint.targetLanguage,
    fingerprint.translationProfile,
    fingerprint.promptVersion,
    fingerprint.layoutVersion,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `f${hash.toString(16).padStart(8, "0")}`;
}

export function contentProfileIdentifier(value: string): string {
  if (/^profile:[0-9a-f]{8}$/i.test(value)) return value;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `profile:${hash.toString(16).padStart(8, "0")}`;
}

function getDefaultStorage(): ContentFingerprintCacheStorage {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  const data: Record<string, unknown> = {};
  return {
    async get(key: string) { return { [key]: data[key] }; },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}
