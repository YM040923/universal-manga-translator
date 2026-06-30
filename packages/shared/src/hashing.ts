import { createHash } from "node:crypto";

export interface CacheKeyInput { imageHash: string; targetLanguage: string; providerProfile: string; layoutVersion: number; }
export function sha256Hex(data: Buffer | Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
export function buildCacheKey(input: CacheKeyInput): string { return `img:${input.imageHash}:lang:${input.targetLanguage}:provider:${input.providerProfile}:layout:${input.layoutVersion}`; }
