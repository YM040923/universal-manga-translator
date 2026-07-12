import { glossaryHash, normalizeGlossaryText, parseGlossaryText } from "./glossary.js";

export type ImageRange = "viewport" | "fullPage";
export type SiteScope = "origin" | "similarPath";
export type OverlayMaskShape = "auto" | "ellipse" | "rounded" | "transparent";
export type RunMode = "direct" | "backend";

export interface OverlayAppearance {
  maskShape: OverlayMaskShape;
  fontScale: number;
  maskScale: number;
  ellipseX: number;
  ellipseY: number;
  opacity: number;
}

export interface SiteSettings {
  autoTranslate: boolean;
  scope: SiteScope;
  pathPrefix?: string;
}

export interface DirectOcrSettings {
  apiUrl: string;
  apiKeys: string[];
  inputMode: "image_base64" | "file";
  imageField: string;
  staticFieldsText: string;
  regionsPaths: string[];
  textPaths: string[];
  boxPaths: string[];
  confidencePaths: string[];
  maxAutoOcrPages: number;
  stopAfterConsecutiveFailures: number;
}

export interface DirectTranslatorSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface EffectiveSiteSettings {
  origin: string;
  autoTranslate: boolean;
  scope: SiteScope;
  pathPrefix: string;
  unsupported: boolean;
}

export interface ExtensionSettings {
  runMode: RunMode;
  backendUrl: string;
  targetLanguage: string;
  translationModel: string;
  providerProfile: string;
  openAICompatibleBaseUrl: string;
  requestTimeoutMs: number;
  maxConcurrentSubmissions: number;
  maxFullPageSurfaces: number;
  retryCount: number;
  autoTranslateDefault: boolean;
  imageRange: ImageRange;
  pretranslateNextPage: boolean;
  floatingButtonEnabled: boolean;
  progressWidgetEnabled: boolean;
  debugOverlayEnabled: boolean;
  siteSettings: Record<string, SiteSettings>;
  enabledSites: Record<string, boolean>;
  translationOverlayVisible: boolean;
  overlayAppearance: OverlayAppearance;
  glossaryText: string;
  glossary: Record<string, string>;
  glossaryHash: string;
  directOcr: DirectOcrSettings;
  directTranslator: DirectTranslatorSettings;
  /** @deprecated Use autoTranslateDefault. Kept optional for migration from older UI code. */
  autoTranslate?: boolean;
}

export interface LegacyExtensionSettings extends Partial<ExtensionSettings> {
  autoTranslate?: boolean;
}

