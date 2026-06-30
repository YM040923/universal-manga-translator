import type { SurfaceTask, TextRegion } from "@umt/shared";

export interface ProviderInput {
  task: SurfaceTask;
  imageBuffer: Buffer;
  imageHash: string;
  width: number;
  height: number;
}

export interface VisionProvider {
  readonly profile: string;
  process(input: ProviderInput): Promise<TextRegion[]>;
}
