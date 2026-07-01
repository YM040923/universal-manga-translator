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

export interface PopupTab {
  id?: number;
  url?: string;
}

export interface PopupDeps {
  storage?: SettingsStorageArea;
  queryActiveTab?: () => Promise<PopupTab | null>;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  sendMessageToTab?: (tabId: number, message: UmtContentCommand) => Promise<void> | void;
  openOptionsPage?: () => void;
}

const TEXT = {
  brand: "\u6f2b\u8bd1",
  auto: "\u672c\u7ad9\u81ea\u52a8\u7ffb\u8bd1",
  backendOk: "\u540e\u7aef\u5df2\u8fde\u63a5",
  backendBad: "\u540e\u7aef\u79bb\u7ebf",
  unsupported: "\u5f53\u524d\u9875\u9762\u4e0d\u652f\u6301\u7ffb\u8bd1\u63a7\u5236",
  unsupportedPill: "\u4e0d\u652f\u6301",
  wholeSite: "\u5168\u7ad9\u9875\u9762",
  similarPath: "\u4ec5\u4e0e\u672c\u9875\u76f8\u4f3c\u8def\u5f84",
  currentScope: "\u5f53\u524d\u8303\u56f4\uff1a",
  target: "\u7ffb\u8bd1\u81f3",
  model: "\u7ffb\u8bd1\u6a21\u578b",
  range: "\u7ffb\u8bd1\u56fe\u7247\u8303\u56f4",
  viewport: "\u7a97\u53e3\u8303\u56f4",
  fullPage: "\u6574\u9875",
  pretranslate: "\u9884\u7ffb\u8bd1\u4e0b\u4e00\u9875",
  pretranslateNote: "\u9884\u7ffb\u8bd1\u4f1a\u6d88\u8017\u70b9\u6570",
  floating: "\u60ac\u6d6e\u7ffb\u8bd1\u6309\u94ae",
  upload: "\u21e7 \u4e0a\u4f20\u7ffb\u8bd1",
  later: "\u4ee5\u540e\u652f\u6301",
  translate: "\u7ffb\u8bd1\u672c\u9875",
  refresh: "\u5237\u65b0\u663e\u793a",
  pause: "\u6682\u505c",
  clear: "\u6e05\u7406",
  confirm: "\u518d\u70b9\u786e\u8ba4",
  settings: "\u8bbe\u7f6e",
};

const LANGUAGE_OPTIONS: Array<[string, string]> = [
  ["zh-CN", "\u7b80\u4f53\u4e2d\u6587"],
  ["zh-TW", "\u7e41\u9ad4\u4e2d\u6587"],
  ["en", "English"],
  ["ja", "\u65e5\u672c\u8a9e"],
  ["ko", "\ud55c\uad6d\uc5b4"],
];

const MODEL_OPTIONS: Array<[string, string]> = [
  ["mock", "Mock / local test"],
  ["gpt-4o-mini", "GPT-4o mini"],
  ["gpt-4.1-mini", "GPT-4.1 mini"],
  ["custom", "Custom backend default"],
];

