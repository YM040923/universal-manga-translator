import { sha256Hex } from "@umt/shared/hashing";

export const MAX_GLOSSARY_ENTRIES = 200;
export const MAX_GLOSSARY_TERM_CHARS = 64;
export const MAX_GLOSSARY_VALUE_CHARS = 120;

/**
 * The glossary arrives from whatever client can reach the loopback port and is
 * interpolated into the translator prompt, so entries are bounded and their
 * whitespace is collapsed to keep newlines from carrying prompt instructions.
 */
export function sanitizeGlossary(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries: Array<[string, string]> = [];
  for (const [rawTerm, rawTranslation] of Object.entries(value)) {
    if (typeof rawTranslation !== "string") continue;
    const term = rawTerm.replace(/\s+/g, " ").trim().slice(0, MAX_GLOSSARY_TERM_CHARS);
    const translation = rawTranslation.replace(/\s+/g, " ").trim().slice(0, MAX_GLOSSARY_VALUE_CHARS);
    if (!term || !translation) continue;
    entries.push([term, translation]);
    if (entries.length >= MAX_GLOSSARY_ENTRIES) break;
  }
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

/** Editing a term must stop the backend from serving the translation cached under the old one. */
export function glossaryVersion(glossary: Record<string, string> | undefined): string | undefined {
  if (!glossary) return undefined;
  return sha256Hex(JSON.stringify(Object.entries(glossary))).slice(0, 16);
}
