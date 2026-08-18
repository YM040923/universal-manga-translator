import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { CancelledResult, SaveManualOverrideRequest, SurfaceResult, SurfaceTask, TextRegion, UpdateConfigRequest } from "@umt/shared";

/** Rejects decompression-bomb images whose decoded dimensions are absurd. */
export const MAX_IMAGE_DIMENSION = 12000;
import { clampRectToBounds } from "@umt/shared/geometry";
import { buildCacheKey, sha256Hex } from "@umt/shared/hashing";
import { isAllowedRequestOrigin, isAllowedServerHost } from "./origin-policy.js";
import type { ManualOverrideStore } from "../cache/manual-overrides.js";
import { applyManualOverrides } from "../cache/manual-overrides.js";
import type { OcrCache } from "../cache/ocr-cache.js";
import type { SurfaceCache } from "../cache/surface-cache.js";
import { readTaskImage } from "../image/image-input.js";
import { normalizeForProvider } from "../image/normalize.js";
import sharp from "sharp";
import { LAYOUT_VERSION, layoutRegions } from "../layout/layout.js";
import type { VisionProvider } from "../providers/provider.js";
import type { ApiKeyPoolStatus } from "@umt/core";
import { NullDiagnosticsWriter, type DiagnosticsWriter } from "./diagnostics.js";
import { EventBus } from "./events.js";
import { createSelfTestTask, type SelfTestReport, type SelfTestStep } from "./self-test.js";

export interface BuildServerOptions {
  provider: string;
  targetLanguage: string;
  visionProvider: VisionProvider;
  surfaceCache?: SurfaceCache;
  ocrCache?: OcrCache;
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
  openAIImageInputFormat?: "image-url" | "image-field" | undefined;
  ocrProvider?: string | undefined;
  ocrApiKeyConfigured?: boolean | undefined;
  ocrKeyStatus?: ApiKeyPoolStatus | undefined;
  ocrApiUrl?: string | undefined;
  ocrEndpoint?: string | undefined;
  ocrLanguageType?: string | undefined;
  localOcrUrl?: string | undefined;
  localOcrEngine?: string | undefined;
  ocrInputMode?: "image_base64" | "file" | undefined;
  ocrInput?: "image_base64" | "file" | undefined;
  ocrImageField?: string | undefined;
  ocrStaticFields?: Record<string, unknown> | undefined;
  ocrRegionsPaths?: string[] | undefined;
  ocrTextPaths?: string[] | undefined;
  ocrBoxPaths?: string[] | undefined;
  ocrConfidencePaths?: string[] | undefined;
  ocrNeedLocation?: boolean | undefined;
  ocrEnableCls?: boolean | undefined;
  configWritable?: boolean | undefined;
  updateConfig?: (patch: UpdateConfigRequest) => Promise<RuntimeServerState>;
  /** Maximum concurrent OCR+LLM submissions before new ones wait. */
  maxConcurrentSubmissions?: number;
}

