export interface ExtensionSettings {
  backendUrl: string;
  targetLanguage: string;
  autoTranslate: boolean;
}

export interface SettingsStorageArea {
  get(keys?: unknown): Promise<Record<string, unknown>> | void;
  set(value: Record<string, unknown>): Promise<void> | void;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendUrl: "http://127.0.0.1:47831",
  targetLanguage: "zh-CN",
  autoTranslate: true,
};

export function normalizeSettings(input: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    backendUrl: normalizeBackendUrl(input.backendUrl),
    targetLanguage: normalizeTargetLanguage(input.targetLanguage),
    autoTranslate: typeof input.autoTranslate === "boolean" ? input.autoTranslate : DEFAULT_SETTINGS.autoTranslate,
  };
}

export async function loadSettings(storage: SettingsStorageArea = chrome.storage.sync): Promise<ExtensionSettings> {
  const saved = await storage.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings(saved as Partial<ExtensionSettings>);
}

export async function saveSettings(settings: Partial<ExtensionSettings>, storage: SettingsStorageArea = chrome.storage.sync): Promise<ExtensionSettings> {
  const normalized = normalizeSettings(settings);
  await storage.set({ ...normalized });
  return normalized;
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

function normalizeTargetLanguage(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.targetLanguage;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : DEFAULT_SETTINGS.targetLanguage;
}