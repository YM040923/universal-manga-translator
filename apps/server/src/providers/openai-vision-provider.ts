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

  static parseRegionsFromContent(content: string): TextRegion[] {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = fenced ?? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
    if (!candidate || candidate.trim().length === 0) return [];
    const parsed = JSON.parse(candidate) as { regions?: TextRegion[] };
    return Array.isArray(parsed.regions) ? parsed.regions.filter(isUsefulRegion) : [];
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
            { type: "text", text: buildVisionPrompt(this.options.targetLanguage) },
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

function buildVisionPrompt(targetLanguage: string): string {
  return [
    "You are a manga OCR and translation engine.",
    `Find every visible speech/narration/SFX text region in the image and translate it to ${targetLanguage}.`,
    "Return strict JSON only, with this shape:",
    "{\"regions\":[{\"id\":string,\"box\":{\"x\":number,\"y\":number,\"width\":number,\"height\":number},\"sourceText\":string,\"translatedText\":string,\"confidence\":number,\"orientation\":\"horizontal\"|\"vertical\"|\"unknown\",\"kind\":\"dialogue\"|\"narration\"|\"sfx\"|\"unknown\"}]}",
    "Coordinates must be in original image pixels, not normalized values.",
    "If there is no readable text, Return {\"regions\":[]}.",
    "Never return placeholder regions. Never return empty sourceText or empty translatedText.",
  ].join("\n");
}

function isUsefulRegion(region: TextRegion): boolean {
  const hasText = typeof region.sourceText === "string" && region.sourceText.trim().length > 0 && typeof region.translatedText === "string" && region.translatedText.trim().length > 0;
  const hasBox = region.box && region.box.width > 1 && region.box.height > 1;
  return hasText && hasBox;
}
