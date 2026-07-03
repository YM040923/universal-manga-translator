import type { Rect } from "@umt/shared";
import { ApiKeyPool, type ApiKeyPoolStatus } from "./api-key-pool.js";

export type GenericOcrInputMode = "image_base64" | "file";

export interface GenericOcrImageInput {
  imageBytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}

export interface GenericOcrRegion {
  id: string;
  box: Rect;
  sourceText: string;
  confidence: number;
  orientation: "horizontal" | "vertical";
  kind: "dialogue" | "sfx" | "narration";
}

export interface GenericNetworkOcrClientOptions {
  endpoint: string;
  apiKey?: string;
  apiKeys?: string[];
  inputMode?: GenericOcrInputMode;
  imageFieldName?: string;
  imageNameFieldName?: string;
  fileName?: string;
  staticFields?: Record<string, unknown>;
  regionsPathCandidates?: string[];
  textPathCandidates?: string[];
  boxPathCandidates?: string[];
  confidencePathCandidates?: string[];
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export interface GenericOcrParseOptions {
  regionsPathCandidates?: string[];
  textPathCandidates?: string[];
  boxPathCandidates?: string[];
  confidencePathCandidates?: string[];
}

export type GenericOcrErrorKind = "quota" | "auth" | "rate_limit" | "network" | "empty" | "server" | "unknown";

export interface GenericOcrErrorClassification {
  kind: GenericOcrErrorKind;
  retryable: boolean;
}

const DEFAULT_REGIONS_PATHS = ["words_result", "data.words_result", "data.result", "data.regions", "result", "regions"];
const DEFAULT_TEXT_PATHS = ["words", "text", "content"];
const DEFAULT_BOX_PATHS = ["location", "box", "bbox", "vertexes_location"];
const DEFAULT_CONFIDENCE_PATHS = ["score", "confidence"];

export class GenericNetworkOcrClient {
  readonly profile = "network-ocr";
  private readonly keyPool: ApiKeyPool;

  constructor(private readonly options: GenericNetworkOcrClientOptions) {
    this.keyPool = new ApiKeyPool(options.apiKeys?.length ? options.apiKeys : options.apiKey ? [options.apiKey] : []);
  }

  keyStatus(): ApiKeyPoolStatus {
    return this.keyPool.status();
  }

