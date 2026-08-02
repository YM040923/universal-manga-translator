import { normalizeSettings, type ExtensionSettings } from "../settings/settings.js";

export function readDirectConfigFromDom(root: HTMLElement, settings: ExtensionSettings): ExtensionSettings {
  const value = (field: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-field='${field}']`)?.value ?? "";
  return normalizeSettings({
    ...settings,
    runMode: value("run-mode") === "backend" ? "backend" : "direct",
    backendUrl: value("backend-url") || settings.backendUrl,
    directOcr: {
      ...settings.directOcr,
      apiUrl: value("direct-ocr-url"),
      apiKeys: splitLines(value("direct-ocr-keys")),
      inputMode: value("direct-ocr-input-mode") === "file" ? "file" : "image_base64",
      imageField: value("direct-ocr-image-field"),
      regionsPaths: splitLines(value("direct-ocr-regions-paths")),
      textPaths: splitLines(value("direct-ocr-text-paths")),
      boxPaths: splitLines(value("direct-ocr-box-paths")),
      confidencePaths: splitLines(value("direct-ocr-confidence-paths")),
      staticFieldsText: value("direct-ocr-static-fields"),
      maxAutoOcrPages: Number(value("direct-ocr-max-auto-pages")),
      maxOcrTilesPerImage: Number(value("direct-ocr-max-tiles-per-image")),
      maxOcrRescueCallsPerImage: Number(value("direct-ocr-max-rescue-calls-per-image")),
      stopAfterConsecutiveFailures: Number(value("direct-ocr-stop-after-failures")),
    },
    directTranslator: {
      baseUrl: value("direct-translator-base-url"),
      apiKey: value("direct-translator-api-key"),
      model: value("direct-translator-model"),
    },
    glossaryText: value("glossary-text"),
  });
}

function splitLines(value: string): string[] {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}
