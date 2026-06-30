import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { SurfaceResult, SurfaceTask } from "@umt/shared";
import { buildCacheKey, sha256Hex } from "@umt/shared/hashing";
import { LAYOUT_VERSION, layoutRegions } from "../layout/layout.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { VisionProvider } from "../providers/provider.js";
import type { SurfaceCache } from "../cache/surface-cache.js";
import { readTaskImage } from "../image/image-input.js";

export interface BuildServerOptions {
  provider: string;
  targetLanguage: string;
  visionProvider?: VisionProvider;
  surfaceCache?: SurfaceCache;
}

function decodeImageData(imageData: string): Buffer {
  const base64 = imageData.includes(",") ? imageData.split(",").at(-1) ?? "" : imageData;
  return Buffer.from(base64, "base64");
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const provider = options.visionProvider ?? new MockProvider();
  const memoryCache = new Map<string, SurfaceResult>();
  const surfaceCache = options.surfaceCache;
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, provider: options.provider, targetLanguage: options.targetLanguage }));

  app.post<{ Body: { task: SurfaceTask } }>("/v1/surfaces/submit", async (request) => {
    const started = Date.now();
    const task = request.body.task;
    const { buffer: imageBuffer } = await readTaskImage(task);
    const imageHash = sha256Hex(imageBuffer);
    const cacheKey = buildCacheKey({ imageHash, targetLanguage: task.targetLanguage, providerProfile: provider.profile, layoutVersion: LAYOUT_VERSION });
    const cached = surfaceCache?.get(cacheKey) ?? memoryCache.get(cacheKey);
    if (cached) {
      const cachedForSurface: SurfaceResult = { ...cached, surfaceId: task.surfaceId, status: "cached" };
      return { ok: true, surfaceId: task.surfaceId, status: "cached", result: cachedForSurface };
    }

    const regions = await provider.process({ task, imageBuffer, imageHash, width: task.naturalSize.width, height: task.naturalSize.height });
    const result: SurfaceResult = {
      surfaceId: task.surfaceId,
      imageHash,
      status: regions.length ? "completed" : "empty",
      regions: layoutRegions(regions),
      providerProfile: provider.profile,
      layoutVersion: LAYOUT_VERSION,
      elapsedMs: Date.now() - started,
    };
    memoryCache.set(cacheKey, result);
    surfaceCache?.save(cacheKey, result);
    return { ok: true, surfaceId: task.surfaceId, status: result.status, result };
  });

  return app;
}





