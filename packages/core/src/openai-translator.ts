export interface TextTranslationItem {
  id: string;
  text: string;
  context?: string;
}

export interface TextTranslationOptions {
  retranslate?: boolean;
  previousTranslations?: Array<{ id: string; translatedText: string }>;
  glossary?: Record<string, string>;
  chapterContext?: string;
  termCandidates?: string[];
  /** External cancellation signal (e.g. user cancel); aborts in-flight requests. */
  signal?: AbortSignal;
  /** Translation style preset. "martial" applies wuxia/murim localization rules. */
  style?: "general" | "martial";
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
  timeoutMs?: number;
  temperature?: number;
  /** Maximum items per chat request. Larger batches degrade translation quality on long pages. */
  maxItemsPerRequest?: number;
  /** Hard cap on completion tokens so long pages are never truncated mid-JSON. */
  maxTokens?: number;
  /** Send response_format json_object. Default true; falls back to plain JSON parsing when the provider rejects it. */
  jsonMode?: boolean;
  fetch?: typeof fetch;
}

const DEFAULT_MAX_ITEMS_PER_REQUEST = 12;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_TIMEOUT_MS = 90000;

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
    const payload = await readJsonResponse(response, "OpenAI-compatible models");
    const models = (payload.data ?? []).map((item) => typeof item.id === "string" ? item.id : "").filter(Boolean);
    return models.length ? models : [this.options.model];
  }

  async translate(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions = {}): Promise<TextTranslationResult[]> {
    if (!items.length) return [];
    const maxItems = Math.max(1, Math.min(40, this.options.maxItemsPerRequest ?? DEFAULT_MAX_ITEMS_PER_REQUEST));
    const results: TextTranslationResult[] = [];
    const translatedSoFar: TextTranslationResult[] = [];
    const sourceById = new Map(items.map((item) => [item.id, item.text]));
    for (let start = 0; start < items.length; start += maxItems) {
      const chunk = items.slice(start, start + maxItems);
      const chunkOptions: TextTranslationOptions = { ...options };
      // Give later batches the tail of already-translated earlier batches so
      // the model keeps names, tone, and word order consistent across the page.
      const pageTail = translatedSoFar
        .filter((item) => item.translatedText && item.translatedText !== sourceById.get(item.id))
        .slice(-6);
      if (pageTail.length) {
        chunkOptions.previousTranslations = [...(options.previousTranslations ?? []), ...pageTail].slice(-12);
      }
      const chunkResults = await this.translateChunk(chunk, targetLanguage, sourceLanguage, chunkOptions);
      results.push(...chunkResults);
      translatedSoFar.push(...chunkResults);
    }
    return results;
  }

  private async translateChunk(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions): Promise<TextTranslationResult[]> {
    const jsonModes = this.options.jsonMode === false ? [false] : [true, false];
    let lastError: unknown;
    for (const useJsonMode of jsonModes) {
      try {
        return await this.translateChunkWithRetries(items, targetLanguage, sourceLanguage, options, useJsonMode);
      } catch (error) {
        lastError = error;
        if (!isJsonFormatRejection(error)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async translateChunkWithRetries(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions, useJsonMode: boolean): Promise<TextTranslationResult[]> {
    const attempts = Math.max(1, Math.min(5, this.options.attempts ?? 3));
    const timeoutMs = Math.max(10000, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const fetchImpl = this.options.fetch ?? globalThis.fetch;
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        const response = await fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
          signal,
          body: JSON.stringify({
            model: this.options.model,
            temperature: this.options.temperature ?? DEFAULT_TEMPERATURE,
            max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
            messages: [{
              role: "user",
              content: buildTranslationPrompt(items, targetLanguage, sourceLanguage, options),
            }],
          }),
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const error = new Error(`OpenAI-compatible text translator failed: ${response.status}`);
          if (useJsonMode && response.status === 400 && /response_format|json_object|json\s*format|format\s*error/i.test(errorText)) {
            throw new JsonFormatRejectionError(error);
          }
          throw error;
        }
        const payload = await readJsonResponse(response, "OpenAI-compatible text translator");
        return parseTranslationResults(payload.choices?.[0]?.message?.content ?? "", items);
      } catch (error) {
        const externalAborted = options.signal?.aborted === true;
        const timedOut = error instanceof Error && error.name === "AbortError" && !externalAborted;
        lastError = timedOut ? new Error(`OpenAI-compatible text translator timed out after ${timeoutMs}ms`) : error;
        if (lastError instanceof JsonFormatRejectionError || externalAborted || attempt >= attempts || !isRetriableTranslatorError(timedOut ? lastError : error)) break;
        await delay((this.options.retryDelayMs ?? 800) * attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

class JsonFormatRejectionError extends Error {
  constructor(cause: Error) {
    super(cause.message);
    this.name = "JsonFormatRejectionError";
  }
}

function isJsonFormatRejection(error: unknown): boolean {
  return error instanceof JsonFormatRejectionError;
}

async function readJsonResponse(response: Response, label: string): Promise<{ data?: Array<{ id?: unknown }>; choices?: Array<{ message?: { content?: string } }> }> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!/json/i.test(contentType)) {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${label} returned non-JSON response (${contentType || "unknown content-type"}). Check that Base URL includes /v1. Preview: ${preview}`);
  }
  try {
    return JSON.parse(text) as { data?: Array<{ id?: unknown }>; choices?: Array<{ message?: { content?: string } }> };
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function buildTranslationPrompt(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions = {}): string {
  const retryGuidance = options.retranslate
    ? [
      "This is a RETRANSLATION request: the previous version was poor, unnatural, or inconsistent. Keep the meaning, but rewrite the Chinese so it reads like native localization.",
    ]
    : [];
  const glossaryGuidance = options.glossary && Object.keys(options.glossary).length
    ? [
      `USER GLOSSARY (hard constraint, source term -> required translation): ${JSON.stringify(options.glossary)}`,
      "Whenever a glossary source term appears, output exactly its required translation. Never rename, reinterpret, or vary it.",
    ]
    : [];
  const previousGuidance = options.previousTranslations?.length
    ? [
      `Previous translations of the same page (reference only, improve wording while keeping names and tone consistent): ${JSON.stringify(options.previousTranslations)}`,
    ]
    : [];
  const chapterGuidance = options.chapterContext?.trim()
    ? [
      `Chapter context (use ONLY for name/relationship/tone consistency; do not invent plot facts): ${options.chapterContext.trim()}`,
    ]
    : [];
  const termCandidateGuidance = options.termCandidates?.length
    ? [
      `Likely proper names on this page (keep each consistent; transliterate confidently, otherwise keep the source form): ${JSON.stringify(options.termCandidates)}`,
    ]
    : [];
  const styleGuidance = options.style === "martial"
    ? [
      "MARTIAL ARTS (wuxia/murim) MODE:",
      "- Martial-arts terminology follows established Chinese wuxia conventions: sects, martial arts, cultivation realms, titles and epithets get concise natural Chinese renderings (e.g. \"Heavenly Demon\" -> 天魔, \"Murim\" -> 武林, \"Northern Heavenly Sect\" -> 北天派). Prefer a standard wuxia-style name over a literal translation.",
      "- Keep names short and consistent across all items; never leave English names inline.",
      "- Fight dialogue and taunts must be terse and punchy. Narration uses compact classical-flavored prose, not modern essay style.",
    ]
    : [
      "If the source contains proper nouns (names, places, titles, skills), render them as short consistent Chinese names; never leave English names inline.",
    ];
  const lines: string[] = [
    `You are a professional manga localizer. Translate the OCR text below into natural, colloquial ${targetLanguage}, exactly as a native ${targetLanguage} reader would say it in a comic.`,
    "",
    "RULES (follow all):",
    "- Dialogue must be short, emotional, spoken-language style. Narration is polished prose. Shouts/action text is short and punchy.",
    "- NEVER translate word-by-word or keep the source sentence structure. If it sounds like machine translation, rewrite it until it does not.",
    "- For Chinese output, reorder to natural Chinese word order: put time/place/setting before the action, modifiers before nouns, split long English sentences into short Chinese clauses. Never keep English sentence order.",
    "- Keep every sentence SHORT: if a source sentence is long, break it into several short Chinese sentences. In bubbles, shorter is always better.",
    "- Chinese output must avoid translationese: no unnecessary 被-passives, no stacked 的, no filler words like 进行/位于/对于/作为/通过/关于, no Europeanized phrasing, no redundant subjects.",
    "- Proper names: use glossary terms exactly. Keep every name consistent across all items. Never output half-translated names (e.g. Chinese text mixed with leftover English like \"龙王Dragon\").",
    "- Each item's context field (order, kind, previous/next text) is layout info: use it only for tone, continuity, and speaker intent. Never invent plot facts.",
    "- Preserve punctuation-only items (…, ?!, etc.) unchanged. Do not add explanations, notes, or quotation marks.",
    "- Keep every item id unchanged. Return STRICT JSON only, no commentary, in exactly this shape:",
    "{\"items\":[{\"id\":\"<item id>\",\"translatedText\":\"<translation>\"}]}",
    ...styleGuidance,
  ];
  if (isChineseTarget(targetLanguage)) {
    lines.push(
      "",
      "EXAMPLE (match this register and style):",
      "Input: {\"items\":[{\"id\":\"a1\",\"text\":\"I will protect everyone no matter what!\"},{\"id\":\"a2\",\"text\":\"Father... I am sorry. I could not save him.\"}]}",
      "Output: {\"items\":[{\"id\":\"a1\",\"translatedText\":\"不管发生什么，我都会保护好大家！\"},{\"id\":\"a2\",\"translatedText\":\"父亲……对不起，我没能救下他。\"}]}",
    );
  }
  lines.push(
    "",
    ...chapterGuidance,
    ...glossaryGuidance,
    ...termCandidateGuidance,
    ...previousGuidance,
    ...retryGuidance,
    "",
    JSON.stringify({ items }),
  );
  return lines.join("\n");
}

function isChineseTarget(targetLanguage: string): boolean {
  return /^zh/i.test(targetLanguage.trim());
}

export function parseTranslationResults(content: string, fallbackItems: TextTranslationItem[]): TextTranslationResult[] {
  const candidate = extractJsonCandidate(content);
  if (!candidate) return fallbackItems.map((item) => ({ id: item.id, translatedText: item.text }));
  let parsedItems: Array<{ id?: unknown; translatedText?: unknown }> = [];
  try {
    const parsed = JSON.parse(candidate) as { items?: Array<{ id?: unknown; translatedText?: unknown }> } | Array<{ id?: unknown; translatedText?: unknown }>;
    parsedItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return fallbackItems.map((item) => ({ id: item.id, translatedText: item.text }));
  }
  const byId = new Map<string, string>();
  for (const item of parsedItems) {
    if (typeof item.id === "string" && typeof item.translatedText === "string") byId.set(item.id, item.translatedText);
  }
  // Every input item must come back: translated when the model returned it,
  // otherwise the source text so nothing silently disappears from the page.
  return fallbackItems.map((item) => ({ id: item.id, translatedText: byId.get(item.id) ?? item.text }));
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
