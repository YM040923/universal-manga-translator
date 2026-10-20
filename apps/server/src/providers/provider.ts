import type { SurfaceTask, TextRegion } from "@umt/shared";
import type { ApiKeyPoolStatus } from "./api-key-pool.js";

export interface ProviderInput {
  task: SurfaceTask;
  imageBuffer: Buffer;
  imageHash: string;
  width: number;
  height: number;
  forceRetranslate?: boolean;
}

export interface VisionProvider {
  readonly profile: string;
  listModels?(): Promise<string[]>;
  keyStatus?(): ApiKeyPoolStatus | undefined;
  process(input: ProviderInput): Promise<TextRegion[]>;
}

