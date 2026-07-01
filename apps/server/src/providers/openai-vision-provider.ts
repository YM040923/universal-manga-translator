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
    return Array.isArray(parsed.regions) ? parsed.regions : [];
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
            { type: "text", text: `Detect manga text regions and translate them to ${this.options.targetLanguage}. Return only JSON: {"regions":[{"id":"r1","box":{"x":0,"y":0,"width":1,"height":1},"sourceText":"","translatedText":"","confidence":0.9,"orientation":"horizontal","kind":"dialogue"}]}` },
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
