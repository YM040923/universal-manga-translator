import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { SaveManualOverrideRequest, SurfaceResult, SurfaceTask } from "@umt/shared";
import { buildCacheKey, sha256Hex } from "@umt/shared/hashing";
import type { ManualOverrideStore } from "../cache/manual-overrides.js";
import { applyManualOverrides } from "../cache/manual-overrides.js";
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
  manualOverrideStore?: ManualOverrideStore;
  eventBus?: EventBus;
  maxImageLongEdge?: number;
  jpegQuality?: number;
  openAICompatibleBaseUrl?: string;
  openAIModel?: string;
  openAIApiKeyConfigured?: boolean;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const provider = options.visionProvider ?? new MockProvider();
  const eventBus = options.eventBus ?? new EventBus();
  const memoryCache = new Map<string, SurfaceResult>();
  const surfaceCache = options.surfaceCache;
  const manualOverrideStore = options.manualOverrideStore;

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/v1/events", { websocket: true }, (socket) => {
    const unsubscribe = eventBus.subscribe((event) => socket.send(JSON.stringify(event)));
    socket.on("close", unsubscribe);
  });

  app.get("/health", async () => ({ ok: true, provider: options.provider, targetLanguage: options.targetLanguage }));

  app.get("/v1/config/status", async () => ({
    ok: true,
    provider: options.provider,
    targetLanguage: options.targetLanguage,
    providerProfile: provider.profile,
    openAICompatible: {
      baseUrl: options.openAICompatibleBaseUrl ?? "",
      model: options.openAIModel ?? "",
      apiKeyConfigured: Boolean(options.openAIApiKeyConfigured),
    },
  }));

  app.post<{ Body: SaveManualOverrideRequest }>("/v1/overrides", async (request) => {
    const override = request.body;
    manualOverrideStore?.save(override);
    return { ok: true, override };
  });

  app.get<{ Querystring: { imageHash?: string; targetLanguage?: string } }>("/v1/overrides", async (request) => {
    const imageHash = request.query.imageHash ?? "";
    const targetLanguage = request.query.targetLanguage ?? options.targetLanguage;
    return { ok: true, overrides: manualOverrideStore?.listForImage(imageHash, targetLanguage) ?? [] };
  });

  app.get("/v1/cache/stats", async () => {
    const stats = surfaceCache?.stats() ?? { entries: memoryCache.size, bytes: 0, updatedAt: null };
    return { ok: true, stats };
  });

  app.post("/v1/cache/clear", async () => {
    const persistent = surfaceCache?.clear().deleted ?? 0;
    const memory = memoryCache.size;
    memoryCache.clear();
    return { ok: true, deleted: surfaceCache ? persistent : memory };
  });

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
        const result = applyStoredOverrides(cachedForSurface, task.targetLanguage, manualOverrideStore);
        eventBus.publish({ type: "job.cached", surfaceId: task.surfaceId, result });
        return { ok: true, surfaceId: task.surfaceId, status: "cached", result };
      }

      eventBus.publish({ type: "job.processing", surfaceId: task.surfaceId });
      const regions = await provider.process({ task, imageBuffer: normalized.buffer, imageHash, width: normalized.width, height: normalized.height });
      const rawResult: SurfaceResult = {
        surfaceId: task.surfaceId,
        imageHash,
        status: regions.length ? "completed" : "empty",
        regions: layoutRegions(regions),
        providerProfile: provider.profile,
        layoutVersion: LAYOUT_VERSION,
        elapsedMs: Date.now() - started,
      };
      memoryCache.set(cacheKey, rawResult);
      surfaceCache?.save(cacheKey, rawResult);
      const result = applyStoredOverrides(rawResult, task.targetLanguage, manualOverrideStore);
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

function applyStoredOverrides(result: SurfaceResult, targetLanguage: string, manualOverrideStore?: ManualOverrideStore): SurfaceResult {
  return manualOverrideStore ? applyManualOverrides(result, manualOverrideStore.listForImage(result.imageHash, targetLanguage)) : result;
}
