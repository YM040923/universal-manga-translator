import { createHash } from "node:crypto";

export interface CacheKeyInput { imageHash: string; targetLanguage: string; providerProfile: string; layoutVersion: number; glossaryVersion?: string; }
export function sha256Hex(data: Buffer | Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
export function buildCacheKey(input: CacheKeyInput): string {
  const glossary = input.glossaryVersion ? `:glossary:${input.glossaryVersion}` : "";
  return `img:${input.imageHash}:lang:${input.targetLanguage}:provider:${input.providerProfile}:layout:${input.layoutVersion}${glossary}`;
}
