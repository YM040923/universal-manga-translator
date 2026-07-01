import type { ApiResponse, ConfigStatusResponse } from "@umt/shared/protocol";
import {
  getEffectiveSiteSettings,
  loadSettings,
  saveSettings,
  setSiteSettings,
  type ExtensionSettings,
  type SettingsStorageArea,
  type SiteScope,
} from "../settings/settings.js";
import type { UmtContentCommand, UmtContentCommandName } from "../content/messages.js";

export interface PopupTab { id?: number; url?: string; }

export interface PopupDeps {
  storage?: SettingsStorageArea;
  queryActiveTab?: () => Promise<PopupTab | null>;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  configStatus?: (backendUrl: string) => Promise<ApiResponse<ConfigStatusResponse>>;
  sendMessageToTab?: (tabId: number, message: UmtContentCommand) => Promise<void> | void;
  openOptionsPage?: () => void;
}

const TEXT = {
  brand: "漫译",
  auto: "本站自动翻译",
  backendOk: "后端已连接",
  backendBad: "后端离线",
  unsupported: "当前页面不支持翻译控制",
  unsupportedPill: "不支持",
  wholeSite: "全站页面",
  similarPath: "仅与本页相似路径",
  target: "翻译至",
  model: "后端模型",
  provider: "提供商",
  range: "翻译图片范围",
  viewport: "窗口范围",
  fullPage: "整页",
  pretranslate: "预翻译下一页",
  floating: "悬浮翻译按钮",
  debug: "调试覆盖层",
  upload: "⇧ 上传翻译",
  later: "以后支持",
  translate: "翻译本页",
  selectRegion: "框选",
  retranslate: "重翻",
  refresh: "刷新显示",
  pause: "暂停",
  clear: "清理",
  confirm: "再点确认",
  settings: "设置",
};

const LANGUAGE_OPTIONS: Array<[string, string]> = [["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"]];

export async function mountPopupPage(root: HTMLElement, deps: PopupDeps = {}): Promise<void> {
  const storage = deps.storage;
  let settings = await loadSettings(storage);
  const tab = await queryActiveTab(deps);
  let backendOnline = false;
  let backendConfig: ConfigStatusResponse | null = null;
  try {
    backendOnline = await (deps.checkBackend ?? defaultCheckBackend)(settings.backendUrl);
    if (backendOnline) {
      const status = await (deps.configStatus ?? defaultConfigStatus)(settings.backendUrl);
      backendConfig = status.ok ? status : null;
    }
  } catch { backendOnline = false; backendConfig = null; }

  const render = (): void => {
    const site = getEffectiveSiteSettings(settings, tab?.url ?? "");
    root.innerHTML = markup(settings, site, backendOnline, backendConfig);
    bind(site.unsupported);
  };

  const persist = async (next: Partial<ExtensionSettings>): Promise<void> => {
    settings = { ...settings, ...next };
    render();
    settings = await saveSettings(settings, storage);
  };

  const persistSite = async (patch: { autoTranslate?: boolean; scope?: SiteScope }): Promise<void> => {
    if (!tab?.url) return;
    settings = setSiteSettings(settings, tab.url, patch);
    render();
    settings = await saveSettings(settings, storage);
  };

  const sendCommand = async (command: UmtContentCommandName): Promise<void> => {
    if (!tab?.id) return;
    await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, { source: "umt-popup", command });
  };

  const bind = (unsupported: boolean): void => {
    root.querySelector<HTMLButtonElement>("[data-action='options']")?.addEventListener("click", () => (deps.openOptionsPage ?? defaultOpenOptionsPage)());
    root.querySelector<HTMLInputElement>("[data-field='site-auto']")?.addEventListener("change", (event) => void persistSite({ autoTranslate: (event.currentTarget as HTMLInputElement).checked }));
    root.querySelector<HTMLButtonElement>("[data-action='scope-origin']")?.addEventListener("click", () => void persistSite({ scope: "origin" }));
    root.querySelector<HTMLButtonElement>("[data-action='scope-similarPath']")?.addEventListener("click", () => void persistSite({ scope: "similarPath" }));
    root.querySelector<HTMLSelectElement>("[data-field='target-language']")?.addEventListener("change", (event) => void persist({ targetLanguage: (event.currentTarget as HTMLSelectElement).value }));
    root.querySelector<HTMLButtonElement>("[data-action='range-viewport']")?.addEventListener("click", () => void persist({ imageRange: "viewport" }));
    root.querySelector<HTMLButtonElement>("[data-action='range-fullPage']")?.addEventListener("click", () => void persist({ imageRange: "fullPage" }));
    root.querySelector<HTMLInputElement>("[data-field='pretranslate']")?.addEventListener("change", (event) => void persist({ pretranslateNextPage: (event.currentTarget as HTMLInputElement).checked }));
    root.querySelector<HTMLInputElement>("[data-field='floating-button']")?.addEventListener("change", (event) => void persist({ floatingButtonEnabled: (event.currentTarget as HTMLInputElement).checked }));
    root.querySelector<HTMLInputElement>("[data-field='debug-overlay']")?.addEventListener("change", (event) => void persist({ debugOverlayEnabled: (event.currentTarget as HTMLInputElement).checked }));
    root.querySelector<HTMLButtonElement>("[data-action='translate']")?.addEventListener("click", () => void sendCommand("translate"));
    root.querySelector<HTMLButtonElement>("[data-action='select-region']")?.addEventListener("click", () => void sendCommand("selectRegion"));
    root.querySelector<HTMLButtonElement>("[data-action='retranslate']")?.addEventListener("click", () => void sendCommand("retranslate"));
    root.querySelector<HTMLButtonElement>("[data-action='refresh']")?.addEventListener("click", () => void sendCommand("refresh"));
    root.querySelector<HTMLButtonElement>("[data-action='pause']")?.addEventListener("click", () => void sendCommand("togglePause"));
    root.querySelector<HTMLButtonElement>("[data-action='clear']")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (button.dataset.confirm === "true") { void sendCommand("clearPage"); button.dataset.confirm = "false"; button.textContent = TEXT.clear; }
      else { button.dataset.confirm = "true"; button.textContent = TEXT.confirm; }
    });
    if (unsupported) root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("[data-site-control]").forEach((node) => { node.disabled = true; });
  };

  render();
}

