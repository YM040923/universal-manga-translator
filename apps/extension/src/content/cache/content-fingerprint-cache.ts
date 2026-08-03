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
  return `${V2_PREFIX}${opaqueFingerprint(fingerprint)}`;
}

export function legacyContentFingerprintCacheKey(fingerprint: ContentFingerprint): string {
  return `${V1_PREFIX}${opaqueFingerprint(fingerprint)}`;
}

export class ContentFingerprintCache {
  constructor(private readonly storage: ContentFingerprintCacheStorage = getDefaultStorage()) {}

  async get(fingerprint: ContentFingerprint): Promise<SurfaceResult | null> {
    for (const key of [contentFingerprintCacheKey(fingerprint), legacyContentFingerprintCacheKey(fingerprint)]) {
      const raw = await this.storage.get(key);
      const document = raw?.[key];
      if (isContentFingerprintCacheDocument(document, fingerprint)) return cloneResult(document.result);
    }
    return null;
  }

  async save(fingerprint: ContentFingerprint, result: SurfaceResult | { status: string; regions?: unknown }): Promise<void> {
    if (!isReusableResult(result)) return;
    const savedAt = Date.now();
    const v2: ContentFingerprintCacheDocument = { version: 2, fingerprint: { ...fingerprint }, result: cloneResult(result), savedAt };
    const v1: ContentFingerprintCacheDocument = { ...v2, version: 1 };
    await this.storage.set({
      [contentFingerprintCacheKey(fingerprint)]: v2,
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

function getDefaultStorage(): ContentFingerprintCacheStorage {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  const data: Record<string, unknown> = {};
  return {
    async get(key: string) { return { [key]: data[key] }; },
    async set(value: Record<string, unknown>) { Object.assign(data, value); },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}