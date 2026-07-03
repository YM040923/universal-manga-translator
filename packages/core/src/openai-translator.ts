export interface TextTranslationItem {
  id: string;
  text: string;
  context?: string;
}

export interface TextTranslationOptions {
  retranslate?: boolean;
  previousTranslations?: Array<{ id: string; translatedText: string }>;
  glossary?: Record<string, string>;
}

export interface TextTranslationResult {
  id: string;
  translatedText: string;
}

export interface TextTranslationProvider {
  listModels?(): Promise<string[]>;
  translate(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options?: TextTranslationOptions): Promise<TextTranslationResult[]>;
}

export interface OpenAICompatibleTextTranslatorOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  attempts?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export class OpenAICompatibleTextTranslator {
  readonly profile: string;

  constructor(private readonly options: OpenAICompatibleTextTranslatorOptions) {
    this.profile = `openai-compatible-text:${options.model}`;
  }

  async listModels(): Promise<string[]> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const response = await fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { authorization: `Bearer ${this.options.apiKey}` },
    });
    if (!response.ok) return [this.options.model];
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    const models = (payload.data ?? []).map((item) => typeof item.id === "string" ? item.id : "").filter(Boolean);
    return models.length ? models : [this.options.model];
  }

  async translate(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions = {}): Promise<TextTranslationResult[]> {
    if (!items.length) return [];
    const attempts = Math.max(1, Math.min(5, this.options.attempts ?? 3));
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const fetchImpl = this.options.fetch ?? globalThis.fetch;
        const response = await fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: this.options.model,
            temperature: 0.1,
            messages: [{
              role: "user",
              content: buildTranslationPrompt(items, targetLanguage, sourceLanguage, options),
            }],
          }),
        });
        if (!response.ok) throw new Error(`OpenAI-compatible text translator failed: ${response.status}`);
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return parseTranslationResults(payload.choices?.[0]?.message?.content ?? "", items);
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetriableTranslatorError(error)) break;
        await delay((this.options.retryDelayMs ?? 800) * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export function buildTranslationPrompt(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions = {}): string {
  const retryGuidance = options.retranslate
    ? [
      "This is a retranslation request: the previous result may be poor, misplaced, unnatural, or inconsistent.",
      "Improve the localization quality while staying faithful to the OCR text and manga context.",
    ]
    : [];
  const glossaryGuidance = options.glossary && Object.keys(options.glossary).length
    ? [`Use this glossary consistently: ${JSON.stringify(options.glossary)}`]
    : [];
  const previousGuidance = options.previousTranslations?.length
    ? [`Previous translations for improvement/reference: ${JSON.stringify(options.previousTranslations)}`]
    : [];
  return [
    "You are a professional manga localization translator for comic speech bubbles.",
    `Translate the following OCR text from ${sourceLanguage || "auto"} to ${targetLanguage}.`,
    "Write natural Chinese dialogue suitable for manga speech bubbles: concise, emotional, conversational, and readable in small bubbles.",
    "Use surrounding items as the same manga page context, but keep each item id unchanged.",
    "Keep each item id unchanged. Return strict JSON only with this shape:",
    "{\"items\":[{\"id\":string,\"translatedText\":string}]}",
    "Preserve punctuation-only text such as ellipses or question marks. Do not add explanations.",
    "Handle proper names carefully: all-caps English names, character names, places, sects, titles, skills, and nicknames are often proper names.",
    "Do not translate character names literally as common words. Transliterate stable names into natural Chinese when confident; otherwise keep the original English name unchanged.",
    "Do not output awkward half-translated names like Chinese text plus leftover all-caps English.",
    "Keep recurring proper names consistent within this batch.",
    ...glossaryGuidance,
    ...previousGuidance,
    ...retryGuidance,
    JSON.stringify({ items }),
  ].join("\n");
}

export function parseTranslationResults(content: string, fallbackItems: TextTranslationItem[]): TextTranslationResult[] {
  const candidate = extractJsonCandidate(content);
  if (!candidate) return fallbackItems.map((item) => ({ id: item.id, translatedText: item.text }));
  try {
    const parsed = JSON.parse(candidate) as { items?: Array<{ id?: unknown; translatedText?: unknown }> } | Array<{ id?: unknown; translatedText?: unknown }>;
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    const results = items
      .map((item) => typeof item.id === "string" && typeof item.translatedText === "string" ? { id: item.id, translatedText: item.translatedText } : null)
      .filter((item): item is TextTranslationResult => Boolean(item));
    return results.length ? results : fallbackItems.map((item) => ({ id: item.id, translatedText: item.text }));
  } catch {
    return fallbackItems.map((item) => ({ id: item.id, translatedText: item.text }));
  }
}

function extractJsonCandidate(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();
  const objectStart = content.indexOf("{");
  const objectEnd = content.lastIndexOf("}");
  const arrayStart = content.indexOf("[");
  const arrayEnd = content.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart && (objectStart < 0 || arrayStart < objectStart)) return content.slice(arrayStart, arrayEnd + 1).trim();
  if (objectStart >= 0 && objectEnd > objectStart) return content.slice(objectStart, objectEnd + 1).trim();
  return "";
}

function isRetriableTranslatorError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /fetch failed|socket|timeout|ECONNRESET|ETIMEDOUT|429|500|502|503|504|524/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
