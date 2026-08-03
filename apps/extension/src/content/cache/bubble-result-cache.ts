import type { Rect } from "@umt/shared/types";
import type { ContentFingerprint, ContentFingerprintCacheStorage } from "./content-fingerprint-cache.js";

export type BubbleResultPriority = "auto" | "cache" | "forced-retranslate" | "manual-selection" | "manual-edit" | "manual-tombstone";

export interface BubbleResultProbe {
  sourceText: string;
  box: Rect;
  neighborhood?: readonly string[];
}

export interface BubbleResultCacheEntry extends BubbleResultProbe {
  id: string;
  translatedText: string;
  priority: BubbleResultPriority;
  savedAt?: number;
}

interface BubbleResultCacheDocument {
  version: 1 | 2;
  fingerprint: ContentFingerprint;
  entries: BubbleResultCacheEntry[];
  savedAt: number;
}

const V1_PREFIX = "umt.bubble-result-cache:v1:";
const V2_PREFIX = "umt.bubble-result-cache:v2:";

export function bubbleResultCacheKey(fingerprint: ContentFingerprint): string {
  return `${V2_PREFIX}${opaqueFingerprint(fingerprint)}`;
}

export function legacyBubbleResultCacheKey(fingerprint: ContentFingerprint): string {
  return `${V1_PREFIX}${opaqueFingerprint(fingerprint)}`;
}

export class BubbleResultCache {
  constructor(private readonly storage: ContentFingerprintCacheStorage = getDefaultStorage()) {}

  async save(fingerprint: ContentFingerprint, entries: BubbleResultCacheEntry[]): Promise<void> {
    const validEntries = entries.filter(isBubbleResultCacheEntry).map((entry) => ({
      ...entry,
      box: { ...entry.box },
      ...(entry.neighborhood ? { neighborhood: [...entry.neighborhood] } : {}),
      savedAt: Date.now(),
    }));
    if (!validEntries.length) return;
    const existing = await this.read(fingerprint);
    const merged = mergeEntries(existing, validEntries);
    const savedAt = Date.now();
    const v2: BubbleResultCacheDocument = { version: 2, fingerprint: { ...fingerprint }, entries: merged, savedAt };
    const v1: BubbleResultCacheDocument = { ...v2, version: 1 };
    await this.storage.set({ [bubbleResultCacheKey(fingerprint)]: v2, [legacyBubbleResultCacheKey(fingerprint)]: v1 });
  }

  async match(fingerprint: ContentFingerprint, probe: BubbleResultProbe): Promise<BubbleResultCacheEntry | null> {
    return resolveBubbleResult(await this.read(fingerprint), probe);
  }

  async read(fingerprint: ContentFingerprint): Promise<BubbleResultCacheEntry[]> {
    const entries: BubbleResultCacheEntry[] = [];
    for (const key of [legacyBubbleResultCacheKey(fingerprint), bubbleResultCacheKey(fingerprint)]) {
      const raw = await this.storage.get(key);
      const document = raw?.[key];
      if (!isDocument(document, fingerprint)) continue;
      entries.push(...document.entries);
    }
    return mergeEntries([], entries);
  }

  async clear(fingerprint: ContentFingerprint): Promise<void> {
    await this.storage.remove([bubbleResultCacheKey(fingerprint), legacyBubbleResultCacheKey(fingerprint)]);
  }
}

export function resolveBubbleResult(entries: readonly BubbleResultCacheEntry[], probe: BubbleResultProbe): BubbleResultCacheEntry | null {
  const normalizedSource = normalizeSourceText(probe.sourceText);
  if (!normalizedSource) return null;
  const candidates = entries
    .filter((entry) => normalizeSourceText(entry.sourceText) === normalizedSource)
    .map((entry) => ({ entry, score: bubbleScore(entry, probe) }))
    .filter((candidate) => candidate.score >= 0.45)
    .sort((left, right) => priorityRank(right.entry.priority) - priorityRank(left.entry.priority)
      || right.score - left.score
      || (right.entry.savedAt ?? 0) - (left.entry.savedAt ?? 0)
      || left.entry.id.localeCompare(right.entry.id));
  return candidates[0] ? cloneEntry(candidates[0].entry) : null;
}

export function normalizeSourceText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function priorityRank(priority: BubbleResultPriority): number {
  switch (priority) {
    case "manual-tombstone": return 5;
    case "manual-edit": return 5;
    case "manual-selection": return 4;
    case "forced-retranslate": return 3;
    case "auto": return 2;
    case "cache": return 1;
  }
}