export async function mountPopupPage(root: HTMLElement, deps: PopupDeps = {}): Promise<void> {
  const storage = deps.storage;
  let settings = await loadSettings(storage);
  const tab = await queryActiveTab(deps);
  let backendOnline = false;
  try {
    backendOnline = await (deps.checkBackend ?? defaultCheckBackend)(settings.backendUrl);
  } catch {
    backendOnline = false;
  }

  const render = (): void => {
    const site = getEffectiveSiteSettings(settings, tab?.url ?? "");
    root.innerHTML = markup(settings, site, backendOnline);
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
    root.querySelector<HTMLSelectElement>("[data-field='translation-model']")?.addEventListener("change", (event) => void persist({ translationModel: (event.currentTarget as HTMLSelectElement).value }));
    root.querySelector<HTMLButtonElement>("[data-action='range-viewport']")?.addEventListener("click", () => void persist({ imageRange: "viewport" }));
    root.querySelector<HTMLButtonElement>("[data-action='range-fullPage']")?.addEventListener("click", () => void persist({ imageRange: "fullPage" }));
    root.querySelector<HTMLInputElement>("[data-field='pretranslate']")?.addEventListener("change", (event) => void persist({ pretranslateNextPage: (event.currentTarget as HTMLInputElement).checked }));
    root.querySelector<HTMLInputElement>("[data-field='floating-button']")?.addEventListener("change", (event) => void persist({ floatingButtonEnabled: (event.currentTarget as HTMLInputElement).checked }));
    root.querySelector<HTMLButtonElement>("[data-action='translate']")?.addEventListener("click", () => void sendCommand("translate"));
    root.querySelector<HTMLButtonElement>("[data-action='refresh']")?.addEventListener("click", () => void sendCommand("refresh"));
    root.querySelector<HTMLButtonElement>("[data-action='pause']")?.addEventListener("click", () => void sendCommand("togglePause"));
    root.querySelector<HTMLButtonElement>("[data-action='clear']")?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (button.dataset.confirm === "true") {
        void sendCommand("clearPage");
        button.dataset.confirm = "false";
        button.textContent = TEXT.clear;
      } else {
        button.dataset.confirm = "true";
        button.textContent = TEXT.confirm;
      }
    });
    if (unsupported) {
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("[data-site-control]").forEach((node) => { node.disabled = true; });
    }
  };

  render();
}

function markup(settings: ExtensionSettings, site: ReturnType<typeof getEffectiveSiteSettings>, backendOnline: boolean): string {
  const siteStatus = site.unsupported ? TEXT.unsupportedPill : site.autoTranslate ? "ON" : "OFF";
  return `
    <style>${styles()}</style>
    <section class="umt-popup">
      <header class="header">
        <div><div class="brand">${TEXT.brand}</div><div class="subtitle">Universal Manga Translator</div></div>
        <div class="header-actions"><span class="health ${backendOnline ? "ok" : "bad"}">${backendOnline ? TEXT.backendOk : TEXT.backendBad}</span><button data-action="options" title="${TEXT.settings}">⚙</button></div>
      </header>
      <section class="card site-card">
        <div class="row strong"><span>${TEXT.auto} <b class="pill">${siteStatus}</b></span><label class="switch"><input data-field="site-auto" data-site-control type="checkbox" ${site.autoTranslate ? "checked" : ""}><span></span></label></div>
        <div class="segmented"><button data-action="scope-origin" data-site-control class="${site.scope === "origin" ? "active" : ""}">${TEXT.wholeSite}</button><button data-action="scope-similarPath" data-site-control class="${site.scope === "similarPath" ? "active" : ""}">${TEXT.similarPath}</button></div>
        <p class="hint">${site.unsupported ? TEXT.unsupported : `${TEXT.currentScope}${escapeHtml(site.origin)}${escapeHtml(site.pathPrefix)}`}</p>
      </section>
      <section class="card settings-card">
        ${selectRow(TEXT.target, "target-language", settings.targetLanguage, LANGUAGE_OPTIONS)}
        ${selectRow(TEXT.model, "translation-model", settings.translationModel, MODEL_OPTIONS)}
        <div class="row"><span>${TEXT.range}</span><div class="segmented compact"><button data-action="range-viewport" class="${settings.imageRange === "viewport" ? "active" : ""}">${TEXT.viewport}</button><button data-action="range-fullPage" class="${settings.imageRange === "fullPage" ? "active" : ""}">${TEXT.fullPage}</button></div></div>
        ${toggleRow(TEXT.pretranslate, "pretranslate", settings.pretranslateNextPage, TEXT.pretranslateNote)}
        ${toggleRow(TEXT.floating, "floating-button", settings.floatingButtonEnabled)}
      </section>
      <section class="card upload disabled"><span>${TEXT.upload}</span><span>${TEXT.later}</span></section>
      <footer class="actions"><button data-action="translate">${TEXT.translate}</button><button data-action="refresh">${TEXT.refresh}</button><button data-action="pause">${TEXT.pause}</button><button data-action="clear">${TEXT.clear}</button></footer>
    </section>`;
}

