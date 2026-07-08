import { existsSync, readFileSync } from "node:fs";
import type { UpdateConfigRequest } from "@umt/shared";

export interface ServerConfig {
  port: number;
  provider: string;
  targetLanguage: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  ocrApiUrl: string;
  ocrApiKey: string;
  ocrApiKeys: string[];
  ocrInputMode: "image_base64" | "file";
  ocrImageField: string;
  ocrStaticFields: Record<string, unknown>;
  ocrRegionsPaths: string[];
  ocrTextPaths: string[];
  ocrBoxPaths: string[];
  ocrConfidencePaths: string[];
  maxImageLongEdge: number;
  jpegQuality: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawOcrInputMode = env.OCR_INPUT_MODE ?? env.UAPIS_OCR_INPUT;
  const ocrInputMode = rawOcrInputMode === "file" ? "file" : "image_base64";
  const ocrApiKeys = parseKeyList(env.OCR_API_KEYS, env.OCR_API_KEY, env.UAPIS_API_KEYS, env.UAPIS_API_KEY);
  return {
    port: Number(env.PORT ?? 47831),
    provider: normalizeRuntimeProvider(env.TRANSLATION_PIPELINE ?? env.VISION_PROVIDER ?? "network-ocr-openai-compatible"),
    targetLanguage: env.TARGET_LANGUAGE ?? "zh-CN",
    openaiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-4.1-mini",
    ocrApiUrl: env.OCR_API_URL ?? env.UAPIS_OCR_URL ?? "https://example.com/ocr",
    ocrApiKey: ocrApiKeys[0] ?? "",
    ocrApiKeys,
    ocrInputMode,
    ocrImageField: env.OCR_IMAGE_FIELD ?? (ocrInputMode === "file" ? "file" : "image_base64"),
    ocrStaticFields: parseJsonObject(env.OCR_STATIC_FIELDS_JSON, defaultOcrStaticFields(env)),
    ocrRegionsPaths: parsePathList(env.OCR_REGIONS_PATHS, ["words_result", "data.words_result", "data.result", "data.regions", "result", "regions"]),
    ocrTextPaths: parsePathList(env.OCR_TEXT_PATHS, ["words", "text", "content"]),
    ocrBoxPaths: parsePathList(env.OCR_BOX_PATHS, ["location", "box", "bbox", "vertexes_location"]),
    ocrConfidencePaths: parsePathList(env.OCR_CONFIDENCE_PATHS, ["score", "confidence"]),
    maxImageLongEdge: Number(env.MAX_IMAGE_LONG_EDGE ?? 1600),
    jpegQuality: Number(env.JPEG_QUALITY ?? 0.75),
  };
}

export function loadConfigFromEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const fileEnv = existsSync(path) ? parseEnvText(readFileSync(path, "utf8")) : {};
  return loadConfig({ ...fileEnv, ...env });
}

export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

export function mergeConfigPatch(current: ServerConfig, patch: UpdateConfigRequest): ServerConfig {
  const patchedKeys = parsePatchKeyList(patch.ocr?.apiKeys);
  const singlePatchedKey = normalizeOptionalString(patch.ocr?.apiKey);
  const nextKeys = patchedKeys.length ? patchedKeys : singlePatchedKey ? [singlePatchedKey] : current.ocrApiKeys;
  return {
    ...current,
    provider: normalizeRuntimeProvider(patch.provider ?? current.provider),
    targetLanguage: normalizeString(patch.targetLanguage, current.targetLanguage),
    openaiBaseUrl: normalizeUrl(patch.openAICompatible?.baseUrl, current.openaiBaseUrl),
    openaiApiKey: normalizeString(patch.openAICompatible?.apiKey, current.openaiApiKey),
    openaiModel: normalizeString(patch.openAICompatible?.model, current.openaiModel),
    ocrApiUrl: normalizeUrl(patch.ocr?.apiUrl, current.ocrApiUrl),
    ocrApiKey: nextKeys[0] ?? "",
    ocrApiKeys: nextKeys,
    ocrInputMode: patch.ocr?.inputMode === "file" ? "file" : patch.ocr?.inputMode === "image_base64" ? "image_base64" : current.ocrInputMode,
    ocrImageField: normalizeString(patch.ocr?.imageField, current.ocrImageField),
    ocrStaticFields: isPlainObject(patch.ocr?.staticFields) ? patch.ocr.staticFields : current.ocrStaticFields,
    ocrRegionsPaths: parsePatchPathList(patch.ocr?.regionsPaths, current.ocrRegionsPaths),
    ocrTextPaths: parsePatchPathList(patch.ocr?.textPaths, current.ocrTextPaths),
    ocrBoxPaths: parsePatchPathList(patch.ocr?.boxPaths, current.ocrBoxPaths),
    ocrConfidencePaths: parsePatchPathList(patch.ocr?.confidencePaths, current.ocrConfidencePaths),
    maxImageLongEdge: normalizeNumber(patch.image?.maxLongEdge, 600, 4096, current.maxImageLongEdge),
    jpegQuality: normalizeNumber(patch.image?.jpegQuality, 0.3, 1, current.jpegQuality),
  };
}

