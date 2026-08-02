import {
  GenericNetworkOcrClient,
  OpenAICompatibleTextTranslator,
  OcrTranslatePipeline,
  planRecognitionUnits,
  type CorePreCroppedOcrInput,
  type RecognitionPlan,
} from "@umt/core";
import type {
  ApiResponse,
  AvailableModelsResponse,
  CacheStatsResponse,
  CancelJobSessionResponse,
  CancelSurfaceResponse,
  ClearCacheResponse,
  ClearDiagnosticsResponse,
  ConfigStatusResponse,
  ManualOverridePayload,
  SaveManualOverrideResponse,
  SubmitSurfaceResponse,
} from "@umt/shared/protocol";
import type { SurfaceResult, SurfaceTask } from "@umt/shared/types";
import type { ExtensionSettings } from "../../settings/settings.js";
import { directHttpUrlPolicyError } from "../messages.js";
import { DirectOcrCache } from "../cache/direct-ocr-cache.js";
import { ExtensionManualOverrideStore, type ManualOverrideStorage } from "../cache/manual-overrides.js";
import type { DiagnosticsResponse, SelfTestResponse } from "./backend-client.js";
import { ChapterTranslationMemory } from "./chapter-memory.js";
import { directOcrConfigHash, effectiveGlossary, effectiveGlossaryHash } from "./direct-config.js";
import { createExtensionProxyFetch } from "./extension-proxy-fetch.js";
import { dataUrlToBytes, parseStaticFields, sha256Hex } from "./direct-image-utils.js";
import { toOverlayRegion } from "./direct-overlay-region.js";
import type { TranslatorClient } from "./translator-client.js";
import { cropRecognitionTiles, type RecognitionTileCropper } from "../capture/recognition-tile-cropper.js";

type FetchLike = typeof fetch;
const TRANSLATION_STYLE_VERSION = "manga-v2";
export const DIRECT_OCR_TILE_HEIGHT_THRESHOLD = 7200;
export const DIRECT_OCR_MAX_TILE_HEIGHT = 4096;
export const DIRECT_OCR_TILE_OVERLAP_RATIO = 0.125;
const DIRECT_OCR_TILE_PREPROCESSING_VERSION = "lossless-png-tile-v1";

interface DirectClientSettings extends ExtensionSettings {
  __testFetch?: FetchLike;
  __testOcrCache?: DirectOcrCache;
  __testManualOverrideStorage?: ManualOverrideStorage;
  __testRecognitionTileCropper?: RecognitionTileCropper;
}

export class DirectClient implements TranslatorClient {
  private readonly fetchImpl: FetchLike;
  private readonly ocrCache: DirectOcrCache;
  private readonly manualOverrides: ExtensionManualOverrideStore;
  private readonly ocrClient: GenericNetworkOcrClient;
  private readonly chapterMemory: ChapterTranslationMemory;
  private readonly recognitionTileCropper: RecognitionTileCropper;
  private readonly diagnostics: Array<Record<string, unknown>> = [];

  constructor(private readonly settings: DirectClientSettings) {
    this.fetchImpl = settings.__testFetch ?? createExtensionProxyFetch();
    this.ocrCache = settings.__testOcrCache ?? new DirectOcrCache();
    this.manualOverrides = new ExtensionManualOverrideStore(settings.__testManualOverrideStorage);
    this.ocrClient = this.createOcrClient();
    this.chapterMemory = new ChapterTranslationMemory();
    this.recognitionTileCropper = settings.__testRecognitionTileCropper ?? cropRecognitionTiles;
  }

  async health(): Promise<boolean> {
    return this.isConfigured();
  }

  async configStatus(): Promise<ApiResponse<ConfigStatusResponse>> {
    return {
      ok: true,
      provider: "extension-direct",
      targetLanguage: this.settings.targetLanguage,
      providerProfile: this.providerProfile(),
      openAICompatible: {
        baseUrl: this.settings.directTranslator.baseUrl,
        model: this.settings.directTranslator.model,
        apiKeyConfigured: this.settings.directTranslator.apiKey.length > 0,
      },
      ocr: {
        provider: "direct-network-ocr",
        apiKeyConfigured: this.settings.directOcr.apiKeys.length > 0,
        apiUrl: this.settings.directOcr.apiUrl,
        endpoint: this.settings.directOcr.apiUrl,
        inputMode: this.settings.directOcr.inputMode,
        input: this.settings.directOcr.inputMode,
        imageField: this.settings.directOcr.imageField,
        regionsPaths: this.settings.directOcr.regionsPaths,
        textPaths: this.settings.directOcr.textPaths,
        boxPaths: this.settings.directOcr.boxPaths,
        confidencePaths: this.settings.directOcr.confidencePaths,
        keyPool: this.ocrClient.keyStatus(),
      },
      configWritable: false,
    };
  }

  async models(): Promise<ApiResponse<AvailableModelsResponse>> {
    if (!this.settings.directTranslator.baseUrl || !this.settings.directTranslator.apiKey) {
      return { ok: true, models: [this.settings.directTranslator.model], currentModel: this.settings.directTranslator.model };
    }
    const models = await this.createTranslator().listModels();
    return { ok: true, models, currentModel: this.settings.directTranslator.model };
  }

