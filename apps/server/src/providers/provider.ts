import type { SurfaceTask, TextRegion } from "@umt/shared";
import type { ApiKeyPoolStatus } from "@umt/core";

export interface ProviderInput {
  task: SurfaceTask;
  imageBuffer: Buffer;
  imageHash: string;
  width: number;
  height: number;
  forceRetranslate?: boolean;
  /** External cancellation signal (user cancel); aborts in-flight OCR/LLM calls. */
  signal?: AbortSignal;
}

export interface VisionProvider {
  readonly profile: string;
  listModels?(): Promise<string[]>;
  keyStatus?(): ApiKeyPoolStatus | undefined;
  process(input: ProviderInput): Promise<TextRegion[]>;
}

