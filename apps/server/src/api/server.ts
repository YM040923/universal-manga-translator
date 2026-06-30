import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { SurfaceResult, SurfaceTask } from "@umt/shared";
import { buildCacheKey, sha256Hex } from "@umt/shared/hashing";
import type { SurfaceCache } from "../cache/surface-cache.js";
import { readTaskImage } from "../image/image-input.js";
import { normalizeForProvider } from "../image/normalize.js";
import { LAYOUT_VERSION, layoutRegions } from "../layout/layout.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { VisionProvider } from "../providers/provider.js";
import { EventBus } from "./events.js";

export interface BuildServerOptions {
  provider: string;
  targetLanguage: string;
  visionProvider?: VisionProvider;
  surfaceCache?: SurfaceCache;
  eventBus?: EventBus;
  maxImageLongEdge?: number;
  jpegQuality?: number;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const provider = options.visionProvider ?? new MockProvider();
  const eventBus = options.eventBus ?? new EventBus();
  const memoryCache = new Map<string, SurfaceResult>();
  const surfaceCache = options.surfaceCache;

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/v1/events", { websocket: true }, (socket) => {
    const unsubscribe = eventBus.subscribe((event) => socket.send(JSON.stringify(event)));
    socket.on("close", unsubscribe);
  });

  app.get("/health", async () => ({ ok: true, provider: options.provider, targetLanguage: options.targetLanguage }));

  app.post<{ Body: { task: SurfaceTask } }>("/v1/surfaces/submit", async (request) => {
    const started = Date.now();
    const task = request.body.task;
    eventBus.publish({ type: "job.queued", surfaceId: task.surfaceId });
    try {
      const { buffer: imageBuffer } = await readTaskImage(task);
      const imageHash = sha256Hex(imageBuffer);
      const normalized = await normalizeForProvider(imageBuffer, { maxLongEdge: options.maxImageLongEdge ?? 1600, jpegQuality: Math.round((options.jpegQuality ?? 0.75) * 100) });
      const cacheKey = buildCacheKey({ imageHash, targetLanguage: task.targetLanguage, providerProfile: provider.profile, layoutVersion: LAYOUT_VERSION });
      const cached = surfaceCache?.get(cacheKey) ?? memoryCache.get(cacheKey);
      if (cached) {
        const cachedForSurface: SurfaceResult = { ...cached, surfaceId: task.surfaceId, status: "cached" };
        eventBus.publish({ type: "job.cached", surfaceId: task.surfaceId, result: cachedForSurface });
        return { ok: true, surfaceId: task.surfaceId, status: "cached", result: cachedForSurface };
      }

      eventBus.publish({ type: "job.processing", surfaceId: task.surfaceId });
      const regions = await provider.process({ task, imageBuffer: normalized.buffer, imageHash, width: normalized.width, height: normalized.height });
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
      eventBus.publish({ type: "job.completed", surfaceId: task.surfaceId, result });
      return { ok: true, surfaceId: task.surfaceId, status: result.status, result };
    } catch (error) {
      const failed = { surfaceId: task.surfaceId, status: "failed" as const, recoverable: true, error: error instanceof Error ? error.message : String(error) };
      eventBus.publish({ type: "job.failed", surfaceId: task.surfaceId, result: failed });
      return { ok: false, error: failed.error, result: failed };
    }
  });

  return app;
}

