import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { SaveManualOverrideRequest, SurfaceResult, SurfaceTask, TextRegion } from "@umt/shared";
import { clampRectToBounds } from "@umt/shared/geometry";
import { buildCacheKey, sha256Hex } from "@umt/shared/hashing";
import type { ManualOverrideStore } from "../cache/manual-overrides.js";
import { applyManualOverrides } from "../cache/manual-overrides.js";
import type { SurfaceCache } from "../cache/surface-cache.js";
import { readTaskImage } from "../image/image-input.js";
import { normalizeForProvider } from "../image/normalize.js";
import sharp from "sharp";
import { LAYOUT_VERSION, layoutRegions } from "../layout/layout.js";
import { MockProvider } from "../providers/mock-provider.js";
import type { VisionProvider } from "../providers/provider.js";
import { NullDiagnosticsWriter, type DiagnosticsWriter } from "./diagnostics.js";
import { EventBus } from "./events.js";
import { createSelfTestTask, type SelfTestReport, type SelfTestStep } from "./self-test.js";

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
  diagnosticsWriter?: DiagnosticsWriter;
  diagnosticsReader?: (limit: number) => Array<Record<string, unknown>>;
  diagnosticsClearer?: () => number;
  openAIImageInputFormat?: "image-url" | "image-field";
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const provider: VisionProvider = options.visionProvider ?? new MockProvider();
  const eventBus = options.eventBus ?? new EventBus();
  const memoryCache = new Map<string, SurfaceResult>();
  const surfaceCache = options.surfaceCache;
  const manualOverrideStore = options.manualOverrideStore;
  const diagnostics = options.diagnosticsWriter ?? new NullDiagnosticsWriter();

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
      imageInputFormat: options.openAIImageInputFormat,
    },
    image: {
      maxLongEdge: options.maxImageLongEdge ?? 1600,
      jpegQuality: options.jpegQuality ?? 0.75,
    },
    configWritable: false,
  }));

  app.get("/v1/models", async () => ({
    ok: true,
    models: provider.listModels ? await provider.listModels() : [provider.profile],
    currentModel: options.openAIModel ?? provider.profile,
  }));

  app.post("/v1/config", async () => ({
    ok: true,
    status: {
      ok: true,
      provider: options.provider,
      targetLanguage: options.targetLanguage,
      providerProfile: provider.profile,
      openAICompatible: {
        baseUrl: options.openAICompatibleBaseUrl ?? "",
        model: options.openAIModel ?? "",
        apiKeyConfigured: Boolean(options.openAIApiKeyConfigured),
        imageInputFormat: options.openAIImageInputFormat,
      },
      image: {
        maxLongEdge: options.maxImageLongEdge ?? 1600,
        jpegQuality: options.jpegQuality ?? 0.75,
      },
      configWritable: false,
    },
    restarted: false,
    note: "Backend config is loaded from .env at startup; restart the backend process for config changes to take effect.",
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

  app.get<{ Querystring: { limit?: string } }>("/v1/diagnostics/recent", async (request) => {
    const limit = Number(request.query.limit ?? 20);
    return { ok: true, records: options.diagnosticsReader?.(Number.isFinite(limit) ? limit : 20) ?? [] };
  });

  app.post("/v1/diagnostics/clear", async () => {
    const deleted = options.diagnosticsClearer?.() ?? 0;
    return { ok: true, deleted };
  });

  const processSurface = async (task: SurfaceTask, force = false) => {
    const started = Date.now();
    eventBus.publish({ type: "job.queued", surfaceId: task.surfaceId });
    try {
      const { buffer: imageBuffer, source: inputSource } = await readTaskImage(task);
      const imageHash = sha256Hex(imageBuffer);
      const cacheKey = buildCacheKey({ imageHash, targetLanguage: task.targetLanguage, providerProfile: provider.profile, layoutVersion: LAYOUT_VERSION });
      const cached = surfaceCache?.get(cacheKey) ?? memoryCache.get(cacheKey);
      if (cached && isReusableCachedResult(cached) && !force) {
        const cachedForSurface: SurfaceResult = { ...cached, surfaceId: task.surfaceId, status: "cached" };
        const result = applyStoredOverrides(cachedForSurface, task.targetLanguage, manualOverrideStore);
        diagnostics.record({ surfaceId: task.surfaceId, status: "cached", providerProfile: provider.profile, inputSource, originalSize: task.naturalSize, providerSize: task.naturalSize, rawRegionCount: cached.regions.length, finalRegionCount: result.regions.length, elapsedMs: Date.now() - started, note: "cache hit" });
        eventBus.publish({ type: "job.cached", surfaceId: task.surfaceId, result });
        return { ok: true, surfaceId: task.surfaceId, status: "cached", result };
      }

      eventBus.publish({ type: "job.processing", surfaceId: task.surfaceId });
      const providerOutput = await processImageForProvider(provider, task, imageBuffer, imageHash, {
        maxLongEdge: options.maxImageLongEdge ?? 1600,
        jpegQuality: options.jpegQuality ?? 0.75,
      });
      const providerRegions = providerOutput.regions;
      const mappedRegions = providerRegions;
      const regions = clampProviderRegionsToImage(mappedRegions, task.naturalSize);
      const rawResult: SurfaceResult = {
        surfaceId: task.surfaceId,
        imageHash,
        status: regions.length ? "completed" : "empty",
        regions: layoutRegions(regions),
        providerProfile: provider.profile,
        layoutVersion: LAYOUT_VERSION,
        elapsedMs: Date.now() - started,
      };
      if (rawResult.status === "completed" && rawResult.regions.length > 0) {
        memoryCache.set(cacheKey, rawResult);
        surfaceCache?.save(cacheKey, rawResult);
      }
      const result = applyStoredOverrides(rawResult, task.targetLanguage, manualOverrideStore);
      diagnostics.record({ surfaceId: task.surfaceId, status: result.status, providerProfile: provider.profile, inputSource, originalSize: task.naturalSize, providerSize: providerOutput.providerSize, rawRegionCount: providerRegions.length, finalRegionCount: result.regions.length, filteredRegionCount: Math.max(0, providerRegions.length - regions.length), elapsedMs: rawResult.elapsedMs, ...diagnosticNoteForResult(providerRegions.length, regions.length, providerOutput.tileCount) });
      eventBus.publish({ type: "job.completed", surfaceId: task.surfaceId, result });
      return { ok: true, surfaceId: task.surfaceId, status: result.status, result };
    } catch (error) {
      const failed = { surfaceId: task.surfaceId, status: "failed" as const, recoverable: true, error: error instanceof Error ? error.message : String(error) };
      diagnostics.record({ surfaceId: task.surfaceId, status: "failed", providerProfile: provider.profile, inputSource: task.imageData ? "imageData" : "imageUrl", originalSize: task.naturalSize, providerSize: task.naturalSize, rawRegionCount: 0, finalRegionCount: 0, elapsedMs: Date.now() - started, note: failed.error });
      eventBus.publish({ type: "job.failed", surfaceId: task.surfaceId, result: failed });
      return { ok: false, error: failed.error, result: failed };
    }
  };

  app.post("/v1/self-test", async () => {
    const steps: SelfTestStep[] = [
      { name: "backend", ok: true, detail: "HTTP server is reachable" },
      { name: "provider", ok: true, detail: provider.profile },
    ];
    const submitted = await processSurface(createSelfTestTask(options.targetLanguage), true);
    const result = submitted.result;
    const completedResult = result && result.status !== "failed" ? result : undefined;
    const regionCount = completedResult?.regions.length ?? 0;
    const submitDetail = submitted.ok ? String(submitted.status) : "error" in submitted ? submitted.error : "unknown error";
    steps.push({ name: "sample-submit", ok: submitted.ok, detail: submitDetail });
    steps.push({ name: "regions", ok: regionCount > 0, detail: `${regionCount} regions` });
    const report: SelfTestReport = {
      ok: true,
      provider: options.provider,
      providerProfile: provider.profile,
      targetLanguage: options.targetLanguage,
      steps,
      sample: {
        status: result?.status ?? "failed",
        regionCount,
        elapsedMs: completedResult?.elapsedMs ?? 0,
      },
    };
    return report;
  });

  app.post<{ Body: { task: SurfaceTask } }>("/v1/surfaces/submit", async (request) => {
    return processSurface(request.body.task);
  });

  app.post<{ Body: { task: SurfaceTask } }>("/v1/surfaces/retranslate", async (request) => {
    return processSurface(request.body.task, true);
  });

  app.post<{ Body: { surfaceId: string } }>("/v1/surfaces/cancel", async (request) => {
    return { ok: true, surfaceId: request.body.surfaceId, status: "accepted", cancellable: false };
  });

  return app;
}

function applyStoredOverrides(result: SurfaceResult, targetLanguage: string, manualOverrideStore?: ManualOverrideStore): SurfaceResult {
  return manualOverrideStore ? applyManualOverrides(result, manualOverrideStore.listForImage(result.imageHash, targetLanguage)) : result;
}

interface ProviderImageOutput {
  regions: TextRegion[];
  providerSize: { width: number; height: number };
  tileCount: number;
}

async function processImageForProvider(provider: VisionProvider, task: SurfaceTask, imageBuffer: Buffer, imageHash: string, options: { maxLongEdge: number; jpegQuality: number }): Promise<ProviderImageOutput> {
  if (!shouldTileTallImage(task.naturalSize)) {
    const normalized = await normalizeForProvider(imageBuffer, { maxLongEdge: options.maxLongEdge, jpegQuality: Math.round(options.jpegQuality * 100) });
    const providerRegions = await provider.process({ task, imageBuffer: normalized.buffer, imageHash, width: normalized.width, height: normalized.height });
    return {
      regions: mapProviderRegionsToOriginalImage(providerRegions, task.naturalSize, { width: normalized.width, height: normalized.height }),
      providerSize: { width: normalized.width, height: normalized.height },
      tileCount: 1,
    };
  }

  const tileHeight = Math.max(800, Math.min(1600, options.maxLongEdge));
  const overlap = 80;
  const regions: TextRegion[] = [];
  let tileCount = 0;
  for (let top = 0; top < task.naturalSize.height; top += tileHeight - overlap) {
    const height = Math.min(tileHeight, task.naturalSize.height - top);
    if (height < 80) break;
    tileCount += 1;
    const tileBuffer = await sharp(imageBuffer)
      .extract({ left: 0, top, width: task.naturalSize.width, height })
      .jpeg({ quality: Math.round(options.jpegQuality * 100) })
      .toBuffer();
    const tileTask: SurfaceTask = {
      ...task,
      surfaceId: `${task.surfaceId}:tile:${tileCount}`,
      naturalSize: { width: task.naturalSize.width, height },
      renderSize: { width: task.renderSize.width, height: Math.round((height / task.naturalSize.height) * task.renderSize.height) },
      surfaceRect: { ...task.surfaceRect, height: Math.round((height / task.naturalSize.height) * task.surfaceRect.height) },
    };
    const tileRegions = await provider.process({ task: tileTask, imageBuffer: tileBuffer, imageHash: `${imageHash}:tile:${tileCount}`, width: task.naturalSize.width, height });
    regions.push(...tileRegions.map((region) => ({
      ...region,
      id: `${region.id}:t${tileCount}`,
      box: { ...region.box, y: region.box.y + top },
    })));
    if (top + height >= task.naturalSize.height) break;
  }
  return { regions: dedupeOverlappingRegions(regions), providerSize: { width: task.naturalSize.width, height: tileHeight }, tileCount };
}

function shouldTileTallImage(size: { width: number; height: number }): boolean {
  return size.height >= 2400 && size.height / Math.max(1, size.width) >= 2.5;
}

function dedupeOverlappingRegions(regions: TextRegion[]): TextRegion[] {
  const kept: TextRegion[] = [];
  for (const region of regions) {
    if (kept.some((existing) => region.sourceText === existing.sourceText && rectIoU(region.box, existing.box) > 0.45)) continue;
    kept.push(region);
  }
  return kept;
}

function rectIoU(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function mapProviderRegionsToOriginalImage<T extends { box: { x: number; y: number; width: number; height: number } }>(regions: T[], originalSize: { width: number; height: number }, providerSize: { width: number; height: number }): T[] {
  const scaleX = originalSize.width / providerSize.width;
  const scaleY = originalSize.height / providerSize.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return regions;
  if (Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001) return regions;
  return regions.map((region) => ({
    ...region,
    box: {
      x: Math.round(region.box.x * scaleX),
      y: Math.round(region.box.y * scaleY),
      width: Math.round(region.box.width * scaleX),
      height: Math.round(region.box.height * scaleY),
    },
  }));
}

function clampProviderRegionsToImage<T extends { box: { x: number; y: number; width: number; height: number } }>(regions: T[], imageSize: { width: number; height: number }): T[] {
  return regions.flatMap((region) => {
    const box = clampRectToBounds(region.box, imageSize);
    return box ? [{ ...region, box }] : [];
  });
}

function diagnosticNoteForResult(rawRegionCount: number, clampedRegionCount: number, tileCount = 1): { note?: string } {
  const tileNote = tileCount > 1 ? `tiled-${tileCount}` : "";
  if (rawRegionCount === 0) return { note: tileNote ? `no-regions-from-provider | ${tileNote}` : "no-regions-from-provider" };
  if (clampedRegionCount === 0) return { note: tileNote ? `all-boxes-filtered | ${tileNote}` : "all-boxes-filtered" };
  if (rawRegionCount > clampedRegionCount) return { note: tileNote ? `some-boxes-filtered | ${tileNote}` : "some-boxes-filtered" };
  if (tileNote) return { note: tileNote };
  return {};
}


function isReusableCachedResult(result: SurfaceResult): boolean {
  return result.status !== "empty" && result.regions.length > 0;
}

