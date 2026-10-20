export const MAX_CHAPTER_CONTEXT_CHARS = 4000;
export const MAX_TERM_CANDIDATES = 40;
export const MAX_TERM_CANDIDATE_CHARS = 64;

/**
 * Chapter context and term candidates come from whatever client can reach the loopback
 * port and are interpolated into the translator prompt, so they are bounded and their
 * whitespace is collapsed to keep newlines from carrying prompt instructions.
 */
export function sanitizeChapterContext(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim().slice(0, MAX_CHAPTER_CONTEXT_CHARS);
  return collapsed || undefined;
}

export function sanitizeTermCandidates(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const term = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TERM_CANDIDATE_CHARS);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERM_CANDIDATES) break;
  }
  return terms.length ? terms : undefined;
}
