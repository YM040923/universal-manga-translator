import type { TextRegion } from "@umt/shared";
import type { ProviderInput, VisionProvider } from "./provider.js";

export class MockProvider implements VisionProvider {
  readonly profile = "mock";

  async process(input: ProviderInput): Promise<TextRegion[]> {
    return [{
      id: "r1",
      box: { x: Math.round(input.width * 0.2), y: Math.round(input.height * 0.1), width: Math.round(input.width * 0.45), height: Math.round(input.height * 0.18) },
      sourceText: "Hello",
      translatedText: "测试译文",
      confidence: 0.99,
      orientation: "horizontal",
      kind: "dialogue",
    }];
  }
}