function selectRow(label: string, field: string, value: string, options: Array<[string, string]>): string {
  return `<label class="row"><span>${label}</span><select data-field="${field}">${options.map(([optionValue, text]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}

function toggleRow(label: string, field: string, checked: boolean, note = ""): string {
  return `<label class="row"><span>${label}${note ? `<small>${note}</small>` : ""}</span><span class="switch"><input data-field="${field}" type="checkbox" ${checked ? "checked" : ""}><span></span></span></label>`;
}

function styles(): string {
  return `.umt-popup{box-sizing:border-box;width:390px;padding:18px;background:linear-gradient(180deg,#f8fbff,#eef5fb);color:#071833}.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.brand{font-size:28px;font-weight:900;color:#ff6a1a}.subtitle{font-size:12px;color:#607086}.header-actions{display:flex;gap:8px;align-items:center}.header button,.actions button,.segmented button{border:1px solid #c8d5e5;background:#fff;border-radius:14px;padding:9px 12px;color:#10223b;box-shadow:0 2px 8px rgba(30,55,90,.08);cursor:pointer}.health{font-size:12px;border-radius:999px;padding:6px 9px;background:#e8eef6;color:#52657d}.health.ok{background:#e9f8ef;color:#19703b}.health.bad{background:#fff1ed;color:#b64215}.card{background:rgba(255,255,255,.92);border:1px solid #cbd8e8;border-radius:18px;margin:12px 0;box-shadow:0 8px 22px rgba(25,54,89,.09);overflow:hidden}.site-card{padding:18px}.row{min-height:56px;padding:13px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid #e3ebf4}.row:last-child{border-bottom:0}.strong{font-size:22px;font-weight:900;border-bottom:0;padding:8px 0 18px}.pill{font-size:13px;color:#61738a;background:#eef3f8;border-radius:999px;padding:7px 14px;margin-left:10px}.segmented{display:flex;gap:10px;align-items:center}.segmented.compact{gap:0;background:#edf3f9;border:1px solid #c8d5e5;border-radius:999px;padding:4px}.segmented.compact button{box-shadow:none;border:0;border-radius:999px;background:transparent}.segmented button.active{border-color:#ff7a1a;color:#d84f00;background:#fff7f1}.segmented.compact button.active{background:#ff6a1a;color:#fff}.hint{margin:14px 0 0;color:#8a3a17;font-weight:700}select{min-width:150px;border:1px solid #bdcbe0;border-radius:14px;background:#f8fbff;padding:9px 12px}.switch{position:relative;display:inline-flex}.switch input{position:absolute;opacity:0}.switch span{width:54px;height:30px;border-radius:999px;background:#c8d2df;display:block;position:relative}.switch span::after{content:"";position:absolute;width:24px;height:24px;left:3px;top:3px;background:#fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.18);transition:.15s}.switch input:checked+span{background:#ff6a1a}.switch input:checked+span::after{transform:translateX(24px)}small{display:block;color:#708096;font-size:12px;font-weight:500;margin-top:2px}.upload{padding:14px 16px;display:flex;justify-content:space-between;font-weight:800}.upload.disabled{color:#607086}.actions{display:grid;grid-template-columns:1.4fr 1.4fr 1fr 1fr;gap:8px;margin-top:12px}.actions button:first-child{background:#ff6a1a;color:#fff;border-color:#ff6a1a;font-weight:900}button:disabled,select:disabled,input:disabled+span{opacity:.55;cursor:not-allowed}`;
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

async function defaultSendMessageToTab(tabId: number, message: UmtContentCommand): Promise<void> {
  await chrome.tabs.sendMessage(tabId, message);
}

function defaultOpenOptionsPage(): void {
  chrome.runtime.openOptionsPage();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountPopupPage(root);
  });
}