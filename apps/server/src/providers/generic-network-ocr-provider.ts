import type { OcrProvider, OcrRegion } from "./pipeline-provider.js";
import type { ProviderInput } from "./provider.js";
import {
  GenericNetworkOcrClient,
  getByPath,
  parseGenericOcrRegions,
  type GenericNetworkOcrClientOptions,
  type GenericOcrInputMode,
  type GenericOcrParseOptions,
} from "@umt/core";

export type { GenericOcrInputMode, GenericOcrParseOptions };
export { getByPath, parseGenericOcrRegions };
export type GenericNetworkOcrProviderOptions = GenericNetworkOcrClientOptions;

export class GenericNetworkOcrProvider implements OcrProvider {
  readonly profile = "network-ocr";
  private readonly client: GenericNetworkOcrClient;

  constructor(options: GenericNetworkOcrProviderOptions) {
    this.client = new GenericNetworkOcrClient(options);
  }

  keyStatus() {
    return this.client.keyStatus();
  }

  async recognize(input: ProviderInput): Promise<OcrRegion[]> {
    return this.client.recognize({
      imageBytes: new Uint8Array(input.imageBuffer),
      fileName: "surface.jpg",
      mimeType: "image/jpeg",
    });
  }
}