export interface RuntimeServerState {
  provider: string;
  targetLanguage: string;
  visionProvider: VisionProvider;
  maxImageLongEdge: number | undefined;
  jpegQuality: number | undefined;
  openAICompatibleBaseUrl: string | undefined;
  openAIModel: string | undefined;
  openAIApiKeyConfigured: boolean | undefined;
  openAIImageInputFormat?: "image-url" | "image-field" | undefined;
  ocrProvider?: string | undefined;
  ocrApiKeyConfigured?: boolean | undefined;
  ocrKeyStatus?: ApiKeyPoolStatus | undefined;
  ocrApiUrl?: string | undefined;
  ocrEndpoint?: string | undefined;
  ocrLanguageType?: string | undefined;
  localOcrUrl?: string | undefined;
  localOcrEngine?: string | undefined;
  ocrInputMode?: "image_base64" | "file" | undefined;
  ocrInput?: "image_base64" | "file" | undefined;
  ocrImageField?: string | undefined;
  ocrStaticFields?: Record<string, unknown> | undefined;
  ocrRegionsPaths?: string[] | undefined;
  ocrTextPaths?: string[] | undefined;
  ocrBoxPaths?: string[] | undefined;
  ocrConfidencePaths?: string[] | undefined;
  ocrNeedLocation?: boolean | undefined;
  ocrEnableCls?: boolean | undefined;
  configWritable?: boolean | undefined;
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
  let provider: VisionProvider = options.visionProvider;
  let state: RuntimeServerState = {
    provider: options.provider,
    targetLanguage: options.targetLanguage,
    visionProvider: provider,
    maxImageLongEdge: options.maxImageLongEdge,
    jpegQuality: options.jpegQuality,
    openAICompatibleBaseUrl: options.openAICompatibleBaseUrl,
    openAIModel: options.openAIModel,
    openAIApiKeyConfigured: options.openAIApiKeyConfigured,
    openAIImageInputFormat: options.openAIImageInputFormat,
    ocrProvider: options.ocrProvider,
    ocrApiKeyConfigured: options.ocrApiKeyConfigured,
    ocrKeyStatus: options.ocrKeyStatus,
    ocrApiUrl: options.ocrApiUrl ?? options.ocrEndpoint,
    ocrEndpoint: options.ocrEndpoint ?? options.ocrApiUrl,
    ocrLanguageType: options.ocrLanguageType,
    localOcrUrl: options.localOcrUrl,
    localOcrEngine: options.localOcrEngine,
    ocrInputMode: options.ocrInputMode ?? options.ocrInput,
    ocrInput: options.ocrInput ?? options.ocrInputMode,
    ocrImageField: options.ocrImageField,
    ocrStaticFields: options.ocrStaticFields,
    ocrRegionsPaths: options.ocrRegionsPaths,
    ocrTextPaths: options.ocrTextPaths,
    ocrBoxPaths: options.ocrBoxPaths,
    ocrConfidencePaths: options.ocrConfidencePaths,
    ocrNeedLocation: options.ocrNeedLocation,
    ocrEnableCls: options.ocrEnableCls,
    configWritable: options.configWritable ?? Boolean(options.updateConfig),
  };
  const eventBus = options.eventBus ?? new EventBus();
  const memoryCache = new Map<string, SurfaceResult>();
  const MEMORY_CACHE_LIMIT = 200;
  const memoryCacheGet = (key: string): SurfaceResult | undefined => {
    const value = memoryCache.get(key);
    if (value !== undefined) {
      memoryCache.delete(key);
      memoryCache.set(key, value); // refresh recency
    }
    return value;
  };
  const memoryCacheSet = (key: string, value: SurfaceResult): void => {
    memoryCache.delete(key);
    memoryCache.set(key, value);
    if (memoryCache.size > MEMORY_CACHE_LIMIT) {
      const oldest = memoryCache.keys().next().value;
      if (oldest !== undefined) memoryCache.delete(oldest);
    }
  };
  const surfaceCache = options.surfaceCache;
  const ocrCache = options.ocrCache;
  const manualOverrideStore = options.manualOverrideStore;
  const diagnostics = options.diagnosticsWriter ?? new NullDiagnosticsWriter();
  const cancelledSessions = new Set<string>();
  const cancelledSurfaces = new Set<string>();
  const sessionAbortControllers = new Map<string, AbortController>();
  const inFlightSubmissions = new Map<string, Promise<SurfaceResult>>();
  const submissionSlot = createSubmissionSlotControl(options.maxConcurrentSubmissions ?? 4);
  const acquireSubmissionSlot = (): Promise<void> => submissionSlot.acquire();
  const releaseSubmissionSlot = (): void => submissionSlot.release();

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, isAllowedRequestOrigin(origin ?? undefined));
    },
  });
  await app.register(websocket);
  // Defensive rate limiting: legit clients (extension auto-translate) stay far
  // below these ceilings; it only stops scripted abuse from hammering paid
  // OCR/LLM work.
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });

  // Loopback-only Host header check defeats DNS rebinding and keeps the trust
  // boundary on the local machine regardless of CORS configuration.
  app.addHook("onRequest", async (request, reply) => {
    if (!isAllowedServerHost(request.headers.host)) {
      return reply.code(403).send({ ok: false, error: "Forbidden host" });
    }
  });

  app.get("/v1/events", { websocket: true, config: { rateLimit: false } }, (socket, request) => {
    if (!isAllowedRequestOrigin(request.headers.origin)) {
      socket.close();
      return;
    }
    const unsubscribe = eventBus.subscribe((event) => socket.send(JSON.stringify(event)));
    socket.on("close", unsubscribe);
  });

  app.get("/health", { config: { rateLimit: false } }, async () => ({ ok: true, provider: state.provider, targetLanguage: state.targetLanguage }));

  const currentStatus = () => ({
    ok: true,
    provider: state.provider,
    targetLanguage: state.targetLanguage,
    providerProfile: provider.profile,
    openAICompatible: {
      baseUrl: state.openAICompatibleBaseUrl ?? "",
      model: state.openAIModel ?? "",
      apiKeyConfigured: Boolean(state.openAIApiKeyConfigured),
      imageInputFormat: state.openAIImageInputFormat,
    },
    ocr: {
      provider: state.ocrProvider ?? "none",
      apiKeyConfigured: Boolean(state.ocrApiKeyConfigured),
      keyPool: provider.keyStatus?.() ?? state.ocrKeyStatus,
      apiUrl: state.ocrApiUrl ?? state.ocrEndpoint,
      endpoint: state.ocrEndpoint ?? state.ocrApiUrl,
      languageType: state.ocrLanguageType,
      localUrl: state.localOcrUrl,
      engine: state.localOcrEngine,
      inputMode: state.ocrInputMode ?? state.ocrInput,
      input: state.ocrInput ?? state.ocrInputMode,
      imageField: state.ocrImageField,
      staticFields: state.ocrStaticFields,
      regionsPaths: state.ocrRegionsPaths,
      textPaths: state.ocrTextPaths,
      boxPaths: state.ocrBoxPaths,
      confidencePaths: state.ocrConfidencePaths,
      needLocation: state.ocrNeedLocation,
      enableCls: state.ocrEnableCls,
    },
    image: {
      maxLongEdge: state.maxImageLongEdge ?? 1600,
      jpegQuality: state.jpegQuality ?? 0.75,
    },
    configWritable: Boolean(state.configWritable),
  });

  app.get("/v1/config/status", async () => currentStatus());

  app.get("/v1/models", async () => ({
    ok: true,
    models: provider.listModels ? await provider.listModels() : [provider.profile],
    currentModel: state.openAIModel ?? provider.profile,
  }));

  app.post<{ Body: UpdateConfigRequest }>("/v1/config", async (request) => {
    if (!options.updateConfig) {
      return {
        ok: true,
        status: currentStatus(),
        restarted: false,
        note: "Backend config is loaded from .env at startup; restart the backend process for config changes to take effect.",
      };
    }
    state = await options.updateConfig(request.body ?? {});
    provider = state.visionProvider;
    return {
      ok: true,
      status: currentStatus(),
      restarted: false,
      note: "Backend config updated in the running local service and will be used for new submissions.",
    };
  });

  app.post<{ Body: SaveManualOverrideRequest }>("/v1/overrides", async (request) => {
    const override = request.body;
    manualOverrideStore?.save(override);
    return { ok: true, override };
  });

  app.get<{ Querystring: { imageHash?: string; targetLanguage?: string } }>("/v1/overrides", async (request) => {
    const imageHash = request.query.imageHash ?? "";
    const targetLanguage = request.query.targetLanguage ?? state.targetLanguage;
    return { ok: true, overrides: manualOverrideStore?.listForImage(imageHash, targetLanguage) ?? [] };
  });

  app.get("/v1/cache/stats", async () => {
    const stats = surfaceCache?.stats() ?? { entries: memoryCache.size, bytes: 0, updatedAt: null };
    const ocrStats = ocrCache?.stats();
    return { ok: true, stats, ocrStats };
  });

  app.post("/v1/cache/clear", async () => {
    const persistent = surfaceCache?.clear().deleted ?? 0;
    const ocrDeleted = ocrCache?.clear().deleted ?? 0;
    const memory = memoryCache.size;
    memoryCache.clear();
    return { ok: true, deleted: (surfaceCache ? persistent : memory) + ocrDeleted, surfaceDeleted: surfaceCache ? persistent : memory, ocrDeleted };
  });

  app.get<{ Querystring: { limit?: string } }>("/v1/diagnostics/recent", async (request) => {
    const limit = Number(request.query.limit ?? 20);
    return { ok: true, records: options.diagnosticsReader?.(Number.isFinite(limit) ? limit : 20) ?? [] };
  });

  app.post("/v1/diagnostics/clear", async () => {
    const deleted = options.diagnosticsClearer?.() ?? 0;
    return { ok: true, deleted };
  });

  const processSurface = async (task: SurfaceTask, force = false, jobSessionId?: string) => {
    const started = Date.now();
    const isCancelled = () => Boolean(jobSessionId && cancelledSessions.has(jobSessionId));
    const cancelledResult = (): CancelledResult => ({
      surfaceId: task.surfaceId,
      status: "cancelled",
      recoverable: true,
      error: "cancelled",
    });
    const returnCancelled = () => {
      const result = cancelledResult();
      diagnostics.record({ surfaceId: task.surfaceId, status: "cancelled", providerProfile: provider.profile, inputSource: task.imageData ? "imageData" : "imageUrl", originalSize: task.naturalSize, providerSize: task.naturalSize, rawRegionCount: 0, finalRegionCount: 0, elapsedMs: Date.now() - started, note: "job session cancelled" });
      if (jobSessionId) eventBus.publish({ type: "job.cancelled", surfaceId: task.surfaceId, jobSessionId, result });
      return { ok: false as const, error: result.error, result };
    };
    const sessionEventFields = jobSessionId ? { jobSessionId } : {};
    const sessionController = new AbortController();
    if (jobSessionId) sessionAbortControllers.set(jobSessionId, sessionController);
    eventBus.publish({ type: "job.queued", surfaceId: task.surfaceId, ...sessionEventFields });
    try {
      if (isCancelled() || cancelledSurfaces.has(task.surfaceId)) return returnCancelled();
      const imageReadStarted = Date.now();
      const { buffer: imageBuffer, source: inputSource } = await readTaskImage(task, { signal: sessionController.signal });
      const imageReadMs = Date.now() - imageReadStarted;
      if (isCancelled() || cancelledSurfaces.has(task.surfaceId)) return returnCancelled();
      const imageHash = sha256Hex(imageBuffer);
      const cacheKey = buildCacheKey({ imageHash, targetLanguage: task.targetLanguage, providerProfile: provider.profile, layoutVersion: LAYOUT_VERSION });
      const cached = surfaceCache?.get(cacheKey) ?? memoryCacheGet(cacheKey);
      if (cached && isReusableCachedResult(cached) && !force) {
        if (isCancelled()) return returnCancelled();
        const cachedForSurface: SurfaceResult = { ...cached, surfaceId: task.surfaceId, status: "cached" };
        const result = applyStoredOverrides(cachedForSurface, task.targetLanguage, manualOverrideStore);
        diagnostics.record({ surfaceId: task.surfaceId, status: "cached", providerProfile: provider.profile, inputSource, originalSize: task.naturalSize, providerSize: task.naturalSize, rawRegionCount: cached.regions.length, finalRegionCount: result.regions.length, elapsedMs: Date.now() - started, note: "cache hit" });
        eventBus.publish({ type: "job.cached", surfaceId: task.surfaceId, ...sessionEventFields, result });
        return { ok: true as const, surfaceId: task.surfaceId, status: "cached" as const, result };
      }

      eventBus.publish({ type: "job.processing", surfaceId: task.surfaceId, ...sessionEventFields });
      if (isCancelled()) return returnCancelled();

      // Coalesce concurrent identical submissions (same image + profile):
      // wait for the in-flight run instead of paying a second OCR+LLM bill.
      if (!force) {
        const inFlight = inFlightSubmissions.get(cacheKey);
        if (inFlight) {
          try {
            const raw = await inFlight;
            if (isCancelled() || cancelledSurfaces.has(task.surfaceId)) return returnCancelled();
            const coalesced: SurfaceResult = { ...raw, surfaceId: task.surfaceId, status: "cached" };
            const result = applyStoredOverrides(coalesced, task.targetLanguage, manualOverrideStore);
            diagnostics.record({ surfaceId: task.surfaceId, status: "cached", providerProfile: provider.profile, inputSource, originalSize: task.naturalSize, providerSize: task.naturalSize, rawRegionCount: result.regions.length, finalRegionCount: result.regions.length, elapsedMs: Date.now() - started, note: "coalesced with in-flight submission" });
            eventBus.publish({ type: "job.cached", surfaceId: task.surfaceId, ...sessionEventFields, result });
            return { ok: true as const, surfaceId: task.surfaceId, status: "cached" as const, result };
          } catch {
            // The in-flight run failed; fall through and run our own attempt.
          }
        }
      }

      const run = (async (): Promise<SurfaceResult> => {
        await acquireSubmissionSlot();
        try {
          if (isCancelled() || cancelledSurfaces.has(task.surfaceId)) throw new CancelledRunError();
          const imageMetadataStarted = Date.now();
          const actualImageSize = await readImageSizeFromBuffer(imageBuffer, task.naturalSize);
          const imageMetadataMs = Date.now() - imageMetadataStarted;
          if (actualImageSize.width > MAX_IMAGE_DIMENSION || actualImageSize.height > MAX_IMAGE_DIMENSION) {
            throw new Error(`Image dimensions ${actualImageSize.width}x${actualImageSize.height} exceed the ${MAX_IMAGE_DIMENSION}px limit.`);
          }
          const providerOutput = await processImageForProvider(provider, task, imageBuffer, imageHash, actualImageSize, {
            maxLongEdge: state.maxImageLongEdge ?? 1600,
            jpegQuality: state.jpegQuality ?? 0.75,
            forceRetranslate: force,
            signal: sessionController.signal,
          });
          if (isCancelled() || cancelledSurfaces.has(task.surfaceId)) throw new CancelledRunError();
          const providerRegions = providerOutput.regions;
          const regions = clampProviderRegionsToImage(providerRegions, task.naturalSize);
          const layoutStarted = Date.now();
          const laidOutRegions = layoutRegions(regions);
          const layoutMs = Date.now() - layoutStarted;
          const rawResult: SurfaceResult = {
            surfaceId: task.surfaceId,
            imageHash,
            status: regions.length ? "completed" : "empty",
            regions: laidOutRegions,
            providerProfile: provider.profile,
            layoutVersion: LAYOUT_VERSION,
            elapsedMs: Date.now() - started,
          };
          const cacheWriteStarted = Date.now();
          if (rawResult.status === "completed" && rawResult.regions.length > 0) {
            memoryCacheSet(cacheKey, rawResult);
            surfaceCache?.save(cacheKey, rawResult);
          }
          const cacheWriteMs = Date.now() - cacheWriteStarted;
          diagnostics.record({ surfaceId: task.surfaceId, status: rawResult.status, providerProfile: provider.profile, inputSource, originalSize: task.naturalSize, providerSize: providerOutput.providerSize, rawRegionCount: providerRegions.length, finalRegionCount: regions.length, filteredRegionCount: Math.max(0, providerRegions.length - regions.length), elapsedMs: rawResult.elapsedMs, imageReadMs, imageMetadataMs, normalizeMs: providerOutput.normalizeMs, providerMs: providerOutput.providerMs, layoutMs, cacheWriteMs, tileCount: providerOutput.tileCount, ...diagnosticOcrNote(provider, diagnosticNoteForResult(providerRegions.length, regions.length, providerOutput.tileCount).note) });
          return rawResult;
        } finally {
          releaseSubmissionSlot();
        }
      })();
      if (!force) inFlightSubmissions.set(cacheKey, run);
      let rawResult: SurfaceResult;
      try {
        rawResult = await run;
      } catch (error) {
        if (error instanceof CancelledRunError) return returnCancelled();
        throw error;
      } finally {
        if (!force && inFlightSubmissions.get(cacheKey) === run) inFlightSubmissions.delete(cacheKey);
      }
      const result = applyStoredOverrides(rawResult, task.targetLanguage, manualOverrideStore);
      eventBus.publish({ type: "job.completed", surfaceId: task.surfaceId, ...sessionEventFields, result });
      return { ok: true as const, surfaceId: task.surfaceId, status: result.status, result };
    } catch (error) {
      if (isCancelled() || (error instanceof Error && error.name === "AbortError")) return returnCancelled();
      const failed = { surfaceId: task.surfaceId, status: "failed" as const, recoverable: true, error: error instanceof Error ? error.message : String(error) };
      diagnostics.record({ surfaceId: task.surfaceId, status: "failed", providerProfile: provider.profile, inputSource: task.imageData ? "imageData" : "imageUrl", originalSize: task.naturalSize, providerSize: task.naturalSize, rawRegionCount: 0, finalRegionCount: 0, elapsedMs: Date.now() - started, note: failed.error });
      eventBus.publish({ type: "job.failed", surfaceId: task.surfaceId, ...sessionEventFields, result: failed });
      return { ok: false as const, error: failed.error, result: failed };
    } finally {
      if (jobSessionId && sessionAbortControllers.get(jobSessionId) === sessionController) sessionAbortControllers.delete(jobSessionId);
    }
  };

  app.post("/v1/self-test", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
    const steps: SelfTestStep[] = [
      { name: "backend", ok: true, detail: "HTTP server is reachable" },
      { name: "provider", ok: true, detail: provider.profile },
    ];
    const submitted = await processSurface(createSelfTestTask(state.targetLanguage), true);
    const result = submitted.result;
    const completedResult = result && "regions" in result ? result : undefined;
    const regionCount = completedResult?.regions.length ?? 0;
    const submitDetail = "status" in submitted ? String(submitted.status) : "error" in submitted ? submitted.error : "unknown error";
    steps.push({ name: "sample-submit", ok: submitted.ok, detail: submitDetail });
    steps.push({ name: "regions", ok: regionCount > 0, detail: `${regionCount} regions` });
    const report: SelfTestReport = {
      ok: true,
      provider: state.provider,
      providerProfile: provider.profile,
      targetLanguage: state.targetLanguage,
      steps,
      sample: {
        status: completedResult?.status ?? "failed",
        regionCount,
        elapsedMs: completedResult?.elapsedMs ?? 0,
      },
    };
    return report;
  });

  app.post<{ Body: { task: SurfaceTask; jobSessionId?: string } }>("/v1/surfaces/submit", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request) => {
    return processSurface(request.body.task, false, request.body.jobSessionId);
  });

  app.post<{ Body: { task: SurfaceTask; jobSessionId?: string } }>("/v1/surfaces/retranslate", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request) => {
    return processSurface(request.body.task, true, request.body.jobSessionId);
  });

  app.post<{ Body: { surfaceId: string } }>("/v1/surfaces/cancel", async (request) => {
    const surfaceId = String(request.body?.surfaceId ?? "");
    if (surfaceId) cancelledSurfaces.add(surfaceId);
    return { ok: true, surfaceId, status: "accepted", cancellable: true };
  });

  app.post<{ Body: { jobSessionId: string } }>("/v1/jobs/cancel-session", async (request) => {
    const jobSessionId = String(request.body?.jobSessionId ?? "");
    if (jobSessionId) {
      cancelledSessions.add(jobSessionId);
      // Abort in-flight OCR/LLM calls for this session so the user is not billed
      // for work they explicitly cancelled.
      sessionAbortControllers.get(jobSessionId)?.abort();
    }
    return { ok: true, jobSessionId, status: "cancelled", cancellable: true };
  });

  return app;
}

