import type { ApiKeyPoolStatus } from "@umt/core";
import type { SurfaceTask, TextRegion } from "@umt/shared";

export interface ProviderInput {
  task: SurfaceTask;
  imageBuffer: Buffer;
  imageHash: string;
  width: number;
  height: number;
  forceRetranslate?: boolean;
  glossary?: Record<string, string>;
  /** Earlier pages of the same chapter, used by the translator for name and tone continuity. */
  chapterContext?: string;
  termCandidates?: string[];
  signal?: AbortSignal;
}

export interface VisionProvider {
  readonly profile: string;
  listModels?(): Promise<string[]>;
  keyStatus?(): ApiKeyPoolStatus | undefined;
  process(input: ProviderInput): Promise<TextRegion[]>;
}
