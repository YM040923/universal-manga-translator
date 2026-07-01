export type ImageRange = "viewport" | "fullPage";
export type SiteScope = "origin" | "similarPath";

export interface SiteSettings {
  autoTranslate: boolean;
  scope: SiteScope;
  pathPrefix?: string;
}

export interface EffectiveSiteSettings {
  origin: string;
  autoTranslate: boolean;
  scope: SiteScope;
  pathPrefix: string;
  unsupported: boolean;
}

export interface ExtensionSettings {
  backendUrl: string;
  targetLanguage: string;
  translationModel: string;
  autoTranslateDefault: boolean;
  imageRange: ImageRange;
  pretranslateNextPage: boolean;
  floatingButtonEnabled: boolean;
  siteSettings: Record<string, SiteSettings>;
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
  backendUrl: "http://127.0.0.1:47831",
  targetLanguage: "zh-CN",
  translationModel: "mock",
  autoTranslateDefault: true,
  imageRange: "viewport",
  pretranslateNextPage: false,
  floatingButtonEnabled: true,
  siteSettings: {},
};

export function normalizeSettings(input: LegacyExtensionSettings = {}): ExtensionSettings {
  return {
    backendUrl: normalizeBackendUrl(input.backendUrl),
    targetLanguage: normalizeNonEmptyString(input.targetLanguage, DEFAULT_SETTINGS.targetLanguage),
    translationModel: normalizeNonEmptyString(input.translationModel, DEFAULT_SETTINGS.translationModel),
    autoTranslateDefault: typeof input.autoTranslateDefault === "boolean"
      ? input.autoTranslateDefault
      : typeof input.autoTranslate === "boolean"
        ? input.autoTranslate
        : DEFAULT_SETTINGS.autoTranslateDefault,
    imageRange: input.imageRange === "fullPage" || input.imageRange === "viewport" ? input.imageRange : DEFAULT_SETTINGS.imageRange,
    pretranslateNextPage: typeof input.pretranslateNextPage === "boolean" ? input.pretranslateNextPage : DEFAULT_SETTINGS.pretranslateNextPage,
    floatingButtonEnabled: typeof input.floatingButtonEnabled === "boolean" ? input.floatingButtonEnabled : DEFAULT_SETTINGS.floatingButtonEnabled,
    siteSettings: normalizeSiteSettings(input.siteSettings),
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
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_SETTINGS.backendUrl;
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SETTINGS.backendUrl;
  }
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
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