function applyStoredOverrides(result: SurfaceResult, targetLanguage: string, manualOverrideStore?: ManualOverrideStore): SurfaceResult {
  return manualOverrideStore ? applyManualOverrides(result, manualOverrideStore.listForImage(result.imageHash, targetLanguage)) : result;
}

class CancelledRunError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledRunError";
  }
}

export interface SubmissionSlotControl {
  acquire(): Promise<void>;
  release(): void;
}

export function createSubmissionSlotControl(maxConcurrent: number): SubmissionSlotControl {
  const max = Math.max(1, Math.min(16, maxConcurrent));
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (active < max) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      active += 1;
    },
    release(): void {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    },
  };
}

interface ProviderImageOutput {
  regions: TextRegion[];
  providerSize: { width: number; height: number };
  tileCount: number;
  normalizeMs: number;
  providerMs: number;
}

async function readImageSizeFromBuffer(imageBuffer: Buffer, fallback: { width: number; height: number }): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;
    return typeof width === "number" && width > 0 && typeof height === "number" && height > 0 ? { width, height } : fallback;
  } catch {
    return fallback;
  }
}

async function processImageForProvider(provider: VisionProvider, task: SurfaceTask, imageBuffer: Buffer, imageHash: string, actualImageSize: { width: number; height: number }, options: { maxLongEdge: number; jpegQuality: number; forceRetranslate?: boolean; signal?: AbortSignal }): Promise<ProviderImageOutput> {
  if (!shouldTileTallImage(actualImageSize)) {
    const normalizeStarted = Date.now();
    const normalized = await normalizeForProvider(imageBuffer, { maxLongEdge: options.maxLongEdge, jpegQuality: Math.round(options.jpegQuality * 100) });
    const normalizeMs = Date.now() - normalizeStarted;
    const providerStarted = Date.now();
    const providerRegions = await provider.process({
      task,
      imageBuffer: normalized.buffer,
      imageHash,
      width: normalized.width,
      height: normalized.height,
      forceRetranslate: options.forceRetranslate === true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const providerMs = Date.now() - providerStarted;
    return {
      regions: mapProviderRegionsToOriginalImage(
        mapProviderRegionsToOriginalImage(providerRegions, actualImageSize, { width: normalized.width, height: normalized.height }),
        task.naturalSize,
        actualImageSize,
      ),
      providerSize: { width: normalized.width, height: normalized.height },
      tileCount: 1,
      normalizeMs,
      providerMs,
    };
  }

  const tileHeight = Math.max(800, Math.min(1600, options.maxLongEdge));
  const overlap = 80;
  const regions: TextRegion[] = [];
  let tileCount = 0;
  let normalizeMs = 0;
  let providerMs = 0;
  for (let top = 0; top < actualImageSize.height; top += tileHeight - overlap) {
    const height = Math.min(tileHeight, actualImageSize.height - top);
    if (height < 80) break;
    tileCount += 1;
    const normalizeStarted = Date.now();
    const tileBuffer = await sharp(imageBuffer)
      .extract({ left: 0, top, width: actualImageSize.width, height })
      .jpeg({ quality: Math.round(options.jpegQuality * 100) })
      .toBuffer();
    normalizeMs += Date.now() - normalizeStarted;
    const tileTask: SurfaceTask = {
      ...task,
      surfaceId: `${task.surfaceId}:tile:${tileCount}`,
      naturalSize: { width: actualImageSize.width, height },
      renderSize: { width: task.renderSize.width, height: Math.round((height / actualImageSize.height) * task.renderSize.height) },
      surfaceRect: { ...task.surfaceRect, height: Math.round((height / actualImageSize.height) * task.surfaceRect.height) },
    };
    const providerStarted = Date.now();
    const tileRegions = await provider.process({
      task: tileTask,
      imageBuffer: tileBuffer,
      imageHash: `${imageHash}:tile:${tileCount}`,
      width: actualImageSize.width,
      height,
      forceRetranslate: options.forceRetranslate === true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    providerMs += Date.now() - providerStarted;
    regions.push(...tileRegions.map((region) => ({
      ...region,
      id: `${region.id}:t${tileCount}`,
      box: { ...region.box, y: region.box.y + top },
    })));
    if (top + height >= actualImageSize.height) break;
  }
  return {
    regions: mapProviderRegionsToOriginalImage(dedupeOverlappingRegions(regions), task.naturalSize, actualImageSize),
    providerSize: { width: actualImageSize.width, height: tileHeight },
    tileCount,
    normalizeMs,
    providerMs,
  };
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


function diagnosticOcrNote(provider: VisionProvider, base?: string): { note?: string } {
  const cacheStatus = (provider as unknown as { lastOcrCacheStatus?: unknown }).lastOcrCacheStatus;
  const status = typeof cacheStatus === "string" ? `ocr-cache-${cacheStatus}` : "";
  const keyStatus = provider.keyStatus?.();
  const keyText = keyStatus ? `keys:${keyStatus.available}/${keyStatus.count}` : "";
  return joinDiagnosticNotes(base, status, keyText);
}

function joinDiagnosticNotes(...notes: Array<string | undefined>): { note?: string } {
  const joined = notes.filter((note): note is string => Boolean(note)).join(" | ");
  return joined ? { note: joined } : {};
}