function markup(settings: ExtensionSettings, site: ReturnType<typeof getEffectiveSiteSettings>, backendOnline: boolean, backendConfig: ConfigStatusResponse | null): string {
  const siteStatus = site.unsupported ? TEXT.unsupportedPill : site.autoTranslate ? "ON" : "OFF";
  const model = backendConfig?.openAICompatible.model || backendConfig?.providerProfile || (backendOnline ? "后端未返回模型" : "后端离线");
  const provider = backendConfig?.provider ?? (backendOnline ? "unknown" : "offline");
  return `
    <style>${styles()}</style>
    <section class="umt-popup" data-density="compact">
      <header class="header">
        <div><div class="brand">${TEXT.brand}</div><div class="subtitle">Universal Manga Translator</div></div>
        <div class="header-actions"><span class="health ${backendOnline ? "ok" : "bad"}">${backendOnline ? TEXT.backendOk : TEXT.backendBad}</span><button data-action="options" title="${TEXT.settings}">&#9881;</button></div>
      </header>
      <section class="card site-card">
        <div class="row strong"><span>${TEXT.auto} <b class="pill">${siteStatus}</b></span><label class="switch"><input data-field="site-auto" data-site-control type="checkbox" ${site.autoTranslate ? "checked" : ""}><span></span></label></div>
        <div class="segmented"><button data-action="scope-origin" data-site-control class="${site.scope === "origin" ? "active" : ""}">${TEXT.wholeSite}</button><button data-action="scope-similarPath" data-site-control class="${site.scope === "similarPath" ? "active" : ""}">${TEXT.similarPath}</button></div>
        ${site.unsupported ? `<div class="unsupported-note">${TEXT.unsupported}</div>` : ""}
      </section>
      <section class="card settings-card">
        ${selectRow(TEXT.target, "target-language", settings.targetLanguage, LANGUAGE_OPTIONS)}
        <div class="row readonly-row"><span>${TEXT.model}</span><b>${escapeHtml(model)}</b></div>
        <div class="row readonly-row"><span>${TEXT.provider}</span><b>${escapeHtml(provider)}</b></div>
        <div class="row compact-row"><span>${TEXT.range}</span><div class="segmented compact"><button data-action="range-viewport" class="${settings.imageRange === "viewport" ? "active" : ""}">${TEXT.viewport}</button><button data-action="range-fullPage" class="${settings.imageRange === "fullPage" ? "active" : ""}">${TEXT.fullPage}</button></div></div>
        <div class="toggle-grid" data-section="quick-toggles">${toggleRow(TEXT.pretranslate, "pretranslate", settings.pretranslateNextPage)}${toggleRow(TEXT.floating, "floating-button", settings.floatingButtonEnabled)}${toggleRow(TEXT.debug, "debug-overlay", settings.debugOverlayEnabled)}</div>
      </section>
      <section class="card upload disabled"><span>${TEXT.upload}</span><span>${TEXT.later}</span></section>
      <footer class="actions compact-actions"><button data-action="translate">${TEXT.translate}</button><button data-action="select-region">${TEXT.selectRegion}</button><button data-action="retranslate">${TEXT.retranslate}</button><button data-action="refresh">${TEXT.refresh}</button><button data-action="pause">${TEXT.pause}</button><button data-action="clear" title="${TEXT.clear}">${TEXT.clear}</button></footer>
    </section>`;
}