export function upsertConfigEnvText(currentText: string, config: ServerConfig): string {
  const env = parseEnvText(currentText);
  const next: Record<string, string> = {
    ...env,
    PORT: String(config.port),
    TRANSLATION_PIPELINE: "network-ocr-openai-compatible",
    OPENAI_BASE_URL: config.openaiBaseUrl,
    OPENAI_API_KEY: config.openaiApiKey,
    OPENAI_MODEL: config.openaiModel,
    OCR_API_URL: config.ocrApiUrl,
    OCR_API_KEYS: config.ocrApiKeys.join(","),
    OCR_INPUT_MODE: config.ocrInputMode,
    OCR_IMAGE_FIELD: config.ocrImageField,
    OCR_STATIC_FIELDS_JSON: JSON.stringify(config.ocrStaticFields),
    OCR_REGIONS_PATHS: config.ocrRegionsPaths.join(","),
    OCR_TEXT_PATHS: config.ocrTextPaths.join(","),
    OCR_BOX_PATHS: config.ocrBoxPaths.join(","),
    OCR_CONFIDENCE_PATHS: config.ocrConfidencePaths.join(","),
    TARGET_LANGUAGE: config.targetLanguage,
    MAX_IMAGE_LONG_EDGE: String(config.maxImageLongEdge),
    JPEG_QUALITY: String(config.jpegQuality),
  };
  for (const legacyKey of ["VISION_PROVIDER", "UAPIS_API_KEY", "UAPIS_API_KEYS", "UAPIS_OCR_URL", "UAPIS_OCR_INPUT", "UAPIS_OCR_NEED_LOCATION", "UAPIS_OCR_ENABLE_CLS", "BAIDU_OCR_API_KEY", "BAIDU_OCR_SECRET_KEY", "BAIDU_OCR_ENDPOINT", "BAIDU_OCR_LANGUAGE_TYPE", "LOCAL_OCR_URL", "LOCAL_OCR_ENGINE", "LOCAL_OCR_LANGUAGE"]) {
    delete next[legacyKey];
  }
  const order = ["PORT", "TRANSLATION_PIPELINE", "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OCR_API_URL", "OCR_API_KEYS", "OCR_INPUT_MODE", "OCR_IMAGE_FIELD", "OCR_STATIC_FIELDS_JSON", "OCR_REGIONS_PATHS", "OCR_TEXT_PATHS", "OCR_BOX_PATHS", "OCR_CONFIDENCE_PATHS", "TARGET_LANGUAGE", "MAX_IMAGE_LONG_EDGE", "JPEG_QUALITY"];
  const lines: string[] = [];
  for (const key of order) lines.push(`${key}=${next[key] ?? ""}`);
  const extraKeys = Object.keys(next).filter((key) => !order.includes(key)).sort();
  if (extraKeys.length) {
    lines.push("");
    for (const key of extraKeys) lines.push(`${key}=${next[key] ?? ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function normalizeRuntimeProvider(value: unknown): string {
  return value === "network-ocr-openai-compatible" ? value : "network-ocr-openai-compatible";
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function normalizeUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  return fallback;
}

function defaultOcrStaticFields(env: NodeJS.ProcessEnv): Record<string, unknown> {
  return {
    need_location: parseBool(env.UAPIS_OCR_NEED_LOCATION, true),
    enable_cls: parseBool(env.UAPIS_OCR_ENABLE_CLS, false),
    return_markdown: false,
  };
}

function parseJsonObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseKeyList(...sources: unknown[]): string[] {
  const values: string[] = [];
  for (const source of sources) {
    if (typeof source !== "string") continue;
    for (const part of source.split(/[\s,;]+/)) {
      const key = part.trim();
      if (key && !values.includes(key)) values.push(key);
    }
  }
  return values;
}

function parsePatchKeyList(value: unknown): string[] {
  if (Array.isArray(value)) return parseKeyList(value.join("\n"));
  return parseKeyList(value);
}

function parsePathList(value: unknown, fallback: string[]): string[] {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function parsePatchPathList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const parsed = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
    return parsed.length ? parsed : fallback;
  }
  return parsePathList(value, fallback);
}
