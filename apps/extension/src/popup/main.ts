import type { ApiResponse, ConfigStatusResponse } from "@umt/shared/protocol";
import {
  DEFAULT_SETTINGS,
  enableSiteForUrl,
  isSiteEnabled,
  loadSettings,
  primaryDomainFromUrl,
  getEffectiveSiteSettings,
  saveSettings,
  setTranslationOverlayVisible,
  setSiteSettings,
  normalizeSettings,
  type ExtensionSettings,
  type SettingsStorageArea,
} from "../settings/settings.js";
import type { UmtActivateSiteResponse, UmtContentCommand, UmtContentCommandName } from "../content/messages.js";

export interface PopupTab { id?: number; url?: string; }

export interface PopupDeps {
  storage?: SettingsStorageArea;
  queryActiveTab?: () => Promise<PopupTab | null>;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  configStatus?: (backendUrl: string) => Promise<ApiResponse<ConfigStatusResponse>>;
  sendMessageToTab?: (tabId: number, message: UmtContentCommand) => Promise<void> | void;
  activateSite?: (tabId: number, url: string) => Promise<UmtActivateSiteResponse>;
  ensureContentScript?: (tabId: number, url: string) => Promise<UmtActivateSiteResponse>;
}

const TEXT = {
  brand: "\u6f2b\u8bd1",
  enabled: "\u5df2\u542f\u7528",
  disabled: "\u6b64\u7f51\u7ad9\u672a\u542f\u7528",
  unsupported: "\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301",
  backendOk: "\u540e\u7aef\u5df2\u8fde\u63a5",
  backendBad: "\u540e\u7aef\u79bb\u7ebf",
  backendChecking: "\u6b63\u5728\u68c0\u6d4b\u540e\u7aef",
  directMode: "插件直连",
  backendMode: "本地后端",
  apiReady: "API 已配置",
  apiMissing: "API 未配置",
  selfTest: "自检",
  activate: "\u542f\u7528\u6b64\u7f51\u7ad9",
  translate: "\u7ffb\u8bd1\u672c\u9875",
  retranslate: "\u91cd\u7ffb\u672c\u9875",
  pause: "\u6682\u505c",
  clear: "\u6e05\u9664\u8986\u76d6",
  cancel: "\u53d6\u6d88\u961f\u5217",
  select: "\u6846\u9009\u7ffb\u8bd1",
  overlay: "\u663e\u793a\u7ffb\u8bd1\u6c14\u6ce1",
  auto: "\u81ea\u52a8\u7ffb\u8bd1\u672c\u7f51\u7ad9",
  floatingButton: "\u53f3\u4e0b\u89d2\u663e\u793a/\u9690\u85cf\u6309\u94ae",
  progressWidget: "\u7ffb\u8bd1\u8fdb\u5ea6\u6761",
  appearance: "\u663e\u793a\u8c03\u6821",
  manual: "\u624b\u52a8\u64cd\u4f5c",
  switches: "\u5f00\u5173",
  maskShape: "\u906e\u7f69\u5f62\u72b6",
  fontScale: "\u5b57\u4f53",
  maskScale: "\u906e\u7f69",
  ellipseX: "\u692d\u5706\u5bbd",
  ellipseY: "\u692d\u5706\u9ad8",
  opacity: "\u900f\u660e",
  resetAppearance: "\u6062\u590d\u9ed8\u8ba4\u663e\u793a",
};