function mergeEntries(existing: readonly BubbleResultCacheEntry[], incoming: readonly BubbleResultCacheEntry[]): BubbleResultCacheEntry[] {
  const byId = new Map(existing.map((entry) => [entry.id, cloneEntry(entry)]));
  for (const entry of incoming) {
    const previous = byId.get(entry.id);
    if (!previous || priorityRank(entry.priority) >= priorityRank(previous.priority) || (entry.savedAt ?? 0) >= (previous.savedAt ?? 0)) byId.set(entry.id, cloneEntry(entry));
  }
  return [...byId.values()];
}

function bubbleScore(entry: BubbleResultProbe, probe: BubbleResultProbe): number {
  const overlap = iou(entry.box, probe.box);
  const distance = centerDistance(entry.box, probe.box);
  const scale = Math.max(1, Math.max(entry.box.width, entry.box.height, probe.box.width, probe.box.height));
  const centerScore = Math.max(0, 1 - distance / (scale * 0.5));
  const neighborhoodScore = neighborhoodSimilarity(entry.neighborhood, probe.neighborhood);
  return 0.55 * Math.max(overlap, centerScore) + 0.25 * overlap + 0.2 * neighborhoodScore;
}

function iou(left: Rect, right: Rect): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function centerDistance(left: Rect, right: Rect): number {
  return Math.hypot(left.x + left.width / 2 - right.x - right.width / 2, left.y + left.height / 2 - right.y - right.height / 2);
}

function neighborhoodSimilarity(left?: readonly string[], right?: readonly string[]): number {
  if (!left?.length && !right?.length) return 0.5;
  const normalizedLeft = new Set((left ?? []).map(normalizeSourceText).filter(Boolean));
  const normalizedRight = new Set((right ?? []).map(normalizeSourceText).filter(Boolean));
  if (!normalizedLeft.size || !normalizedRight.size) return 0;
  let shared = 0;
  for (const item of normalizedLeft) if (normalizedRight.has(item)) shared += 1;
  return shared / Math.max(normalizedLeft.size, normalizedRight.size);
}

function isDocument(value: unknown, fingerprint: ContentFingerprint): value is BubbleResultCacheDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Partial<BubbleResultCacheDocument>;
  return (document.version === 1 || document.version === 2)
    && sameFingerprint(document.fingerprint, fingerprint)
    && Array.isArray(document.entries)
    && document.entries.every(isBubbleResultCacheEntry);
}

function sameFingerprint(value: unknown, expected: ContentFingerprint): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentFingerprint>;
  return candidate.imageHash === expected.imageHash && candidate.naturalWidth === expected.naturalWidth && candidate.naturalHeight === expected.naturalHeight
    && candidate.ocrProfile === expected.ocrProfile && candidate.preprocessingVersion === expected.preprocessingVersion
    && candidate.targetLanguage === expected.targetLanguage && candidate.translationProfile === expected.translationProfile
    && candidate.promptVersion === expected.promptVersion && candidate.layoutVersion === expected.layoutVersion;
}

function isBubbleResultCacheEntry(value: unknown): value is BubbleResultCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<BubbleResultCacheEntry>;
  return typeof entry.id === "string" && typeof entry.sourceText === "string" && typeof entry.translatedText === "string"
    && isRect(entry.box) && isPriority(entry.priority);
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rect = value as Partial<Rect>;
  return [rect.x, rect.y, rect.width, rect.height].every((item) => typeof item === "number" && Number.isFinite(item));
}

function isPriority(value: unknown): value is BubbleResultPriority {
  return value === "auto" || value === "cache" || value === "forced-retranslate" || value === "manual-selection" || value === "manual-edit" || value === "manual-tombstone";
}

function cloneEntry(entry: BubbleResultCacheEntry): BubbleResultCacheEntry {
  return { ...entry, box: { ...entry.box }, ...(entry.neighborhood ? { neighborhood: [...entry.neighborhood] } : {}) };
}

function opaqueFingerprint(fingerprint: ContentFingerprint): string {
  const canonical = JSON.stringify([fingerprint.imageHash, fingerprint.naturalWidth, fingerprint.naturalHeight, fingerprint.ocrProfile, fingerprint.preprocessingVersion, fingerprint.targetLanguage, fingerprint.translationProfile, fingerprint.promptVersion, fingerprint.layoutVersion]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) { hash ^= canonical.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `f${hash.toString(16).padStart(8, "0")}`;
}

function getDefaultStorage(): ContentFingerprintCacheStorage {
  if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  const data: Record<string, unknown> = {};
  return { async get(key: string) { return { [key]: data[key] }; }, async set(value: Record<string, unknown>) { Object.assign(data, value); }, async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
}