  async recognize(input: GenericOcrImageInput): Promise<GenericOcrRegion[]> {
    const attempts = Math.max(1, Math.min(5, this.options.attempts ?? 3));
    const keyCount = Math.max(1, this.keyPool.status().count);
    const maxAttempts = attempts + Math.max(0, keyCount - 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const lease = this.keyPool.next();
        if (!lease && this.keyPool.status().count > 0) {
          throw lastError instanceof Error ? lastError : new Error("No available OCR API key; all configured keys are blocked after quota/auth/rate-limit errors.");
        }
        try {
          const regions = await this.recognizeOnce(input, lease?.value);
          if (lease) this.keyPool.reportSuccess(lease);
          return regions;
        } catch (error) {
          if (lease && isKeyExhaustionError(error)) this.keyPool.reportFailure(lease, error);
          throw error;
        }
      } catch (error) {
        lastError = error;
        const shouldTryAnotherKey = isKeyExhaustionError(error) && this.keyPool.status().available > 0;
        if (attempt >= maxAttempts || (!shouldTryAnotherKey && (attempt >= attempts || !isRetriableOcrError(error)))) break;
        await delay((this.options.retryDelayMs ?? 900) * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async recognizeOnce(input: GenericOcrImageInput, apiKeyOverride?: string): Promise<GenericOcrRegion[]> {
    if (!this.options.endpoint.trim()) throw new Error("OCR API URL is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, this.options.timeoutMs ?? 90000));
    try {
      const form = new FormData();
      const inputMode = this.options.inputMode ?? "image_base64";
      const imageFieldName = this.options.imageFieldName ?? (inputMode === "file" ? "file" : "image_base64");
      const fileName = input.fileName ?? this.options.fileName ?? "surface.jpg";
      if (inputMode === "file") {
        form.set(imageFieldName, new Blob([uint8ArrayToArrayBuffer(input.imageBytes)], { type: input.mimeType ?? "image/jpeg" }), fileName);
      } else {
        form.set(imageFieldName, bytesToBase64(input.imageBytes));
        form.set(this.options.imageNameFieldName ?? "image_name", fileName);
      }
      for (const [key, value] of Object.entries(this.options.staticFields ?? {})) appendStaticField(form, key, value);

      const headers = new Headers();
      const apiKey = apiKeyOverride ?? this.options.apiKey;
      if (apiKey?.trim()) headers.set("authorization", `Bearer ${apiKey.trim()}`);
      const fetchImpl = this.options.fetch ?? globalThis.fetch;
      const response = await fetchImpl(this.options.endpoint, { method: "POST", headers, body: form, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(formatGenericOcrError(response.status, payload));
      if (isErrorPayload(payload)) throw new Error(formatGenericOcrError(response.status, payload));
      return parseGenericOcrRegions(payload, this.options);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseGenericOcrRegions(payload: unknown, options: GenericOcrParseOptions = {}): GenericOcrRegion[] {
  const regions = firstArrayFromPaths(payload, options.regionsPathCandidates ?? DEFAULT_REGIONS_PATHS);
  return regions.flatMap((item, index) => {
    const text = firstStringFromPaths(item, options.textPathCandidates ?? DEFAULT_TEXT_PATHS);
    const box = firstRectFromPaths(item, options.boxPathCandidates ?? DEFAULT_BOX_PATHS);
    if (!text || !box) return [];
    return [{
      id: `network-ocr-${index + 1}`,
      box,
      sourceText: text,
      confidence: firstNumberFromPaths(item, options.confidencePathCandidates ?? DEFAULT_CONFIDENCE_PATHS) ?? 0.9,
      orientation: box.height > box.width * 1.8 ? "vertical" as const : "horizontal" as const,
      kind: "dialogue" as const,
    }];
  });
}

export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (typeof current === "object") current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  return current;
}

function firstArrayFromPaths(payload: unknown, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = getByPath(payload, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstStringFromPaths(payload: unknown, paths: string[]): string {
  for (const path of paths) {
    const value = getByPath(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumberFromPaths(payload: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const number = toFiniteNumber(getByPath(payload, path));
    if (number !== null) return number;
  }
  return null;
}

function firstRectFromPaths(payload: unknown, paths: string[]): Rect | null {
  for (const path of paths) {
    const rect = valueToRect(getByPath(payload, path));
    if (rect) return rect;
  }
  return null;
}

function valueToRect(value: unknown): Rect | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    return rectFromNumbers(object.left ?? object.x, object.top ?? object.y, object.width ?? object.w, object.height ?? object.h)
      ?? xyxyToRect(object.x1, object.y1, object.x2, object.y2);
  }
  if (Array.isArray(value)) {
    if (value.length >= 4 && value.every((item) => typeof item === "number" || typeof item === "string")) return xyxyToRect(value[0], value[1], value[2], value[3]);
    const points = value.flatMap((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const x = toFiniteNumber(point[0]);
        const y = toFiniteNumber(point[1]);
        return x === null || y === null ? [] : [{ x, y }];
      }
      if (point && typeof point === "object") {
        const object = point as { x?: unknown; y?: unknown };
        const x = toFiniteNumber(object.x);
        const y = toFiniteNumber(object.y);
        return x === null || y === null ? [] : [{ x, y }];
      }
      return [];
    });
    if (points.length >= 2) {
      const left = Math.min(...points.map((point) => point.x));
      const top = Math.min(...points.map((point) => point.y));
      const right = Math.max(...points.map((point) => point.x));
      const bottom = Math.max(...points.map((point) => point.y));
      return rectFromNumbers(left, top, right - left, bottom - top);
    }
  }
  return null;
}

function rectFromNumbers(xRaw: unknown, yRaw: unknown, widthRaw: unknown, heightRaw: unknown): Rect | null {
  const x = toFiniteNumber(xRaw);
  const y = toFiniteNumber(yRaw);
  const width = toFiniteNumber(widthRaw);
  const height = toFiniteNumber(heightRaw);
  if (x === null || y === null || width === null || height === null || width <= 1 || height <= 1) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function xyxyToRect(x1Raw: unknown, y1Raw: unknown, x2Raw: unknown, y2Raw: unknown): Rect | null {
  const x1 = toFiniteNumber(x1Raw);
  const y1 = toFiniteNumber(y1Raw);
  const x2 = toFiniteNumber(x2Raw);
  const y2 = toFiniteNumber(y2Raw);
  if (x1 === null || y1 === null || x2 === null || y2 === null || x2 <= x1 || y2 <= y1) return null;
  return { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
}

function toFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function appendStaticField(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) || typeof value === "object") form.set(key, JSON.stringify(value));
  else form.set(key, String(value));
}

function isErrorPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const object = payload as Record<string, unknown>;
  const code = object.code ?? object.error_code ?? object.errcode;
  if (code === undefined || code === null || code === "" || code === 0 || code === "0") return false;
  return String(code).toUpperCase() !== "OK" && String(code).toUpperCase() !== "SUCCESS";
}

function formatGenericOcrError(status: number, payload: unknown): string {
  const object = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = object.code ?? object.error_code ?? object.errcode ?? object.error ?? "";
  const message = object.message ?? object.error_msg ?? object.msg ?? "";
  return `Network OCR failed: ${status}${code ? ` ${String(code)}` : ""}${message ? ` ${String(message)}` : ""}`.trim();
}

export function classifyGenericOcrError(error: unknown): GenericOcrErrorClassification {
  const message = error instanceof Error ? error.message : String(error);
  if (/no text regions|no regions|empty/i.test(message)) return { kind: "empty", retryable: false };
  if (/\b402\b|quota|balance|insufficient|exhaust|credits?|账户积分不足|余额不足/i.test(message)) return { kind: "quota", retryable: false };
  if (/\b401\b|\b403\b|INVALID_API_KEY|unauthorized|forbidden|permission|无权限/i.test(message)) return { kind: "auth", retryable: false };
  if (/\b429\b|rate.?limit|qps|too many requests|limit reached/i.test(message)) return { kind: "rate_limit", retryable: true };
  if (/fetch failed|socket|timeout|aborted|ECONNRESET|ETIMEDOUT|network/i.test(message)) return { kind: "network", retryable: true };
  if (/\b5\d\d\b|\b524\b|server/i.test(message)) return { kind: "server", retryable: true };
  return { kind: "unknown", retryable: false };
}

function isKeyExhaustionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const kind = classifyGenericOcrError(error).kind;
  return kind === "quota" || kind === "auth" || kind === "rate_limit";
}

function isRetriableOcrError(error: unknown): boolean {
  return classifyGenericOcrError(error).retryable;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  return btoa(binary);
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