export interface SettingsStorageArea {
  get(keys?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  runMode: "direct",
  backendUrl: "http://127.0.0.1:47831",
  targetLanguage: "zh-CN",
  translationModel: "gpt-4.1-mini",
  providerProfile: "network-ocr-openai-compatible",
  openAICompatibleBaseUrl: "",
  requestTimeoutMs: 60000,
  maxConcurrentSubmissions: 2,
  maxFullPageSurfaces: 80,
  retryCount: 1,
  autoTranslateDefault: false,
  imageRange: "viewport",
  pretranslateNextPage: false,
  floatingButtonEnabled: true,
  progressWidgetEnabled: true,
  debugOverlayEnabled: false,
  siteSettings: {},
  enabledSites: {},
  translationOverlayVisible: true,
  overlayAppearance: {
    maskShape: "auto",
    fontScale: 1,
    maskScale: 1,
    ellipseX: 50,
    ellipseY: 42,
    opacity: 1,
  },
  glossaryText: "",
  glossary: {},
  glossaryHash: "glossary:empty",
  directOcr: {
    apiUrl: "",
    apiKeys: [],
    inputMode: "image_base64",
    imageField: "image_base64",
    staticFieldsText: "{}",
    regionsPaths: ["words_result", "data.words_result", "data.result", "data.regions", "result", "regions"],
    textPaths: ["words", "text", "content"],
    boxPaths: ["location", "box", "bbox", "vertexes_location"],
    confidencePaths: ["score", "confidence"],
    maxAutoOcrPages: 80,
    stopAfterConsecutiveFailures: 4,
  },
  directTranslator: {
    baseUrl: "",
    apiKey: "",
    model: "gpt-4.1-mini",
  },
};

export function normalizeSettings(input: LegacyExtensionSettings = {}): ExtensionSettings {
  const glossaryText = normalizeGlossaryText(input.glossaryText);
  const glossary = parseGlossaryText(glossaryText);
  return {
    runMode: input.runMode === "backend" ? "backend" : "direct",
    backendUrl: normalizeBackendUrl(input.backendUrl),
    targetLanguage: normalizeNonEmptyString(input.targetLanguage, DEFAULT_SETTINGS.targetLanguage),
    translationModel: normalizeNonEmptyString(input.translationModel, DEFAULT_SETTINGS.translationModel),
    providerProfile: normalizeNonEmptyString(input.providerProfile, DEFAULT_SETTINGS.providerProfile),
    openAICompatibleBaseUrl: normalizeOptionalHttpUrl(input.openAICompatibleBaseUrl),
    requestTimeoutMs: normalizeInteger(input.requestTimeoutMs, 5000, 180000, DEFAULT_SETTINGS.requestTimeoutMs),
    maxConcurrentSubmissions: normalizeInteger(input.maxConcurrentSubmissions, 1, 8, DEFAULT_SETTINGS.maxConcurrentSubmissions),
    maxFullPageSurfaces: normalizeInteger(input.maxFullPageSurfaces, 1, 300, DEFAULT_SETTINGS.maxFullPageSurfaces),
    retryCount: normalizeInteger(input.retryCount, 0, 5, DEFAULT_SETTINGS.retryCount),
    autoTranslateDefault: typeof input.autoTranslateDefault === "boolean"
      ? input.autoTranslateDefault
      : typeof input.autoTranslate === "boolean"
        ? input.autoTranslate
        : DEFAULT_SETTINGS.autoTranslateDefault,
    imageRange: input.imageRange === "fullPage" || input.imageRange === "viewport" ? input.imageRange : DEFAULT_SETTINGS.imageRange,
    pretranslateNextPage: typeof input.pretranslateNextPage === "boolean" ? input.pretranslateNextPage : DEFAULT_SETTINGS.pretranslateNextPage,
    floatingButtonEnabled: typeof input.floatingButtonEnabled === "boolean" ? input.floatingButtonEnabled : DEFAULT_SETTINGS.floatingButtonEnabled,
    progressWidgetEnabled: typeof input.progressWidgetEnabled === "boolean" ? input.progressWidgetEnabled : DEFAULT_SETTINGS.progressWidgetEnabled,
    debugOverlayEnabled: typeof input.debugOverlayEnabled === "boolean" ? input.debugOverlayEnabled : DEFAULT_SETTINGS.debugOverlayEnabled,
    siteSettings: normalizeSiteSettings(input.siteSettings),
    enabledSites: normalizeEnabledSites(input.enabledSites),
    translationOverlayVisible: typeof input.translationOverlayVisible === "boolean" ? input.translationOverlayVisible : DEFAULT_SETTINGS.translationOverlayVisible,
    overlayAppearance: normalizeOverlayAppearance(input.overlayAppearance),
    glossaryText,
    glossary,
    glossaryHash: glossaryHash(glossary),
    directOcr: normalizeDirectOcr(input.directOcr),
    directTranslator: normalizeDirectTranslator(input.directTranslator),
  };
}

function normalizeDirectOcr(value: unknown): DirectOcrSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<DirectOcrSettings> : {};
  const inputMode = raw.inputMode === "file" ? "file" : "image_base64";
  return {
    apiUrl: normalizeOptionalHttpUrl(raw.apiUrl),
    apiKeys: normalizeStringList(raw.apiKeys),
    inputMode,
    imageField: normalizeNonEmptyString(raw.imageField, DEFAULT_SETTINGS.directOcr.imageField),
    staticFieldsText: normalizeJsonObjectText(raw.staticFieldsText, DEFAULT_SETTINGS.directOcr.staticFieldsText),
    regionsPaths: normalizeStringList(raw.regionsPaths, DEFAULT_SETTINGS.directOcr.regionsPaths),
    textPaths: normalizeStringList(raw.textPaths, DEFAULT_SETTINGS.directOcr.textPaths),
    boxPaths: normalizeStringList(raw.boxPaths, DEFAULT_SETTINGS.directOcr.boxPaths),
    confidencePaths: normalizeStringList(raw.confidencePaths, DEFAULT_SETTINGS.directOcr.confidencePaths),
    maxAutoOcrPages: normalizeInteger(raw.maxAutoOcrPages, 1, 120, DEFAULT_SETTINGS.directOcr.maxAutoOcrPages),
    stopAfterConsecutiveFailures: normalizeInteger(raw.stopAfterConsecutiveFailures, 1, 10, DEFAULT_SETTINGS.directOcr.stopAfterConsecutiveFailures),
  };
}

