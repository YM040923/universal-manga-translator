export const CONTENT_SETTING_CHANGE_KEYS = [
  "runMode",
  "backendUrl",
  "directOcr",
  "directTranslator",
  "targetLanguage",
  "maxConcurrentSubmissions",
  "maxFullPageSurfaces",
  "siteSettings",
  "enabledSites",
  "translationOverlayVisible",
  "overlayAppearance",
  "autoTranslateDefault",
  "debugOverlayEnabled",
  "requestTimeoutMs",
  "retryCount",
  "floatingButtonEnabled",
  "progressWidgetEnabled",
] as const;

export function hasRelevantContentSettingChange(changes: Record<string, unknown>): boolean {
  return CONTENT_SETTING_CHANGE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}
