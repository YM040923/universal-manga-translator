export interface CacheKeyInput {
    imageHash: string;
    targetLanguage: string;
    providerProfile: string;
    layoutVersion: number;
}
export declare function sha256Hex(data: Buffer | Uint8Array | string): string;
export declare function buildCacheKey(input: CacheKeyInput): string;