function normalizeDirectTranslator(value: unknown): DirectTranslatorSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<DirectTranslatorSettings> : {};
  return {
    baseUrl: normalizeOpenAICompatibleBaseUrl(raw.baseUrl),
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    model: normalizeNonEmptyString(raw.model, DEFAULT_SETTINGS.directTranslator.model),
  };
}

export function normalizeOverlayAppearance(value: unknown): OverlayAppearance {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<OverlayAppearance> : {};
  const maskShape: OverlayMaskShape = raw.maskShape === "ellipse" || raw.maskShape === "rounded" || raw.maskShape === "transparent" || raw.maskShape === "auto"
    ? raw.maskShape
    : DEFAULT_SETTINGS.overlayAppearance.maskShape;
  return {
    maskShape,
    fontScale: normalizeNumber(raw.fontScale, 0.75, 1.3, DEFAULT_SETTINGS.overlayAppearance.fontScale),
    maskScale: normalizeNumber(raw.maskScale, 0.2, 4, DEFAULT_SETTINGS.overlayAppearance.maskScale),
    ellipseX: normalizeNumber(raw.ellipseX, 20, 90, DEFAULT_SETTINGS.overlayAppearance.ellipseX),
    ellipseY: normalizeNumber(raw.ellipseY, 20, 90, DEFAULT_SETTINGS.overlayAppearance.ellipseY),
    opacity: normalizeNumber(raw.opacity, 0.35, 1, DEFAULT_SETTINGS.overlayAppearance.opacity),
  };
}

export async function loadSettings(storage: SettingsStorageArea = chrome.storage.sync): Promise<ExtensionSettings> {
  const saved = await storage.get([...Object.keys(DEFAULT_SETTINGS), "autoTranslate"]);
  return normalizeSettings(saved as LegacyExtensionSettings);
}

export async function saveSettings(settings: LegacyExtensionSettings, storage: SettingsStorageArea = chrome.storage.sync): Promise<ExtensionSettings> {
  const normalized = normalizeSettings(settings);
  await storage.set({ ...normalized });
  return normalized;
}

export function primaryDomainFromUrl(pageUrl: string): string | null {
  const parsed = parseHttpUrl(pageUrl);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  const secondLevel = parts.at(-2) ?? "";
  const knownSecondLevel = new Set(["co", "com", "net", "org", "ac", "gov"]);
  if (parts.length >= 3 && knownSecondLevel.has(secondLevel) && (parts.at(-1)?.length ?? 0) === 2) return parts.slice(-3).join(".");
  return lastTwo;
}

export function isSiteEnabled(settings: ExtensionSettings, pageUrl: string): boolean {
  const domain = primaryDomainFromUrl(pageUrl);
  return !!(domain && settings.enabledSites[domain]);
}

