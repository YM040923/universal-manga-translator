import { createHash } from "node:crypto";
export function sha256Hex(data) { return createHash("sha256").update(data).digest("hex"); }
export function buildCacheKey(input) { return `img:${input.imageHash}:lang:${input.targetLanguage}:provider:${input.providerProfile}:layout:${input.layoutVersion}`; }
//# sourceMappingURL=hashing.js.map