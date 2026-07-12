import { GenericNetworkOcrClient, OpenAICompatibleTextTranslator, OcrTranslatePipeline } from "@umt/core";
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
import type { OverlayRegion, SurfaceResult, SurfaceTask, TextRegion } from "@umt/shared/types";
import type { ExtensionSettings } from "../../settings/settings.js";
import { DirectOcrCache } from "../cache/direct-ocr-cache.js";
import { ExtensionManualOverrideStore, type ManualOverrideStorage } from "../cache/manual-overrides.js";
import type { DiagnosticsResponse, SelfTestResponse } from "./backend-client.js";
import { ChapterTranslationMemory } from "./chapter-memory.js";
import { directOcrConfigHash, effectiveGlossary, effectiveGlossaryHash } from "./direct-config.js";
import { createExtensionProxyFetch } from "./extension-proxy-fetch.js";
import type { TranslatorClient } from "./translator-client.js";

type FetchLike = typeof fetch;
const TRANSLATION_STYLE_VERSION = "manga-v2";

interface DirectClientSettings extends ExtensionSettings {
  __testFetch?: FetchLike;
  __testOcrCache?: DirectOcrCache;
  __testManualOverrideStorage?: ManualOverrideStorage;
}

export class DirectClient implements TranslatorClient {
  private readonly fetchImpl: FetchLike;
  private readonly ocrCache: DirectOcrCache;
  private readonly manualOverrides: ExtensionManualOverrideStore;
  private readonly ocrClient: GenericNetworkOcrClient;
  private readonly chapterMemory: ChapterTranslationMemory;

  constructor(private readonly settings: DirectClientSettings) {
    this.fetchImpl = settings.__testFetch ?? createExtensionProxyFetch();
    this.ocrCache = settings.__testOcrCache ?? new DirectOcrCache();
    this.manualOverrides = new ExtensionManualOverrideStore(settings.__testManualOverrideStorage);
    this.ocrClient = this.createOcrClient();
    this.chapterMemory = new ChapterTranslationMemory();
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

  async recentDiagnostics(): Promise<ApiResponse<DiagnosticsResponse>> {
    return { ok: true, records: [] };
  }

  async clearDiagnostics(): Promise<ApiResponse<ClearDiagnosticsResponse>> {
    return { ok: true, deleted: 0 };
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
      const startedAt = Date.now();
      const imageBytes = dataUrlToBytes(task.imageData);
      const imageHash = await sha256Hex(imageBytes);
      const previousTranslations = this.chapterMemory.previousTranslationsFor(imageHash);
      const chapterContext = this.chapterMemory.chapterContextFor(imageHash);
      const termCandidates = this.chapterMemory.termCandidatesFor(imageHash);
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

  providerProfile(): string {
    return `direct:${this.settings.directOcr.inputMode}:${directOcrConfigHash(this.settings)}+openai-compatible:${this.settings.directTranslator.model}+style:${TRANSLATION_STYLE_VERSION}+${effectiveGlossaryHash(this.settings)}`;
  }
}

function toOverlayRegion(region: TextRegion): OverlayRegion {
  return {
    ...region,
    style: {
      fontSize: Math.max(14, Math.min(28, Math.round(region.box.height * 0.52))),
      writingMode: region.orientation === "vertical" ? "vertical-rl" : "horizontal-tb",
      align: "center",
      background: "rgba(255,255,255,0.96)",
      color: "#111",
    },
  };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid imageData data URL.");
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  if (!/;base64/i.test(meta)) throw new Error("Direct plugin mode requires base64 imageData.");
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseStaticFields(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
