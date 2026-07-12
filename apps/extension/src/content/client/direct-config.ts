import type { ExtensionSettings } from "../../settings/settings.js";

export function effectiveGlossary(settings: ExtensionSettings): Record<string, string> {
  if (settings.glossary && Object.keys(settings.glossary).length) return settings.glossary;
  if (typeof settings.glossaryText !== "string") return {};
  return parseGlossary(settings.glossaryText);
}

export function effectiveGlossaryHash(settings: ExtensionSettings): string {
  const glossary = effectiveGlossary(settings);
  const entries = Object.entries(glossary);
  if (!entries.length) return "glossary:empty";
  const canonical = JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const char of canonical) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return `glossary:${hash.toString(16).padStart(16, "0")}`;
}

export function directOcrConfigHash(settings: ExtensionSettings): string {
  const canonical = JSON.stringify({
    apiUrl: settings.directOcr.apiUrl,
    imageField: settings.directOcr.imageField,
    inputMode: settings.directOcr.inputMode,
    staticFieldsText: settings.directOcr.staticFieldsText,
    regionsPaths: settings.directOcr.regionsPaths,
    textPaths: settings.directOcr.textPaths,
    boxPaths: settings.directOcr.boxPaths,
    confidencePaths: settings.directOcr.confidencePaths,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ocr:${hash.toString(16).padStart(8, "0")}`;
}

function parseGlossary(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(.+?)(?:=>|=|:)(.+)$/);
    if (!match) continue;
    const source = normalizeGlossaryTerm(match[1] ?? "");
    const target = normalizeGlossaryTerm(match[2] ?? "");
    if (source && target) result[source] = target;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeGlossaryTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