export async function mountPopupPage(root: HTMLElement, deps: PopupDeps = {}): Promise<void> {
  const storage = deps.storage;
  let settings = await loadSettings(storage);
  const tab = await queryActiveTab(deps);
  let backendOnline: boolean | null = null;
  let selfTestSummary = "";

  const render = (): void => {
    const url = tab?.url ?? "";
    const domain = primaryDomainFromUrl(url);
    const unsupported = !domain || !tab?.id;
    const enabled = !unsupported && isSiteEnabled(settings, url);
    const effectiveSite = getEffectiveSiteSettings(settings, url);
    root.innerHTML = markup({ settings, backendOnline, domain, unsupported, enabled, autoTranslate: effectiveSite.autoTranslate, selfTestSummary });
    bind({ unsupported, enabled });
  };

  const ensureActiveTabContentScript = async (): Promise<void> => {
    if (!tab?.id || !tab.url || !isSiteEnabled(settings, tab.url)) return;
    try {
      await (deps.ensureContentScript ?? deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
    } catch {
      // Keep popup responsive. Page commands still attempt a lazy injection fallback
      // and will surface command-specific failures if injection is impossible.
    }
  };

  const refreshBackendStatus = async (): Promise<void> => {
    if (settings.runMode !== "backend") return;
    try { backendOnline = await (deps.checkBackend ?? defaultCheckBackend)(settings.backendUrl); }
    catch { backendOnline = false; }
    render();
  };

  const persist = async (next: ExtensionSettings): Promise<void> => {
    settings = next;
    render();
    settings = await saveSettings(settings, storage);
  };

  const sendCommand = async (command: UmtContentCommandName, extra: Partial<UmtContentCommand> = {}): Promise<void> => {
    if (!tab?.id) return;
    const message: UmtContentCommand = { source: "umt-popup", command, ...extra };
    try {
      await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message);
    } catch (error) {
      if (!tab.url) throw error;
      const response = await (deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
      if (!response.ok) throw error;
      await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message);
    }
  };

  const bind = ({ unsupported, enabled }: { unsupported: boolean; enabled: boolean }): void => {
    root.querySelector<HTMLButtonElement>("[data-action='activate-site']")?.addEventListener("click", async () => {
      if (!tab?.id || !tab.url) return;
      const response = await (deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
      if (!response.ok) return;
      settings = enableSiteForUrl(settings, tab.url);
      settings = await saveSettings(settings, storage);
      render();
    });
    root.querySelector<HTMLSelectElement>("[data-field='run-mode']")?.addEventListener("change", (event) => {
      const runMode = (event.currentTarget as HTMLSelectElement).value === "backend" ? "backend" : "direct";
      backendOnline = null;
      selfTestSummary = "";
      void persist(normalizeSettings({ ...settings, runMode }));
      if (runMode === "backend") void refreshBackendStatus();
    });
    root.querySelector<HTMLButtonElement>("[data-action='self-test']")?.addEventListener("click", () => {
      selfTestSummary = buildSelfTestSummary(settings);
      render();
    });
    for (const field of DIRECT_CONFIG_FIELDS) {
      root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-field='${field}']`)?.addEventListener("change", () => {
        void persist(readDirectConfigFromDom(root, settings));
      });
    }
    root.querySelector<HTMLButtonElement>("[data-action='translate']")?.addEventListener("click", () => void sendCommand("translate"));
    root.querySelector<HTMLButtonElement>("[data-action='retranslate']")?.addEventListener("click", () => void sendCommand("retranslate"));
    root.querySelector<HTMLButtonElement>("[data-action='pause']")?.addEventListener("click", () => void sendCommand("togglePause"));
    root.querySelector<HTMLButtonElement>("[data-action='clear']")?.addEventListener("click", () => void sendCommand("clearPage"));
    root.querySelector<HTMLButtonElement>("[data-action='cancel']")?.addEventListener("click", () => void sendCommand("cancelQueue"));
    root.querySelector<HTMLButtonElement>("[data-action='select-region']")?.addEventListener("click", () => void sendCommand("selectRegion"));
    root.querySelector<HTMLInputElement>("[data-field='overlay-visible']")?.addEventListener("change", (event) => {
      const visible = (event.currentTarget as HTMLInputElement).checked;
      void persist(setTranslationOverlayVisible(settings, visible));
      void sendCommand("setOverlayVisibility", { visible });
    });
    root.querySelector<HTMLInputElement>("[data-field='auto-translate']")?.addEventListener("change", (event) => {
      if (!tab?.url) return;
      const autoTranslate = (event.currentTarget as HTMLInputElement).checked;
      const next = setSiteSettings(settings, tab.url, { autoTranslate });
      void persist(next);
      void sendCommand("applySiteSettings", { autoTranslate });
    });
    root.querySelector<HTMLInputElement>("[data-field='floating-button-enabled']")?.addEventListener("change", (event) => {
      const floatingButtonEnabled = (event.currentTarget as HTMLInputElement).checked;
      const next = normalizeSettings({ ...settings, floatingButtonEnabled });
      void persist(next);
      void sendCommand("applyWidgetSettings", { floatingButtonEnabled });
    });
    root.querySelector<HTMLInputElement>("[data-field='progress-widget-enabled']")?.addEventListener("change", (event) => {
      const progressWidgetEnabled = (event.currentTarget as HTMLInputElement).checked;
      const next = normalizeSettings({ ...settings, progressWidgetEnabled });
      void persist(next);
      void sendCommand("applyWidgetSettings", { progressWidgetEnabled });
    });
    root.querySelector<HTMLSelectElement>("[data-field='overlay-mask-shape']")?.addEventListener("change", (event) => {
      const next = normalizeSettings({ ...settings, overlayAppearance: { ...settings.overlayAppearance, maskShape: (event.currentTarget as HTMLSelectElement).value as never } });
      void persist(next);
      void sendCommand("applyOverlayAppearance", { appearance: next.overlayAppearance });
    });
    root.querySelector<HTMLButtonElement>("[data-action='reset-appearance']")?.addEventListener("click", () => {
      const next = normalizeSettings({ ...settings, overlayAppearance: DEFAULT_SETTINGS.overlayAppearance });
      void persist(next);
      void sendCommand("applyOverlayAppearance", { appearance: next.overlayAppearance });
    });
    for (const field of ["overlay-font-scale", "overlay-mask-scale", "overlay-ellipse-x", "overlay-ellipse-y", "overlay-opacity"] as const) {
      root.querySelector<HTMLInputElement>(`[data-field='${field}']`)?.addEventListener("input", (event) => {
        const key = field === "overlay-font-scale" ? "fontScale"
          : field === "overlay-mask-scale" ? "maskScale"
            : field === "overlay-ellipse-x" ? "ellipseX"
              : field === "overlay-ellipse-y" ? "ellipseY"
                : "opacity";
        const next = normalizeSettings({ ...settings, overlayAppearance: { ...settings.overlayAppearance, [key]: Number((event.currentTarget as HTMLInputElement).value) } });
        void persist(next);
        void sendCommand("applyOverlayAppearance", { appearance: next.overlayAppearance });
      });
    }
    if (unsupported || !enabled) root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-requires-enabled]").forEach((node) => { node.disabled = true; });
  };

  render();
  void ensureActiveTabContentScript();
  void refreshBackendStatus();
}

function markup(input: { settings: ExtensionSettings; backendOnline: boolean | null; domain: string | null; unsupported: boolean; enabled: boolean; autoTranslate: boolean; selfTestSummary: string }): string {
  const { settings, backendOnline, domain, unsupported, enabled, autoTranslate, selfTestSummary } = input;
  const status = unsupported ? TEXT.unsupported : enabled ? TEXT.enabled : TEXT.disabled;
  const directReady = Boolean(settings.directOcr.apiUrl && settings.directOcr.apiKeys.length && settings.directTranslator.baseUrl && settings.directTranslator.apiKey && settings.directTranslator.model);
  const healthClass = settings.runMode === "direct" ? directReady ? "ok" : "bad" : backendOnline === true ? "ok" : backendOnline === null ? "checking" : "bad";
  const healthText = settings.runMode === "direct" ? `${TEXT.directMode} · ${directReady ? TEXT.apiReady : TEXT.apiMissing}` : backendOnline === true ? TEXT.backendOk : backendOnline === null ? TEXT.backendChecking : TEXT.backendBad;
  const directStatus = `OCR ${settings.directOcr.apiKeys.length} key · ${escapeHtml(settings.directTranslator.model || "未选模型")}`;
  return `<style>${styles()}</style><section class="umt-popup">
    <header class="topbar"><div class="brand"><span class="logo">译</span><div><b>${TEXT.brand}</b><small>${escapeHtml(domain ?? "\u975e\u7f51\u9875")}</small></div></div><span class="health ${healthClass}">${healthText}</span></header>
    <main class="card site-card"><div><div class="site-state ${enabled ? "on" : "off"}">${status}</div><small>${enabled ? "此网站已允许插件运行" : "启用后才会在该网站注入功能"}</small></div>${!enabled && !unsupported ? `<button class="primary" data-action="activate-site">${TEXT.activate}</button>` : ""}</main>
    <section class="card mode-card"><label><span>运行模式</span><select data-field="run-mode"><option value="direct" ${settings.runMode === "direct" ? "selected" : ""}>${TEXT.directMode}</option><option value="backend" ${settings.runMode === "backend" ? "selected" : ""}>${TEXT.backendMode}</option></select></label><small>${settings.runMode === "direct" ? directStatus : escapeHtml(settings.backendUrl)}</small><button class="muted" data-action="self-test">${TEXT.selfTest}</button>${selfTestSummary ? `<div class="self-test">${escapeHtml(selfTestSummary)}</div>` : ""}</section>
    ${settings.runMode === "direct" ? directConfigMarkup(settings) : ""}
    <section class="card controls">
      <button class="primary wide" data-action="translate" data-requires-enabled>${TEXT.translate}</button>
      <button data-action="retranslate" data-requires-enabled>${TEXT.retranslate}</button>
      <button data-action="select-region" data-requires-enabled>${TEXT.select}</button>
      <button data-action="pause" data-requires-enabled>${TEXT.pause}</button>
      <button class="muted" data-action="clear" data-requires-enabled>${TEXT.clear}</button>
      <button class="danger" data-action="cancel" data-requires-enabled>${TEXT.cancel}</button>
    </section>
    <section class="card toggles"><b>${TEXT.switches}</b>
      ${toggle(TEXT.overlay, "overlay-visible", settings.translationOverlayVisible, true)}
      ${toggle(TEXT.auto, "auto-translate", autoTranslate, true)}
      ${toggle(TEXT.floatingButton, "floating-button-enabled", settings.floatingButtonEnabled, true)}
      ${toggle(TEXT.progressWidget, "progress-widget-enabled", settings.progressWidgetEnabled, true)}
    </section>
    <section class="card appearance" data-requires-enabled>
      <b>${TEXT.appearance}</b>
      <label><span>${TEXT.maskShape}</span><select data-field="overlay-mask-shape" data-requires-enabled>${shapeOptions(settings.overlayAppearance.maskShape)}</select></label>
      ${range(TEXT.fontScale, "overlay-font-scale", settings.overlayAppearance.fontScale, 0.75, 1.3)}
      ${range(TEXT.maskScale, "overlay-mask-scale", settings.overlayAppearance.maskScale, 0.2, 2)}
      ${range(TEXT.ellipseX, "overlay-ellipse-x", settings.overlayAppearance.ellipseX, 35, 55, 1)}
      ${range(TEXT.ellipseY, "overlay-ellipse-y", settings.overlayAppearance.ellipseY, 30, 55, 1)}
      ${range(TEXT.opacity, "overlay-opacity", settings.overlayAppearance.opacity, 0.35, 1)}
      <button class="muted wide" data-action="reset-appearance" data-requires-enabled>${TEXT.resetAppearance}</button>
    </section>
  </section>`;
}

function toggle(label: string, field: string, checked: boolean, requiresEnabled: boolean): string {
  return `<label class="toggle"><span>${label}</span><input data-field="${field}" ${requiresEnabled ? "data-requires-enabled" : ""} type="checkbox" ${checked ? "checked" : ""}></label>`;
}

function shapeOptions(selected: string): string {
  const items = [["auto", "自动"], ["ellipse", "椭圆"], ["rounded", "圆角"], ["transparent", "透明"]];
  return items.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function range(label: string, field: string, value: number, min: number, max: number, step = 0.05): string {
  return `<label class="range"><span>${label}<em>${value.toFixed(step >= 1 ? 0 : 2)}</em></span><input data-field="${field}" data-requires-enabled type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

const DIRECT_CONFIG_FIELDS = [
  "direct-ocr-url",
  "direct-ocr-keys",
  "direct-ocr-input-mode",
  "direct-ocr-image-field",
  "direct-translator-base-url",
  "direct-translator-api-key",
  "direct-translator-model",
  "direct-ocr-regions-paths",
  "direct-ocr-text-paths",
  "direct-ocr-box-paths",
  "direct-ocr-confidence-paths",
  "direct-ocr-static-fields",
] as const;

function directConfigMarkup(settings: ExtensionSettings): string {
  return `<details class="card direct-config" open>
    <summary>直连 API 配置</summary>
    <label><span>OCR API URL</span><input data-field="direct-ocr-url" type="url" placeholder="https://example.com/ocr" value="${escapeAttr(settings.directOcr.apiUrl)}"></label>
    <label><span>OCR API Keys</span><textarea data-field="direct-ocr-keys" rows="2" placeholder="一行一个 key">${escapeHtml(settings.directOcr.apiKeys.join("\n"))}</textarea></label>
    <div class="config-grid">
      <label><span>OCR 输入</span><select data-field="direct-ocr-input-mode"><option value="image_base64" ${settings.directOcr.inputMode === "image_base64" ? "selected" : ""}>image_base64</option><option value="file" ${settings.directOcr.inputMode === "file" ? "selected" : ""}>file</option></select></label>
      <label><span>图片字段</span><input data-field="direct-ocr-image-field" value="${escapeAttr(settings.directOcr.imageField)}"></label>
    </div>
    <label><span>翻译 Base URL</span><input data-field="direct-translator-base-url" type="url" placeholder="https://api.openai.com/v1" value="${escapeAttr(settings.directTranslator.baseUrl)}"></label>
    <div class="config-grid">
      <label><span>翻译 API Key</span><input data-field="direct-translator-api-key" type="password" autocomplete="off" placeholder="sk-..." value="${escapeAttr(settings.directTranslator.apiKey)}"></label>
      <label><span>模型</span><input data-field="direct-translator-model" placeholder="gpt-5.4-mini" value="${escapeAttr(settings.directTranslator.model)}"></label>
    </div>
    <details class="advanced-config"><summary>高级字段映射</summary>
      <label><span>regionsPaths</span><textarea data-field="direct-ocr-regions-paths" rows="2">${escapeHtml(settings.directOcr.regionsPaths.join("\n"))}</textarea></label>
      <label><span>textPaths</span><textarea data-field="direct-ocr-text-paths" rows="2">${escapeHtml(settings.directOcr.textPaths.join("\n"))}</textarea></label>
      <label><span>boxPaths</span><textarea data-field="direct-ocr-box-paths" rows="2">${escapeHtml(settings.directOcr.boxPaths.join("\n"))}</textarea></label>
      <label><span>confidencePaths</span><textarea data-field="direct-ocr-confidence-paths" rows="2">${escapeHtml(settings.directOcr.confidencePaths.join("\n"))}</textarea></label>
      <label><span>staticFields JSON</span><textarea data-field="direct-ocr-static-fields" rows="2">${escapeHtml(settings.directOcr.staticFieldsText)}</textarea></label>
    </details>
  </details>`;
}

function readDirectConfigFromDom(root: HTMLElement, settings: ExtensionSettings): ExtensionSettings {
  const value = (field: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-field='${field}']`)?.value ?? "";
  return normalizeSettings({
    ...settings,
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
    },
    directTranslator: {
      baseUrl: value("direct-translator-base-url"),
      apiKey: value("direct-translator-api-key"),
      model: value("direct-translator-model"),
    },
  });
}

function splitLines(value: string): string[] {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function buildSelfTestSummary(settings: ExtensionSettings): string {
  if (settings.runMode === "backend") return "后端模式：请在桌面软件里查看完整自检。";
  const parts = [
    settings.directOcr.apiUrl && settings.directOcr.apiKeys.length ? `OCR 已配置（${settings.directOcr.apiKeys.length} 个）` : "OCR 未配置",
    settings.directTranslator.baseUrl && settings.directTranslator.apiKey && settings.directTranslator.model ? `翻译 API 已配置（${settings.directTranslator.model}）` : "翻译 API 未配置",
  ];
  return parts.join("；");
}

function styles(): string {
  return `.umt-popup{box-sizing:border-box;width:320px;max-height:600px;overflow:auto;padding:12px;background:linear-gradient(180deg,#fff7ed 0,#f8fbff 44px,#f8fbff 100%);color:#10223b;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.brand{display:flex;align-items:center;gap:8px}.logo{display:grid;place-items:center;width:32px;height:32px;border-radius:12px;background:linear-gradient(135deg,#ff7a1a,#ff4d00);color:#fff;font-weight:900;box-shadow:0 8px 18px rgba(255,96,20,.24)}header b{display:block;color:#172033;font-size:18px;line-height:1}header small{display:block;max-width:155px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;margin-top:3px}.health{border-radius:999px;padding:5px 8px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:800;white-space:nowrap}.health.ok{background:#dcfce7;color:#166534}.health.checking{background:#e0f2fe;color:#075985}.card{background:rgba(255,255,255,.95);border:1px solid #dbe6f3;border-radius:16px;padding:10px;margin:8px 0;box-shadow:0 8px 22px rgba(30,55,90,.08)}.site-card{display:flex;justify-content:space-between;align-items:center;gap:10px}.site-card small{color:#64748b}.site-state{font-weight:900;margin-bottom:3px}.site-state.on{color:#15803d}.site-state.off{color:#b45309}button{border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:8px 9px;cursor:pointer;font-weight:850;color:#10223b;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 14px rgba(15,23,42,.10)}.primary{background:linear-gradient(135deg,#ff7a1a,#ff4d00);border-color:#ff6a1a;color:#fff}.wide{grid-column:1/-1}.muted{background:#f8fafc;color:#475569}.danger{background:#fff1f2;border-color:#fecdd3;color:#be123c}.controls{display:grid;grid-template-columns:1fr 1fr;gap:7px}.toggles,.appearance,.mode-card,.direct-config,.advanced-config{display:grid;gap:9px}.toggles>b,.appearance>b,summary{font-size:13px;color:#0f172a;font-weight:900;cursor:pointer}.toggle{display:flex;align-items:center;justify-content:space-between;font-weight:800}.toggle input{width:34px;height:19px;accent-color:#ff6a1a}.appearance label,.mode-card label,.direct-config label,.advanced-config label{display:grid;gap:4px;font-weight:750}.appearance label>span,.range>span,.direct-config label>span{display:flex;justify-content:space-between;color:#334155}.appearance em{font-style:normal;color:#64748b}select,input[type=url],input[type=password],input:not([type]),textarea{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:7px;background:#fff;color:#10223b;font-weight:750}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.config-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}input[type=range]{width:100%;accent-color:#ff6a1a}button:disabled,input:disabled,select:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none}`;
}

async function queryActiveTab(deps: PopupDeps): Promise<PopupTab | null> {
  if (deps.queryActiveTab) return deps.queryActiveTab();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) return null;
  return { ...(typeof tab.id === "number" ? { id: tab.id } : {}), ...(typeof tab.url === "string" ? { url: tab.url } : {}) };
}

async function defaultCheckBackend(backendUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const response = await fetch(`${backendUrl}/health`, { cache: "no-store", signal: controller.signal });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultSendMessageToTab(tabId: number, message: UmtContentCommand): Promise<void> { await chrome.tabs.sendMessage(tabId, message); }
async function defaultActivateSite(tabId: number, url: string): Promise<UmtActivateSiteResponse> { return await chrome.runtime.sendMessage({ source: "umt-popup", command: "activateSite", tabId, url }); }
function escapeHtml(value: string): string { return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char); }
function escapeAttr(value: string): string { return escapeHtml(value); }

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountPopupPage(root);
  });
}