  async selfTest(): Promise<ApiResponse<SelfTestResponse>> {
    const steps = [
      { name: "ocr-config", ok: Boolean(this.settings.directOcr.apiUrl && this.settings.directOcr.apiKeys.length), detail: this.settings.directOcr.apiUrl ? "OCR API URL configured" : "OCR API URL missing" },
      { name: "translator-config", ok: Boolean(this.settings.directTranslator.baseUrl && this.settings.directTranslator.apiKey && this.settings.directTranslator.model), detail: this.settings.directTranslator.baseUrl ? "Translator API configured" : "Translator API missing" },
    ];
    return {
      ok: true,
      provider: "extension-direct",
      providerProfile: this.providerProfile(),
      targetLanguage: this.settings.targetLanguage,
      steps,
      sample: { status: steps.every((step) => step.ok) ? "ready" : "not-configured", regionCount: 0, elapsedMs: 0 },
    };
  }

  async submit(task: SurfaceTask, _jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>> {
    return this.processTask(task, false);
  }

  async retranslate(task: SurfaceTask, _jobSessionId?: string): Promise<ApiResponse<SubmitSurfaceResponse>> {
    return this.processTask(task, true);
  }

  async cancelSurface(surfaceId: string): Promise<ApiResponse<CancelSurfaceResponse>> {
    return { ok: true, surfaceId, status: "accepted", cancellable: false };
  }

  async cancelJobSession(jobSessionId: string): Promise<ApiResponse<CancelJobSessionResponse>> {
    return { ok: true, jobSessionId, status: "cancelled", cancellable: false };
  }

  async cacheStats(): Promise<ApiResponse<CacheStatsResponse>> {
    return { ok: true, stats: await this.ocrCache.stats() };
  }

  async clearCache(): Promise<ApiResponse<ClearCacheResponse>> {
    return { ok: true, deleted: await this.ocrCache.clearAll() };
  }

  async recentDiagnostics(limit = 10): Promise<ApiResponse<DiagnosticsResponse>> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return { ok: true, records: this.diagnostics.slice(0, safeLimit) };
  }

  async clearDiagnostics(): Promise<ApiResponse<ClearDiagnosticsResponse>> {
    const deleted = this.diagnostics.length;
    this.diagnostics.length = 0;
    return { ok: true, deleted };
  }

  async saveManualOverride(override: ManualOverridePayload): Promise<ApiResponse<SaveManualOverrideResponse>> {
    await this.manualOverrides.save(override);
    this.chapterMemory.applyManualOverride(override);
    return { ok: true, override };
  }

