import type { TextRegion } from "@umt/shared";
import type { ProviderInput, VisionProvider } from "./provider.js";

export interface OpenAIVisionProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
  imageInputFormat?: "image-url" | "image-field";
}

export class OpenAIVisionProvider implements VisionProvider {
  readonly profile: string;

  constructor(private readonly options: OpenAIVisionProviderOptions) {
    this.profile = `openai-compatible:${options.model}`;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
      });
      if (!response.ok) return [this.options.model];
      const payload = (await response.json()) as { data?: Array<{ id?: unknown }>; models?: unknown[] };
      const ids = (Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [])
        .map((item) => typeof item === "string" ? item : typeof item === "object" && item && "id" in item ? (item as { id?: unknown }).id : undefined)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
      return ids.length ? Array.from(new Set(ids)) : [this.options.model];
    } catch {
      return [this.options.model];
    }
  }

  static parseRegionsFromContent(content: string): TextRegion[] {
    const candidate = extractJsonCandidate(content);
    if (!candidate) return [];
    const parsed = parseModelJson(candidate);
    if (!parsed) return [];
    const regions = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { regions?: unknown }).regions) ? (parsed as { regions: unknown[] }).regions : [];
    return regions.filter(isUsefulRegion) as TextRegion[];
  }

  async process(input: ProviderInput): Promise<TextRegion[]> {
    const imageUrl = `data:image/jpeg;base64,${input.imageBuffer.toString("base64")}`;
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: buildVisionPrompt(input.task.targetLanguage || this.options.targetLanguage) },
            this.options.imageInputFormat === "image-field"
              ? { type: "image", image: imageUrl }
              : { type: "image_url", image_url: { url: imageUrl } },
          ],
        }],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible provider failed: ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return OpenAIVisionProvider.parseRegionsFromContent(payload.choices?.[0]?.message?.content ?? "{\"regions\":[]}");
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

function parseModelJson(candidate: string): unknown | null {
  for (const attempt of [candidate, repairLooseJson(candidate)]) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next repair strategy
    }
  }
  return null;
}

function repairLooseJson(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => `"${inner.replace(/"/g, '\\"')}"`)
    .replace(/:\s*\.([0-9]+)/g, ': 0.$1')
    .replace(/,\s*([}\]])/g, '$1');
}

function buildVisionPrompt(targetLanguage: string): string {
  return [
    "You are a manga OCR and translation engine.",
    `Find every visible speech/narration/SFX text region in the image and translate it to ${targetLanguage}.`,
    "Return strict JSON only, with this shape:",
    "{\"regions\":[{\"id\":string,\"box\":{\"x\":number,\"y\":number,\"width\":number,\"height\":number},\"sourceText\":string,\"translatedText\":string,\"confidence\":number,\"orientation\":\"horizontal\"|\"vertical\"|\"unknown\",\"kind\":\"dialogue\"|\"narration\"|\"sfx\"|\"unknown\"}]}",
    "Coordinates must be in provided image pixels, using the exact pixel coordinate space of the image attached in this request.",
    "Use tight bounding boxes around the actual text glyphs/lines only.",
    "Do not use the whole speech bubble, panel, character, or page as the box.",
    "For large speech bubbles, box only the text area, not the blank bubble area.",
    "If there is no readable text, Return {\"regions\":[]}.",
    "Never return placeholder regions. Never return empty sourceText or empty translatedText.",
  ].join("\n");
}

function isUsefulRegion(region: TextRegion): boolean {
  const hasText = typeof region.sourceText === "string" && region.sourceText.trim().length > 0 && typeof region.translatedText === "string" && region.translatedText.trim().length > 0;
  const hasBox = region.box && region.box.width > 1 && region.box.height > 1;
  const confidence = typeof region.confidence === "number" && Number.isFinite(region.confidence) ? region.confidence : 0;
  return hasText && hasBox && confidence >= 0.2 && !looksLikeProviderPlaceholder(region.sourceText) && !looksLikeProviderPlaceholder(region.translatedText);
}

function looksLikeProviderPlaceholder(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("image unavailable")
    || normalized.includes("cannot perform")
    || normalized.includes("cannot access")
    || normalized.includes("unable to ocr")
    || normalized.includes("无法进行图像")
    || normalized.includes("无法识别图像")
    || normalized.includes("不能识别图像");
}