export function enableSiteForUrl(settings: ExtensionSettings, pageUrl: string): ExtensionSettings {
  const domain = primaryDomainFromUrl(pageUrl);
  if (!domain) return settings;
  return normalizeSettings({
    ...settings,
    enabledSites: { ...settings.enabledSites, [domain]: true },
  });
}

export function setTranslationOverlayVisible(settings: ExtensionSettings, visible: boolean): ExtensionSettings {
  return normalizeSettings({ ...settings, translationOverlayVisible: visible });
}

export function getEffectiveSiteSettings(settings: ExtensionSettings, pageUrl: string): EffectiveSiteSettings {
  const parsed = parseHttpUrl(pageUrl);
  if (!parsed) return { origin: "", autoTranslate: false, scope: "origin", pathPrefix: "/", unsupported: true };
  const override = settings.siteSettings[parsed.origin];
  const scope = override?.scope ?? "origin";
  const pathPrefix = scope === "similarPath" ? normalizePathPrefix(override?.pathPrefix ?? deriveSimilarPathPrefix(parsed.pathname)) : "/";
  return {
    origin: parsed.origin,
    autoTranslate: override?.autoTranslate ?? settings.autoTranslateDefault,
    scope,
    pathPrefix,
    unsupported: false,
  };
}

export function setSiteSettings(settings: ExtensionSettings, pageUrl: string, patch: Partial<SiteSettings>): ExtensionSettings {
  const parsed = parseHttpUrl(pageUrl);
  if (!parsed) return settings;
  const current = getEffectiveSiteSettings(settings, pageUrl);
  const scope = patch.scope ?? current.scope;
  const pathPrefix = scope === "similarPath" ? normalizePathPrefix(patch.pathPrefix ?? current.pathPrefix) : "/";
  return normalizeSettings({
    ...settings,
    siteSettings: {
      ...settings.siteSettings,
      [parsed.origin]: {
        autoTranslate: patch.autoTranslate ?? current.autoTranslate,
        scope,
        pathPrefix,
      },
    },
  });
}

export function deriveSimilarPathPrefix(pathname: string): string {
  const clean = normalizePathPrefix(pathname);
  const parts = clean.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, 2).join("/")}`;
}

function normalizeBackendUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.backendUrl;
  const normalized = normalizeOptionalHttpUrl(value);
  return normalized || DEFAULT_SETTINGS.backendUrl;
}

function normalizeOptionalHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeOpenAICompatibleBaseUrl(value: unknown): string {
  const normalized = normalizeOptionalHttpUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/v1";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item) => item.length > 0);
  return normalized.length ? normalized : [...fallback];
}

function normalizeJsonObjectText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return value.trim();
  } catch {
    return fallback;
  }
}

function normalizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (integer < min) return fallback;
  if (integer > max) return max;
  return integer;
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) return fallback;
  const clamped = Math.max(min, Math.min(max, numberValue));
  return Math.round(clamped * 100) / 100;
}

function normalizeEnabledSites(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, boolean> = {};
  for (const [domain, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (enabled !== true) continue;
    const clean = domain.toLowerCase().replace(/^www\./, "").trim();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) normalized[clean] = true;
  }
  return normalized;
}

function normalizeSiteSettings(value: unknown): Record<string, SiteSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, SiteSettings> = {};
  for (const [origin, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = parseHttpUrl(origin);
    if (!parsed || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Partial<SiteSettings>;
    if (typeof candidate.autoTranslate !== "boolean") continue;
    const scope: SiteScope = candidate.scope === "similarPath" ? "similarPath" : "origin";
    normalized[parsed.origin] = {
      autoTranslate: candidate.autoTranslate,
      scope,
      pathPrefix: scope === "similarPath" ? normalizePathPrefix(candidate.pathPrefix) : "/",
    };
  }
  return normalized;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function normalizePathPrefix(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "/";
  const withoutQuery = value.trim().split(/[?#]/, 1)[0] ?? "/";
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