  private async processTask(task: SurfaceTask, retranslate: boolean): Promise<ApiResponse<SubmitSurfaceResponse>> {
    try {
      if (!task.imageData) return { ok: false, error: "Direct plugin mode imageData is required. Enable extension image-data capture or use backend mode for imageUrl fallback." };
      if (!this.isConfigured()) return { ok: false, error: "Direct plugin mode is not configured. Please set OCR API URL/key and translator API URL/key/model." };
      const urlPolicyError = this.urlPolicyError();
      if (urlPolicyError) return { ok: false, error: urlPolicyError };
      const startedAt = Date.now();
      const imageBytes = dataUrlToBytes(task.imageData);
      const imageHash = await sha256Hex(imageBytes);
      const previousTranslations = this.chapterMemory.previousTranslationsFor(imageHash);
      const chapterContext = this.chapterMemory.chapterContextFor(imageHash);
      const termCandidates = this.chapterMemory.termCandidatesFor(imageHash);
      const recognitionPlan = this.createRecognitionPlan(task);
      const preCroppedOcrInputs = recognitionPlan.units.length > 1
        ? await this.createPreCroppedOcrInputs(task.imageData, recognitionPlan)
        : undefined;
      this.recordRecognitionPlan(task, recognitionPlan);
      const pipeline = new OcrTranslatePipeline({
        profile: this.providerProfile(),
        ocr: this.ocrClient,
        translator: this.createTranslator(),
        ocrCache: this.ocrCache,
      });
      const result = await pipeline.process({
        imageBytes,
        imageHash,
        width: task.naturalSize.width,
        height: task.naturalSize.height,
        targetLanguage: task.targetLanguage,
        sourceLanguage: task.sourceLanguage,
        retranslate,
        glossary: effectiveGlossary(this.settings),
        chapterContext,
        previousTranslations,
        termCandidates,
        ...(preCroppedOcrInputs ? { preCroppedOcrInputs } : {}),
      });
      const regions = result.regions.map((region) => toOverlayRegion(region));
      const rawSurfaceResult: SurfaceResult = {
        surfaceId: task.surfaceId,
        imageHash,
        status: regions.length > 0 ? "completed" : "empty",
        regions,
        providerProfile: this.providerProfile(),
        layoutVersion: 1,
        elapsedMs: Date.now() - startedAt,
      };
      const surfaceResult = await this.manualOverrides.applyToResult(rawSurfaceResult, task.targetLanguage);
      this.chapterMemory.remember(imageHash, surfaceResult);
      return { ok: true, surfaceId: task.surfaceId, status: surfaceResult.status, result: surfaceResult };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private createOcrClient(): GenericNetworkOcrClient {
    return new GenericNetworkOcrClient({
      endpoint: this.settings.directOcr.apiUrl,
      apiKeys: this.settings.directOcr.apiKeys,
      inputMode: this.settings.directOcr.inputMode,
      imageFieldName: this.settings.directOcr.imageField,
      staticFields: parseStaticFields(this.settings.directOcr.staticFieldsText),
      regionsPathCandidates: this.settings.directOcr.regionsPaths,
      textPathCandidates: this.settings.directOcr.textPaths,
      boxPathCandidates: this.settings.directOcr.boxPaths,
      confidencePathCandidates: this.settings.directOcr.confidencePaths,
      attempts: Math.max(1, Math.min(5, this.settings.retryCount + 1)),
      fetch: this.fetchImpl,
    });
  }

  private createRecognitionPlan(task: SurfaceTask): RecognitionPlan {
    const fullImagePlan = () => planRecognitionUnits({
      surfaceId: task.surfaceId,
      naturalSize: task.naturalSize,
      maxTileHeight: task.naturalSize.height,
      overlapRatio: 0,
      reason: "automatic",
      preprocessingVersion: "none-v1",
    });
    const maxOcrCalls = Math.max(1, Math.trunc(this.settings.directOcr.maxAutoOcrPages));
    if (task.naturalSize.height <= DIRECT_OCR_TILE_HEIGHT_THRESHOLD || maxOcrCalls === 1) return fullImagePlan();

    let minimumTileHeight = DIRECT_OCR_MAX_TILE_HEIGHT;
    let maximumTileHeight = task.naturalSize.height;
    let plan = this.planRecognitionUnits(task, minimumTileHeight);
    if (plan.units.length <= maxOcrCalls) return plan;

    while (minimumTileHeight < maximumTileHeight) {
      const candidateHeight = Math.floor((minimumTileHeight + maximumTileHeight) / 2);
      const candidate = this.planRecognitionUnits(task, candidateHeight);
      if (candidate.units.length > maxOcrCalls) minimumTileHeight = candidateHeight + 1;
      else {
        plan = candidate;
        maximumTileHeight = candidateHeight;
      }
    }
    return plan.units.length <= maxOcrCalls ? plan : fullImagePlan();
  }

  private planRecognitionUnits(task: SurfaceTask, maxTileHeight: number): RecognitionPlan {
    return planRecognitionUnits({
      surfaceId: task.surfaceId,
      naturalSize: task.naturalSize,
      maxTileHeight,
      overlapRatio: DIRECT_OCR_TILE_OVERLAP_RATIO,
      reason: "automatic",
      preprocessingVersion: DIRECT_OCR_TILE_PREPROCESSING_VERSION,
    });
  }

  private async createPreCroppedOcrInputs(imageData: string, plan: RecognitionPlan): Promise<CorePreCroppedOcrInput[]> {
    const tiles = await this.recognitionTileCropper(imageData, plan.units);
    return tiles.map((tile, index) => ({
      imageBytes: tile.imageBytes,
      fileName: `recognition-tile-${index + 1}.png`,
      mimeType: tile.mimeType,
      recognitionUnit: tile.unit,
    }));
  }

  private recordRecognitionPlan(task: SurfaceTask, plan: RecognitionPlan): void {
    this.diagnostics.unshift({
      type: "recognition-tiling",
      surfaceId: task.surfaceId,
      naturalSize: { ...task.naturalSize },
      tileCount: plan.units.length,
      overlapPx: plan.overlapPx,
      crops: plan.units.map((unit) => ({ ...unit.crop })),
    });
    if (this.diagnostics.length > 100) this.diagnostics.length = 100;
  }

  private createTranslator(): OpenAICompatibleTextTranslator {
    return new OpenAICompatibleTextTranslator({
      baseUrl: this.settings.directTranslator.baseUrl,
      apiKey: this.settings.directTranslator.apiKey,
      model: this.settings.directTranslator.model,
      fetch: this.fetchImpl,
    });
  }

  private isConfigured(): boolean {
    return Boolean(this.settings.directOcr.apiUrl && this.settings.directOcr.apiKeys.length && this.settings.directTranslator.baseUrl && this.settings.directTranslator.apiKey && this.settings.directTranslator.model);
  }

  private urlPolicyError(): string {
    const ocrError = directHttpUrlPolicyError(this.settings.directOcr.apiUrl);
    if (ocrError) return `OCR API URL rejected: ${ocrError}`;
    const translatorError = directHttpUrlPolicyError(this.settings.directTranslator.baseUrl);
    if (translatorError) return `Translator API URL rejected: ${translatorError}`;
    return "";
  }

  providerProfile(): string {
    return `direct:${this.settings.directOcr.inputMode}:${directOcrConfigHash(this.settings)}+openai-compatible:${this.settings.directTranslator.model}+style:${TRANSLATION_STYLE_VERSION}+${effectiveGlossaryHash(this.settings)}`;
  }
}
