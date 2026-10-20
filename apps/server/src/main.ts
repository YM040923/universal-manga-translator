import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./api/server.js";
import { clearDiagnostics, FileDiagnosticsWriter, readRecentDiagnostics } from "./api/diagnostics.js";
import { EventBus } from "./api/events.js";
import { SurfaceCache } from "./cache/surface-cache.js";
import { OcrCache } from "./cache/ocr-cache.js";
import { ManualOverrideStore } from "./cache/manual-overrides.js";
import { openDatabase } from "./cache/db.js";
import { loadConfigFromEnvFile, mergeConfigPatch, upsertConfigEnvText, type ServerConfig } from "./config/env.js";
import { GenericNetworkOcrClient, OcrTranslatePipeline, OpenAICompatibleTextTranslator, type CorePipelineInput } from "@umt/core";
import { resolveServerRuntimePaths } from "./runtime/paths.js";
import type { ProviderInput, VisionProvider } from "./providers/provider.js";

const runtimePaths = resolveServerRuntimePaths(fileURLToPath(import.meta.url));
const envPath = runtimePaths.envPath;
let config = loadConfigFromEnvFile(envPath);
const dataDir = runtimePaths.dataDir;
mkdirSync(dataDir, { recursive: true });
const db = openDatabase(resolve(dataDir, "cache.sqlite"));
const surfaceCache = new SurfaceCache(db);
const ocrCache = new OcrCache(db);
const manualOverrideStore = new ManualOverrideStore(db);
const visionProvider = createVisionProvider(config);
const eventBus = new EventBus();
const diagnosticsPath = resolve(dataDir, "diagnostics.log");
const diagnosticsWriter = new FileDiagnosticsWriter(diagnosticsPath);
const app = await buildServer({
  ...serverState(config, visionProvider),
  surfaceCache,
  ocrCache,
  manualOverrideStore,
  eventBus,
  diagnosticsWriter,
  diagnosticsReader: (limit) => readRecentDiagnostics(diagnosticsPath, limit),
  diagnosticsClearer: () => clearDiagnostics(diagnosticsPath),
  configWritable: true,
  updateConfig: async (patch) => {
    config = mergeConfigPatch(config, patch);
    const currentEnvText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    writeFileSync(envPath, upsertConfigEnvText(currentEnvText, config), "utf8");
    const nextProvider = createVisionProvider(config);
    return {
      ...serverState(config, nextProvider),
      configWritable: true,
    };
  },
});
await app.listen({ host: "127.0.0.1", port: config.port });
console.log(`Universal Manga Translator backend listening on http://127.0.0.1:${config.port}`);

function serverState(nextConfig: ServerConfig, nextProvider = createVisionProvider(nextConfig)) {
  return {
    provider: nextConfig.provider,
    targetLanguage: nextConfig.targetLanguage,
    visionProvider: nextProvider,
    maxImageLongEdge: nextConfig.maxImageLongEdge,
    jpegQuality: nextConfig.jpegQuality,
    openAICompatibleBaseUrl: nextConfig.openaiBaseUrl,
    openAIModel: nextConfig.openaiModel,
    openAIApiKeyConfigured: nextConfig.openaiApiKey.length > 0,
    ocrProvider: "network-ocr",
    ocrApiKeyConfigured: nextConfig.ocrApiKeys.length > 0,
    ocrApiUrl: nextConfig.ocrApiUrl,
    ocrEndpoint: nextConfig.ocrApiUrl,
    ocrInputMode: nextConfig.ocrInputMode,
    ocrInput: nextConfig.ocrInputMode,
    ocrImageField: nextConfig.ocrImageField,
    ocrStaticFields: nextConfig.ocrStaticFields,
    ocrRegionsPaths: nextConfig.ocrRegionsPaths,
    ocrTextPaths: nextConfig.ocrTextPaths,
    ocrBoxPaths: nextConfig.ocrBoxPaths,
    ocrConfidencePaths: nextConfig.ocrConfidencePaths,
  };
}

function createVisionProvider(nextConfig: ServerConfig): VisionProvider {
  const pipeline = new OcrTranslatePipeline({
    profile: `network-ocr:${nextConfig.ocrInputMode}+openai-compatible:${nextConfig.openaiModel}`,
    ocr: new GenericNetworkOcrClient({
      endpoint: nextConfig.ocrApiUrl,
      apiKey: nextConfig.ocrApiKey,
      apiKeys: nextConfig.ocrApiKeys,
      inputMode: nextConfig.ocrInputMode,
      imageFieldName: nextConfig.ocrImageField,
      staticFields: nextConfig.ocrStaticFields,
      regionsPathCandidates: nextConfig.ocrRegionsPaths,
      textPathCandidates: nextConfig.ocrTextPaths,
      boxPathCandidates: nextConfig.ocrBoxPaths,
      confidencePathCandidates: nextConfig.ocrConfidencePaths,
    }),
    translator: new OpenAICompatibleTextTranslator({ baseUrl: nextConfig.openaiBaseUrl, apiKey: nextConfig.openaiApiKey, model: nextConfig.openaiModel }),
    ocrCache,
  });

  return {
    profile: pipeline.profile,
    listModels: () => pipeline.listModels(),
    keyStatus: () => pipeline.keyStatus(),
    process: async (input) => (await pipeline.process(toCorePipelineInput(input))).regions,
  };
}

function toCorePipelineInput(input: ProviderInput): CorePipelineInput {
  return {
    imageBytes: new Uint8Array(input.imageBuffer),
    fileName: "surface.jpg",
    mimeType: "image/jpeg",
    imageHash: input.imageHash,
    width: input.width,
    height: input.height,
    targetLanguage: input.task.targetLanguage,
    sourceLanguage: input.task.sourceLanguage,
    retranslate: input.forceRetranslate === true,
    ...(input.glossary ? { glossary: input.glossary } : {}),
    ...(input.chapterContext ? { chapterContext: input.chapterContext } : {}),
    ...(input.termCandidates ? { termCandidates: input.termCandidates } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}



