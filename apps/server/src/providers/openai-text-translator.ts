import type { TextTranslationItem, TextTranslationOptions, TextTranslationProvider, TextTranslationResult } from "./pipeline-provider.js";
import {
  OpenAICompatibleTextTranslator,
  parseTranslationResults,
  type OpenAICompatibleTextTranslatorOptions,
} from "@umt/core";

export interface OpenAITextTranslatorOptions extends OpenAICompatibleTextTranslatorOptions {}
export { parseTranslationResults };

export class OpenAITextTranslator implements TextTranslationProvider {
  readonly profile: string;
  private readonly translator: OpenAICompatibleTextTranslator;

  constructor(options: OpenAITextTranslatorOptions) {
    this.translator = new OpenAICompatibleTextTranslator(options);
    this.profile = this.translator.profile;
  }

  listModels(): Promise<string[]> {
    return this.translator.listModels();
  }

  translate(items: TextTranslationItem[], targetLanguage: string, sourceLanguage: string, options: TextTranslationOptions = {}): Promise<TextTranslationResult[]> {
    return this.translator.translate(items, targetLanguage, sourceLanguage, options);
  }
}
