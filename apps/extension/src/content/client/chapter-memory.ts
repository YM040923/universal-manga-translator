import type { ManualOverridePayload } from "@umt/shared/protocol";
import type { SurfaceResult } from "@umt/shared/types";

export class ChapterTranslationMemory {
  private readonly entries: Array<{ imageHash: string; regions: Array<{ id: string; sourceText: string; translatedText: string }>; terms: string[] }> = [];

  remember(imageHash: string, result: SurfaceResult): void {
    if (!imageHash || !result.regions.length) return;
    const regions = result.regions
      .map((region) => ({ id: region.id, sourceText: region.sourceText.trim(), translatedText: region.translatedText.trim() }))
      .filter((region) => region.sourceText || region.translatedText)
      .slice(0, 24);
    if (!regions.length) return;
    const index = this.entries.findIndex((entry) => entry.imageHash === imageHash);
    const entry = { imageHash, regions, terms: extractMemoryTermCandidates(regions.map((region) => region.sourceText).join("\n")) };
    if (index >= 0) this.entries.splice(index, 1, entry);
    else this.entries.push(entry);
    while (this.entries.length > 12) this.entries.shift();
  }

  previousTranslationsFor(imageHash: string): Array<{ id: string; translatedText: string }> {
    return this.entries
      .filter((entry) => entry.imageHash === imageHash)
      .flatMap((entry) => entry.regions.map((region) => ({ id: region.id, translatedText: region.translatedText })))
      .filter((item) => item.translatedText.length > 0)
      .slice(-24);
  }

  applyManualOverride(override: ManualOverridePayload): void {
    const entry = this.entries.find((item) => item.imageHash === override.imageHash);
    const region = entry?.regions.find((item) => item.id === override.regionId);
    if (!region) return;
    region.translatedText = override.translatedText.trim();
  }

  chapterContextFor(imageHash: string): string {
    const lines = this.entries
      .filter((entry) => entry.imageHash !== imageHash)
      .slice(-5)
      .flatMap((entry) => entry.regions.slice(0, 8).map((region) => `${region.sourceText} => ${region.translatedText}`))
      .filter((line) => line.replace(/\s+/g, "").length > 4)
      .slice(-32);
    return lines.length ? `Recent translated bubbles in this chapter:\n${lines.join("\n")}` : "";
  }

  termCandidatesFor(imageHash: string): string[] {
    return mergeUniqueTerms(this.entries.filter((entry) => entry.imageHash !== imageHash).flatMap((entry) => entry.terms)).slice(0, 24);
  }
}

function extractMemoryTermCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const cleaned = text.replace(/[’']/g, "'").replace(/[^A-Za-z0-9'\-\s]/g, " ");
  const pattern = /\b(?:[A-Z][a-z0-9'\-]{2,}|[A-Z]{2,})(?:\s+(?:[A-Z][a-z0-9'\-]{2,}|[A-Z]{2,})){0,3}\b/g;
  for (const match of cleaned.matchAll(pattern)) {
    const term = match[0].replace(/\s+/g, " ").trim();
    if (term.length >= 3 && !COMMON_MEMORY_WORDS.has(term)) candidates.add(term);
  }
  return [...candidates].slice(0, 24);
}

const COMMON_MEMORY_WORDS = new Set(["The", "This", "That", "What", "When", "Where", "Why", "Who", "How", "You", "Your", "Here", "There"]);

function mergeUniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, " ").trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    result.push(term);
  }
  return result;
}

