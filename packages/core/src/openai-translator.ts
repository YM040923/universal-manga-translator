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

type OptionalChatParameter = "reasoning_effort" | "response_format";
type JsonOutputMode = "schema" | "json_object" | "prompt";

interface ChatCapabilities {
  reasoningEffort: "none" | "minimal" | "low" | false;
  jsonOutput: JsonOutputMode;
}

interface OpenAICompatibleResponse {
  data?: Array<{ id?: unknown }>;
  choices?: Array<{
    message?: { content?: unknown; refusal?: unknown };
    finish_reason?: unknown;
  }>;
  error?: string | { message?: unknown };
}

const chatCapabilities = new Map<string, ChatCapabilities>();
const TRANSLATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "manga_translations",
    strict: true,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              translatedText: { type: "string" },
            },
            required: ["id", "translatedText"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
} as const;

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
    const attempts = Math.max(1, Math.min(5, this.options.attempts ?? 3));
    const cacheKey = this.options.baseUrl.replace(/\/$/, "").toLowerCase() + "\n" + this.options.model;
    const capabilities = chatCapabilities.get(cacheKey) ?? { reasoningEffort: "none" as const, jsonOutput: "schema" as const };
    chatCapabilities.set(cacheKey, capabilities);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const fetchImpl = this.options.fetch ?? globalThis.fetch;
        const requestBody: Record<string, unknown> = {
          model: this.options.model,
          messages: [{
            role: "user",
            content: buildTranslationPrompt(items, targetLanguage, sourceLanguage, options),
          }],
        };
        if (capabilities.reasoningEffort) requestBody.reasoning_effort = capabilities.reasoningEffort;
        if (capabilities.jsonOutput === "schema") requestBody.response_format = TRANSLATION_RESPONSE_FORMAT;
        else if (capabilities.jsonOutput === "json_object") requestBody.response_format = { type: "json_object" };
        const response = await fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
          const body = await response.text();
          const reasoningEffortFallback = nextReasoningEffort(response.status, body, capabilities.reasoningEffort);
          if (reasoningEffortFallback !== undefined) {
            capabilities.reasoningEffort = reasoningEffortFallback;
            attempt -= 1;
            continue;
          }
          if (capabilities.jsonOutput === "schema" && isUnsupportedChatParameter(response.status, body, "response_format")) {
            capabilities.jsonOutput = "json_object";
            attempt -= 1;
            continue;
          }
          if (capabilities.jsonOutput === "schema" && isUnsupportedJsonSchema(response.status, body)) {
            capabilities.jsonOutput = "json_object";
            attempt -= 1;
            continue;
          }
          if (capabilities.jsonOutput === "json_object" && isUnsupportedChatParameter(response.status, body, "response_format")) {
            capabilities.jsonOutput = "prompt";
            attempt -= 1;
            continue;
          }
          throw new Error(formatApiError(response.status, body, this.options.apiKey));
        }
        const payload = await readJsonResponse(response, "OpenAI-compatible text translator");
        const choice = payload.choices?.[0];
        if (choice?.finish_reason === "length") throw new Error("AI translation response was truncated by the model token limit.");
        const refusal = choice?.message?.refusal;
        if (typeof refusal === "string" && refusal.trim()) throw new Error("AI translation was refused: " + refusal.trim().slice(0, 240));
        const content = extractAssistantText(choice?.message?.content);
        if (!content.trim()) throw new Error("AI translation response contained no readable text.");
        return parseTranslationResults(content, items);
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetriableTranslatorError(error)) break;
        await delay((this.options.retryDelayMs ?? 800) * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

async function readJsonResponse(response: Response, label: string): Promise<OpenAICompatibleResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!/json/i.test(contentType)) {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${label} returned non-JSON response (${contentType || "unknown content-type"}). Check that Base URL includes /v1. Preview: ${preview}`);
  }
  try {
    return JSON.parse(text) as OpenAICompatibleResponse;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : "")
    .filter(Boolean)
    .join("\n");
}

function isUnsupportedChatParameter(status: number, body: string, parameter: OptionalChatParameter): boolean {
  if (status !== 400 && status !== 422) return false;
  const text = body.toLowerCase();
  if (!text.includes(parameter)) return false;
  return /unsupported|not supported|does not support|unrecognized|unknown parameter|unexpected parameter|invalid parameter|not allowed/i.test(text);
}

function nextReasoningEffort(
  status: number,
  body: string,
  current: ChatCapabilities["reasoningEffort"],
): ChatCapabilities["reasoningEffort"] | undefined {
  if (!current || (status !== 400 && status !== 422)) return undefined;
  const text = body.toLowerCase();
  if (!text.includes("reasoning_effort")) return undefined;

  const rejectedValue = /(?:invalid|unsupported|not supported|not allowed)\s+(?:value|reasoning_effort)|(?:value|reasoning_effort).{0,48}(?:invalid|unsupported|not supported|not allowed)|\b(?:none|minimal|low)\b.{0,48}(?:unsupported|not supported|invalid|not allowed)|(?:must|should)\s+be\s+one\s+of|(?:valid|allowed|supported)\s+values/i.test(text);
  if (rejectedValue) {
    if (current === "none") return "minimal";
    if (current === "minimal") return "low";
    return false;
  }
  return isUnsupportedChatParameter(status, body, "reasoning_effort") ? false : undefined;
}

function isUnsupportedJsonSchema(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const text = body.toLowerCase();
  return text.includes("json_schema")
    && /unsupported|not supported|does not support|unrecognized|unknown|not allowed/i.test(text);
}

function formatApiError(status: number, body: string, secret: string): string {
  let detail = "";
  try {
    const payload = JSON.parse(body) as { error?: string | { message?: unknown } };
    const error = payload.error;
    detail = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "";
  } catch {
    detail = body;
  }
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 400);
  if (secret) detail = detail.split(secret).join("[redacted]");
  return "OpenAI-compatible text translator failed: HTTP " + status + (detail ? ": " + detail : "");
}

export function buildTranslationPrompt(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions = {}): string {
  const retryGuidance = options.retranslate
    ? [
      "This is a retranslation request: the previous result may be poor, misplaced, unnatural, or inconsistent.",
      "Improve the localization quality while staying faithful to the OCR text and manga context.",
    ]
    : [];
  const glossaryGuidance = options.glossary && Object.keys(options.glossary).length
    ? [
      `User glossary (mandatory, source term -> required translation): ${JSON.stringify(options.glossary)}`,
      "Do not rename, reinterpret, literal-translate, or vary User glossary terms. If a source term appears, use exactly its required translation consistently.",
    ]
    : [];
  const previousGuidance = options.previousTranslations?.length
    ? [`Previous translations for improvement/reference: ${JSON.stringify(options.previousTranslations)}`]
    : [];
  const chapterGuidance = options.chapterContext?.trim()
    ? [
      `Chapter context: ${options.chapterContext.trim()}`,
      "Use this chapter context only to keep names, relationships, tone, and pronouns consistent. Do not invent facts not supported by the OCR text.",
    ]
    : [];
  const termCandidateGuidance = options.termCandidates?.length
    ? [
      `Auto-detected term candidates (likely names/titles/places/skills; keep each one semantically consistent across this request): ${JSON.stringify(options.termCandidates)}`,
      "If a candidate is a real proper name or title in context, choose a natural stable Chinese rendering and keep it consistent. If uncertain, keep the source term unchanged rather than guessing a literal meaning.",
    ]
    : [];
  return [
    "You are a professional manga localization translator and Chinese line editor for comic speech bubbles.",
    `Translate the following OCR text from ${sourceLanguage || "auto"} to ${targetLanguage}.`,
    "First understand the whole page context, speaker intent, emotional tone, and the relationship between adjacent bubbles; then translate each item.",
    "Write natural Chinese dialogue suitable for manga speech bubbles: concise, emotional, conversational, and readable in small bubbles.",
    "For dialogue, write fluent spoken Chinese/口语 with character emotion; for narration, use polished Chinese prose; for shouts and action text, keep it short and forceful.",
    "Avoid literal word-by-word translation, English sentence order, stiff machine-translated wording, and contradictions with nearby bubbles.",
    "Avoid translationese, unnatural Europeanized Chinese, redundant subjects, and overly formal wording unless the speaker's tone requires it.",
    "The final Chinese should read like a human comic localization, not machine-translated text.",
    "Use surrounding items and each item's context field as the same manga page context, but keep each item id unchanged.",
    "Infer omitted subjects/pronouns from context when necessary, but do not invent new plot facts.",
    "Keep each item id unchanged. Return strict JSON only with this shape:",
    "{\"items\":[{\"id\":string,\"translatedText\":string}]}",
    "Preserve punctuation-only text such as ellipses or question marks. Do not add explanations.",
    "Handle proper names carefully: all-caps English names, character names, places, sects, titles, skills, and nicknames are often proper names.",
    "Do not translate character names literally as common words. Transliterate stable names into natural Chinese when confident; otherwise keep the original English name unchanged.",
    "Do not output awkward half-translated names like Chinese text plus leftover all-caps English.",
    "Keep recurring proper names consistent within this batch.",
    ...chapterGuidance,
    ...glossaryGuidance,
    ...termCandidateGuidance,
    ...previousGuidance,
    ...retryGuidance,
    JSON.stringify({ items }),
  ].join("\n");
}

export function parseTranslationResults(content: string, expectedItems: TextTranslationItem[]): TextTranslationResult[] {
  const candidate = extractJsonCandidate(content);
  if (!candidate) throw new Error("AI translation response did not contain a JSON translation result.");
  let items: Array<{ id?: unknown; translatedText?: unknown }>;
  try {
    const parsed = JSON.parse(candidate) as { items?: unknown } | unknown[];
    items = Array.isArray(parsed)
      ? parsed as Array<{ id?: unknown; translatedText?: unknown }>
      : parsed && typeof parsed === "object" && Array.isArray(parsed.items)
        ? parsed.items as Array<{ id?: unknown; translatedText?: unknown }>
        : [];
  } catch {
    throw new Error("AI translation response contained invalid JSON.");
  }
  const expectedIds = new Set(expectedItems.map((item) => item.id));
  const translatedById = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || !expectedIds.has(item.id) || typeof item.translatedText !== "string") continue;
    translatedById.set(item.id, item.translatedText);
  }
  const missingIds = expectedItems.filter((item) => !translatedById.has(item.id)).map((item) => item.id);
  if (missingIds.length) throw new Error("AI translation response omitted " + missingIds.length + " requested item(s).");
  return expectedItems.map((item) => ({ id: item.id, translatedText: translatedById.get(item.id)! }));
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
