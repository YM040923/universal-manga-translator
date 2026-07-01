import type { Rect, TextRegion } from "@umt/shared";
import type { ProviderInput, VisionProvider } from "./provider.js";

export interface OcrRegion {
  id: string;
  box: Rect;
  sourceText: string;
  confidence: number;
  orientation: TextRegion["orientation"];
  kind: TextRegion["kind"];
}

export interface OcrProvider {
  recognize(input: ProviderInput): Promise<OcrRegion[]>;
}

export interface TextTranslationItem {
  id: string;
  text: string;
}

export interface TextTranslationResult {
  id: string;
  translatedText: string;
}

export interface TextTranslationProvider {
  translate(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string): Promise<TextTranslationResult[]>;
}

export interface OcrThenTranslateProviderOptions {
  profile: string;
  ocr: OcrProvider;
  translator: TextTranslationProvider;
}

export class OcrThenTranslateProvider implements VisionProvider {
  readonly profile: string;

  constructor(private readonly options: OcrThenTranslateProviderOptions) {
    this.profile = options.profile;
  }

  async process(input: ProviderInput): Promise<TextRegion[]> {
    const ocrRegions = await this.options.ocr.recognize(input);
    const translated = await this.options.translator.translate(
      ocrRegions.map((region) => ({ id: region.id, text: region.sourceText })),
      input.task.targetLanguage,
      input.task.sourceLanguage,
    );
    const translatedById = new Map(translated.map((item) => [item.id, item.translatedText]));
    return ocrRegions.map((region) => ({
      id: region.id,
      box: region.box,
      sourceText: region.sourceText,
      translatedText: translatedById.get(region.id) ?? region.sourceText,
      confidence: region.confidence,
      orientation: region.orientation,
      kind: region.kind,
    }));
  }
}
