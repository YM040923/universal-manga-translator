export function normalizeGlossaryText(value: unknown): string {
  if (typeof value !== "string") return "";
  const entries = Object.entries(parseGlossaryText(value));
  return entries.map(([source, target]) => `${source} = ${target}`).join("\n");
}

export function parseGlossaryText(value: string): Record<string, string> {
  const glossary: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(.+?)(?:=>|=|:)(.+)$/);
    if (!match) continue;
    const source = normalizeGlossaryTerm(match[1] ?? "");
    const target = normalizeGlossaryTerm(match[2] ?? "");
    if (!source || !target) continue;
    glossary[source] = target;
  }
  return Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)));
}

export function glossaryHash(glossary: Record<string, string>): string {
  const entries = Object.entries(glossary);
  if (!entries.length) return "glossary:empty";
  const canonical = JSON.stringify(entries);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const char of canonical) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return `glossary:${hash.toString(16).padStart(16, "0")}`;
}

function normalizeGlossaryTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