function selectRow(label: string, field: string, value: string, options: Array<[string, string]>): string {
  return `<label class="row"><span>${label}</span><select data-field="${field}">${options.map(([optionValue, text]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}

function toggleRow(label: string, field: string, checked: boolean): string {
  return `<label class="row"><span>${label}</span><span class="switch"><input data-field="${field}" type="checkbox" ${checked ? "checked" : ""}><span></span></span></label>`;
}

function styles(): string {
  return `.umt-popup{box-sizing:border-box;width:350px;padding:10px;background:linear-gradient(180deg,#f8fbff,#eef5fb);color:#071833}.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.brand{font-size:20px;font-weight:900;color:#ff6a1a}.subtitle{font-size:10px;color:#607086}.header-actions{display:flex;gap:6px;align-items:center}.header button,.actions button,.segmented button{border:1px solid #c8d5e5;background:#fff;border-radius:10px;padding:6px 9px;color:#10223b;box-shadow:0 1px 5px rgba(30,55,90,.07);cursor:pointer}.health{font-size:11px;border-radius:999px;padding:4px 7px;background:#e8eef6;color:#52657d}.health.ok{background:#e9f8ef;color:#19703b}.health.bad{background:#fff1ed;color:#b64215}.card{background:rgba(255,255,255,.94);border:1px solid #cbd8e8;border-radius:14px;margin:8px 0;box-shadow:0 5px 16px rgba(25,54,89,.08);overflow:hidden}.site-card{padding:10px}.unsupported-note{font-size:12px;color:#b64215;margin-top:7px;font-weight:700}.row{min-height:38px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #e3ebf4;font-size:13px}.row:last-child{border-bottom:0}.readonly-row b{font-size:12px;max-width:178px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#0f172a}.strong{font-size:16px;font-weight:900;border-bottom:0;padding:0 0 9px}.pill{font-size:11px;color:#61738a;background:#eef3f8;border-radius:999px;padding:4px 9px;margin-left:6px}.segmented{display:grid;grid-template-columns:1fr 1.25fr;gap:6px;align-items:center}.segmented.compact{display:flex;gap:0;background:#edf3f9;border:1px solid #c8d5e5;border-radius:999px;padding:2px}.segmented.compact button{box-shadow:none;border:0;border-radius:999px;background:transparent;padding:5px 8px}.segmented button.active{border-color:#ff7a1a;color:#d84f00;background:#fff7f1}.segmented.compact button.active{background:#ff6a1a;color:#fff}.settings-card select{max-width:154px}.compact-row{min-height:36px}select{min-width:138px;border:1px solid #bdcbe0;border-radius:10px;background:#f8fbff;padding:6px 8px}.switch{position:relative;display:inline-flex}.switch input{position:absolute;opacity:0}.switch span{width:42px;height:24px;border-radius:999px;background:#c8d2df;display:block;position:relative}.switch span::after{content:"";position:absolute;width:20px;height:20px;left:2px;top:2px;background:#fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.18);transition:.15s}.switch input:checked+span{background:#ff6a1a}.switch input:checked+span::after{transform:translateX(18px)}.toggle-grid{display:grid;grid-template-columns:1fr 1fr 1fr}.toggle-grid .row{border-bottom:0}.upload{padding:10px 12px;display:flex;justify-content:space-between;font-size:13px;font-weight:800}.upload.disabled{color:#607086}.actions{display:grid;grid-template-columns:1fr .65fr .65fr .8fr .65fr 42px;gap:5px;margin-top:8px}.actions button:first-child{background:#ff6a1a;color:#fff;border-color:#ff6a1a;font-weight:900}button:disabled,select:disabled,input:disabled+span{opacity:.55;cursor:not-allowed}`;
}

async function queryActiveTab(deps: PopupDeps): Promise<PopupTab | null> {
  if (deps.queryActiveTab) return deps.queryActiveTab();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) return null;
  const result: PopupTab = {};
  if (typeof tab.id === "number") result.id = tab.id;
  if (typeof tab.url === "string") result.url = tab.url;
  return result;
}

async function defaultCheckBackend(backendUrl: string): Promise<boolean> {
  const response = await fetch(`${backendUrl}/health`, { cache: "no-store" });
  return response.ok;
}

async function defaultConfigStatus(backendUrl: string): Promise<ApiResponse<ConfigStatusResponse>> {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/v1/config/status`, { cache: "no-store" });
  return (await response.json()) as ApiResponse<ConfigStatusResponse>;
}

async function defaultSendMessageToTab(tabId: number, message: UmtContentCommand): Promise<void> { await chrome.tabs.sendMessage(tabId, message); }
function defaultOpenOptionsPage(): void { chrome.runtime.openOptionsPage(); }
function escapeHtml(value: string): string { return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char); }

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountPopupPage(root);
  });
}
