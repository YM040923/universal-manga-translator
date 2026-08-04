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
} from "../settings/settings.js";
import type { UmtActivateSiteResponse, UmtContentCommand, UmtContentCommandName, UmtContentCommandResponse, UmtPageRuntimeSnapshot } from "../content/messages.js";
import { readDirectConfigFromDom } from "./config-form.js";
import { runSelfTest } from "./self-test.js";
import { popupStyles } from "./styles.js";
import type { PopupDeps, PopupTab } from "./types.js";
export type { PopupDeps, PopupTab } from "./types.js";

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

type PageActionFeedback = {
  operation: "competing" | "cancel";
  command: UmtContentCommandName;
  revision: number;
  kind: "pending" | "success" | "error";
  text: string;
};

type PopupPageAction = "translate" | "retranslate" | "pause" | "clear" | "cancel" | "select-region";

type PopupFocusTarget = {
  attribute: "data-action" | "data-field";
  value: string;
};

export async function mountPopupPage(root: HTMLElement, deps: PopupDeps = {}): Promise<void> {
  const storage = deps.storage;
  let settings = await loadSettings(storage);
  const tab = await queryActiveTab(deps);
  let backendOnline: boolean | null = null;
  let selfTestSummary = "";
  let competingPageActionBusy = false;
  let cancelBusy = false;
  let pageActionFeedback: PageActionFeedback | null = null;
  let cancelActionFeedback: PageActionFeedback | null = null;
  let pageActionFeedbackRevision = 0;
  let pageRuntimeState: UmtPageRuntimeSnapshot | null = null;
  let view: "main" | "api" = "main";

  const render = (options: { preserveScroll?: boolean; focusTarget?: PopupFocusTarget } = {}): void => {
    const url = tab?.url ?? "";
    const domain = primaryDomainFromUrl(url);
    const unsupported = !domain || !tab?.id;
    const enabled = !unsupported && isSiteEnabled(settings, url);
    const effectiveSite = getEffectiveSiteSettings(settings, url);
    const previousScrollTop = options.preserveScroll === false ? 0 : root.querySelector<HTMLElement>(".umt-popup")?.scrollTop ?? 0;
    root.innerHTML = markup({
      settings,
      backendOnline,
      domain,
      unsupported,
      enabled,
      autoTranslate: effectiveSite.autoTranslate,
      selfTestSummary,
      pageRuntimeState,
      pageActionFeedback: selectPageActionFeedback(pageActionFeedback, cancelActionFeedback, cancelBusy),
      view,
    });
    bind({ unsupported, enabled });
    const focusTarget = options.focusTarget ? findPopupFocusTarget(root, options.focusTarget) : null;
    if (focusTarget && !focusTarget.hasAttribute("disabled")) focusTarget.focus();
    const popup = root.querySelector<HTMLElement>(".umt-popup");
    if (popup) popup.scrollTop = previousScrollTop;
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

  const sendCommand = async (command: UmtContentCommandName, extra: Partial<UmtContentCommand> = {}): Promise<unknown> => {
    if (!tab?.id) return;
    const message: UmtContentCommand = { source: "umt-popup", command, ...extra };
    try {
      return await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message);
    } catch (error) {
      if (!tab.url) throw error;
      const response = await (deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
      if (!response.ok) throw error;
      return await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message);
    }
  };

  const runPageAction = async (action: PopupPageAction, label: string, command: UmtContentCommandName, kind: "competing" | "cancel" = "competing"): Promise<void> => {
    if (kind === "cancel" ? cancelBusy : competingPageActionBusy || cancelBusy) return;
    const restoreFocusedAction = kind === "competing" && root.ownerDocument.activeElement?.getAttribute("data-action") === action;
    const feedback = (state: PageActionFeedback["kind"], text: string): PageActionFeedback => ({
      operation: kind,
      command,
      revision: ++pageActionFeedbackRevision,
      kind: state,
      text,
    });
    if (kind === "cancel") {
      if (!competingPageActionBusy) pageActionFeedback = null;
      cancelBusy = true;
      cancelActionFeedback = feedback("pending", `正在发送“${label}”…`);
    } else {
      competingPageActionBusy = true;
      cancelActionFeedback = null;
      pageActionFeedback = feedback("pending", `正在发送“${label}”…`);
    }
    render(restoreFocusedAction ? { focusTarget: { attribute: "data-action", value: "cancel" } } : {});
    try {
      const response = await sendCommand(command);
      const commandError = readPageRuntimeError(response);
      if (commandError) throw new Error(commandError);
      pageRuntimeState = readPageRuntimeState(response) ?? pageRuntimeState;
      const result = feedback("success", pageRuntimeState ? `${label}：${pageRuntimeActionSummary(pageRuntimeState)}` : `${label}已接收，页面会显示实际进度。`);
      if (kind === "cancel") cancelActionFeedback = result;
      else pageActionFeedback = result;
    } catch (error) {
      const result = feedback("error", `${label}失败：${pageActionErrorMessage(error)}`);
      if (kind === "cancel") cancelActionFeedback = result;
      else pageActionFeedback = result;
    } finally {
      const activeFocusTarget = restoreFocusedAction ? readPopupFocusTarget(root) : null;
      const completionFocusTarget = activeFocusTarget && !(activeFocusTarget.attribute === "data-action" && activeFocusTarget.value === "cancel")
        ? activeFocusTarget
        : { attribute: "data-action" as const, value: action };
      if (kind === "cancel") cancelBusy = false;
      else competingPageActionBusy = false;
      render(restoreFocusedAction ? { focusTarget: completionFocusTarget } : {});
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
    root.querySelector<HTMLButtonElement>("[data-action='open-api-settings']")?.addEventListener("click", () => { view = "api"; selfTestSummary = ""; render({ preserveScroll: false }); });
    root.querySelector<HTMLButtonElement>("[data-action='back-main']")?.addEventListener("click", () => { view = "main"; selfTestSummary = ""; render({ preserveScroll: false }); });
    root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")?.addEventListener("click", () => {
      const next = readDirectConfigFromDom(root, settings);
      backendOnline = null;
      selfTestSummary = "已保存 API 设置";
      void persist(next);
      if (next.runMode === "backend") void refreshBackendStatus();
    });
    root.querySelector<HTMLButtonElement>("[data-action='self-test']")?.addEventListener("click", () => {
      selfTestSummary = "正在自检…";
      render();
      void runSelfTest(readDirectConfigFromDom(root, settings), deps, tab, enabled).then((summary) => {
        selfTestSummary = summary;
        render();
      });
    });
    root.querySelector<HTMLButtonElement>("[data-action='translate']")?.addEventListener("click", () => void runPageAction("translate", TEXT.translate, "translate"));
    root.querySelector<HTMLButtonElement>("[data-action='retranslate']")?.addEventListener("click", () => void runPageAction("retranslate", TEXT.retranslate, "retranslateVisible"));
    root.querySelector<HTMLButtonElement>("[data-action='pause']")?.addEventListener("click", () => void runPageAction("pause", TEXT.pause, "togglePause"));
    root.querySelector<HTMLButtonElement>("[data-action='clear']")?.addEventListener("click", () => void runPageAction("clear", TEXT.clear, "clearPage"));
    root.querySelector<HTMLButtonElement>("[data-action='cancel']")?.addEventListener("click", () => void runPageAction("cancel", TEXT.cancel, "cancelQueue", "cancel"));
    root.querySelector<HTMLButtonElement>("[data-action='select-region']")?.addEventListener("click", () => void runPageAction("select-region", TEXT.select, "selectRegion"));
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
    if (competingPageActionBusy || cancelBusy) root.querySelectorAll<HTMLButtonElement>("[data-page-action]:not([data-action='cancel'])").forEach((node) => { node.disabled = true; });
    if (cancelBusy) root.querySelector<HTMLButtonElement>("[data-action='cancel']")!.disabled = true;
    if (unsupported || !enabled) root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-requires-enabled]").forEach((node) => { node.disabled = true; });
  };

  render();
  void ensureActiveTabContentScript();
  void refreshBackendStatus();
}

function markup(input: { settings: ExtensionSettings; backendOnline: boolean | null; domain: string | null; unsupported: boolean; enabled: boolean; autoTranslate: boolean; selfTestSummary: string; pageActionFeedback: PageActionFeedback | null; pageRuntimeState: UmtPageRuntimeSnapshot | null; view: "main" | "api" }): string {
  const { settings, backendOnline, domain, unsupported, enabled, autoTranslate, selfTestSummary, pageActionFeedback, pageRuntimeState, view } = input;
  const status = unsupported ? TEXT.unsupported : enabled ? TEXT.enabled : TEXT.disabled;
  const directReady = Boolean(settings.directOcr.apiUrl && settings.directOcr.apiKeys.length && settings.directTranslator.baseUrl && settings.directTranslator.apiKey && settings.directTranslator.model);
  const healthClass = settings.runMode === "direct" ? directReady ? "ok" : "bad" : backendOnline === true ? "ok" : backendOnline === null ? "checking" : "bad";
  const healthText = settings.runMode === "direct" ? `${TEXT.directMode} · ${directReady ? TEXT.apiReady : TEXT.apiMissing}` : backendOnline === true ? TEXT.backendOk : backendOnline === null ? TEXT.backendChecking : TEXT.backendBad;
  const directStatus = `OCR ${settings.directOcr.apiKeys.length} key · ${escapeHtml(settings.directTranslator.model || "未选模型")}`;
  if (view === "api") return `<style>${popupStyles()}</style><section class="umt-popup">
    <header class="topbar"><div class="brand"><span class="logo">译</span><div><b>API 设置</b><small>${escapeHtml(domain ?? "非网页")}</small></div></div><button class="muted" data-action="back-main">返回</button></header>
    ${apiSettingsMarkup(settings, selfTestSummary)}
  </section>`;
  return `<style>${popupStyles()}</style><section class="umt-popup">
    <header class="topbar"><div class="brand"><span class="logo">译</span><div><b>${TEXT.brand}</b><small>${escapeHtml(domain ?? "非网页")}</small></div></div><span class="health ${healthClass}">${healthText}</span></header>
    <main class="card site-card"><div><div class="site-state ${enabled ? "on" : "off"}">${status}</div><small>${enabled ? "此网站已允许插件运行" : "启用后才会在该网站注入功能"}</small></div>${!enabled && !unsupported ? `<button class="primary" data-action="activate-site">${TEXT.activate}</button>` : ""}</main>
    <section class="card mode-card"><b>运行与 API</b><small>${settings.runMode === "direct" ? directStatus : escapeHtml(settings.backendUrl)}</small><button class="muted wide" data-action="open-api-settings">API 设置 / 自检</button></section>
    <section class="card controls">
      <button class="primary wide" data-action="translate" data-page-action data-requires-enabled>${TEXT.translate}</button>
      <button data-action="retranslate" data-page-action data-requires-enabled>${TEXT.retranslate}</button>
      <button data-action="select-region" data-page-action data-requires-enabled>${TEXT.select}</button>
      <button data-action="pause" data-page-action data-requires-enabled>${TEXT.pause}</button>
      <button class="muted" data-action="clear" data-page-action data-requires-enabled>${TEXT.clear}</button>
      <button class="danger" data-action="cancel" data-page-action data-requires-enabled>${TEXT.cancel}</button>
      ${pageActionFeedback ? `<div class="action-feedback ${pageActionFeedback.kind}" data-action-feedback role="status" aria-live="polite">${escapeHtml(pageActionFeedback.text)}</div>` : ""}
      ${pageRuntimeState ? `<small class="page-runtime" data-page-runtime-state>${escapeHtml(pageRuntimeSummary(pageRuntimeState))}</small>` : ""}
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
      ${range(TEXT.maskScale, "overlay-mask-scale", settings.overlayAppearance.maskScale, 0.2, 4)}
      ${range(TEXT.ellipseX, "overlay-ellipse-x", settings.overlayAppearance.ellipseX, 20, 90, 1)}
      ${range(TEXT.ellipseY, "overlay-ellipse-y", settings.overlayAppearance.ellipseY, 20, 90, 1)}
      ${range(TEXT.opacity, "overlay-opacity", settings.overlayAppearance.opacity, 0.35, 1)}
      <button class="muted wide" data-action="reset-appearance" data-requires-enabled>${TEXT.resetAppearance}</button>
    </section>
  </section>`;
}

function readPageRuntimeState(value: unknown): UmtPageRuntimeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Partial<UmtContentCommandResponse>;
  const state = response.state;
  if (response.ok !== true || !state || typeof state !== "object") return null;
  const queue = state.queue as unknown;
  if (!queue || typeof queue !== "object" || !["total", "queued", "processing", "completed", "cached", "empty", "failed", "cancelled"].every((key) => typeof (queue as Record<string, unknown>)[key] === "number")) return null;
  return state;
}

function readPageRuntimeError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Partial<UmtContentCommandResponse>;
  return response.ok === false && typeof response.error === "string" && response.error.trim() ? response.error : null;
}

function pageRuntimeActionSummary(state: UmtPageRuntimeSnapshot): string {
  if (!state.readerActive) return "当前页面尚未识别为漫画阅读页";
  if (state.queue.paused) return `已暂停；${pageRuntimeSummary(state)}`;
  if (state.queue.processing > 0 || state.queue.queued > 0) return `处理中 ${state.queue.processing}，排队 ${state.queue.queued}`;
  return pageRuntimeSummary(state);
}

function pageRuntimeSummary(state: UmtPageRuntimeSnapshot): string {
  const queue = state.queue;
  return `总计 ${queue.total} · 完成 ${queue.completed + queue.cached} · 处理中 ${queue.processing} · 排队 ${queue.queued} · 空 ${queue.empty} · 失败 ${queue.failed} · 取消 ${queue.cancelled}`;
}

function selectPageActionFeedback(pageFeedback: PageActionFeedback | null, cancelFeedback: PageActionFeedback | null, cancelBusy: boolean): PageActionFeedback | null {
  if (cancelBusy && cancelFeedback?.operation === "cancel" && cancelFeedback.kind === "pending") return cancelFeedback;
  const candidates = [pageFeedback, cancelFeedback].filter((feedback): feedback is PageActionFeedback => feedback !== null);
  const errors = candidates.filter((feedback) => feedback.kind === "error");
  const visible = errors.length > 0 ? errors : candidates;
  return visible.reduce<PageActionFeedback | null>((latest, feedback) => !latest || feedback.revision > latest.revision ? feedback : latest, null);
}

function readPopupFocusTarget(root: HTMLElement): PopupFocusTarget | null {
  const active = root.ownerDocument.activeElement;
  if (!active || !root.contains(active)) return null;
  for (const attribute of ["data-action", "data-field"] as const) {
    const value = active.getAttribute(attribute);
    if (value) return { attribute, value };
  }
  return null;
}

function findPopupFocusTarget(root: HTMLElement, target: PopupFocusTarget): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(`[${target.attribute}]`)]
    .find((node) => node.getAttribute(target.attribute) === target.value) ?? null;
}


function pageActionErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/receiving end does not exist|could not establish connection|message port closed/i.test(raw)) {
    return "无法连接当前页面，请重载漫画页后重试。";
  }
  if (/cannot access|extensions gallery cannot be scripted|missing host permission/i.test(raw)) {
    return "当前页面受浏览器限制，插件无法运行。";
  }
  return raw.trim() || "未能把操作发送到当前页面。";
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
  "direct-ocr-max-auto-pages",
  "direct-ocr-max-tiles-per-image",
  "direct-ocr-max-rescue-calls-per-image",
  "direct-ocr-stop-after-failures",
  "glossary-text",
] as const;

function apiSettingsMarkup(settings: ExtensionSettings, selfTestSummary: string): string {
  return `<section class="card direct-config">
    <label><span>运行模式</span><select data-field="run-mode"><option value="direct" ${settings.runMode === "direct" ? "selected" : ""}>${TEXT.directMode}</option><option value="backend" ${settings.runMode === "backend" ? "selected" : ""}>${TEXT.backendMode}</option></select></label>
    ${settings.runMode === "backend" ? `<label><span>后端地址</span><input data-field="backend-url" value="${escapeAttr(settings.backendUrl)}"></label>` : ""}
    ${configChecklistMarkup(settings)}
    <b>直连 API 配置</b>
    <label><span>OCR API URL</span><input data-field="direct-ocr-url" type="url" placeholder="https://example.com/ocr" value="${escapeAttr(settings.directOcr.apiUrl)}"></label>
    <label><span>OCR API Keys</span><textarea data-field="direct-ocr-keys" rows="2" placeholder="一行一个 key">${escapeHtml(settings.directOcr.apiKeys.join("\n"))}</textarea></label>
    <div class="config-grid">
      <label><span>OCR 输入</span><select data-field="direct-ocr-input-mode"><option value="image_base64" ${settings.directOcr.inputMode === "image_base64" ? "selected" : ""}>image_base64</option><option value="file" ${settings.directOcr.inputMode === "file" ? "selected" : ""}>file</option></select></label>
      <label><span>图片字段</span><input data-field="direct-ocr-image-field" value="${escapeAttr(settings.directOcr.imageField)}"></label>
    </div>
    <label><span>翻译 Base URL</span><input data-field="direct-translator-base-url" type="url" placeholder="https://api.openai.com/v1" value="${escapeAttr(settings.directTranslator.baseUrl)}"></label>
    <div class="config-grid">
      <label><span>翻译 API Key</span><input data-field="direct-translator-api-key" type="password" autocomplete="off" placeholder="sk-..." value="${escapeAttr(settings.directTranslator.apiKey)}"></label>
      <label><span>模型</span><input data-field="direct-translator-model" placeholder="gpt-4.1-mini" value="${escapeAttr(settings.directTranslator.model)}"></label>
    </div>
    <details class="advanced-config"><summary>高级字段映射</summary>
      <label><span>regionsPaths</span><textarea data-field="direct-ocr-regions-paths" rows="2">${escapeHtml(settings.directOcr.regionsPaths.join("\n"))}</textarea></label>
      <label><span>textPaths</span><textarea data-field="direct-ocr-text-paths" rows="2">${escapeHtml(settings.directOcr.textPaths.join("\n"))}</textarea></label>
      <label><span>boxPaths</span><textarea data-field="direct-ocr-box-paths" rows="2">${escapeHtml(settings.directOcr.boxPaths.join("\n"))}</textarea></label>
      <label><span>confidencePaths</span><textarea data-field="direct-ocr-confidence-paths" rows="2">${escapeHtml(settings.directOcr.confidencePaths.join("\n"))}</textarea></label>
      <label><span>staticFields JSON</span><textarea data-field="direct-ocr-static-fields" rows="2">${escapeHtml(settings.directOcr.staticFieldsText)}</textarea></label>
    </details>
    <details class="advanced-config"><summary>OCR 成本保护</summary>
      <small>自动翻译按第一页优先；自动页数、单图长图分块数、质量救援次数和连续失败分别限额。</small>
      <div class="config-grid">
        <label><span>每次自动最多 OCR 页</span><input data-field="direct-ocr-max-auto-pages" type="number" min="1" max="120" value="${settings.directOcr.maxAutoOcrPages}"></label>
        <label><span>单张长图最多 OCR 分块数</span><input data-field="direct-ocr-max-tiles-per-image" type="number" min="1" max="12" value="${settings.directOcr.maxOcrTilesPerImage}"></label>
        <label><span>单张图最多 OCR 质量救援</span><input data-field="direct-ocr-max-rescue-calls-per-image" type="number" min="0" max="3" value="${settings.directOcr.maxOcrRescueCallsPerImage}"></label>
        <label><span>连续失败后停止</span><input data-field="direct-ocr-stop-after-failures" type="number" min="1" max="10" value="${settings.directOcr.stopAfterConsecutiveFailures}"></label>
      </div>
    </details>
    <details class="advanced-config" open><summary>人名 / 术语表</summary>
      <small>每行一个：英文名 = 固定译名。用于保证同一章的人名、地名、招式名稳定。</small>
      <label><span>Glossary</span><textarea data-field="glossary-text" rows="4" placeholder="Clark = 克拉克&#10;Murim = 武林">${escapeHtml(settings.glossaryText)}</textarea></label>
    </details>
    <div class="api-actions"><button class="primary" data-action="save-api-settings">保存设置</button><button class="muted" data-action="self-test">${TEXT.selfTest}</button></div>
    ${selfTestSummary ? `<div class="self-test">${escapeHtml(selfTestSummary)}</div>` : ""}
  </section>`;
}

function configChecklistMarkup(settings: ExtensionSettings): string {
  const mappingReady = settings.directOcr.regionsPaths.length > 0 && settings.directOcr.textPaths.length > 0 && settings.directOcr.boxPaths.length > 0;
  const baseUrlReady = /\/v1\/?$/i.test(settings.directTranslator.baseUrl.trim());
  const items = [
    configCheckItem("OCR URL", Boolean(settings.directOcr.apiUrl.trim()), settings.directOcr.apiUrl ? "已填写" : "未填写"),
    configCheckItem("OCR Key", settings.directOcr.apiKeys.length > 0, String(settings.directOcr.apiKeys.length)),
    configCheckItem("字段映射", mappingReady, mappingReady ? "已配置" : "缺少 regions/text/box"),
    configCheckItem("Base URL", baseUrlReady, baseUrlReady ? "包含 /v1" : "建议以 /v1 结尾"),
    configCheckItem("翻译 Key", Boolean(settings.directTranslator.apiKey.trim()), settings.directTranslator.apiKey ? "已填写" : "未填写"),
    configCheckItem("模型", Boolean(settings.directTranslator.model.trim()), settings.directTranslator.model || "未填写"),
  ].join("");
  return `<section class="config-checklist" data-config-checklist><b>配置状态</b><div>${items}</div></section>`;
}

function configCheckItem(label: string, ok: boolean, value: string): string {
  return `<span class="config-check ${ok ? "ok" : "warn"}">${ok ? "✓" : "!"} ${escapeHtml(label)}：${escapeHtml(value)}</span>`;
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

async function defaultSendMessageToTab(tabId: number, message: UmtContentCommand): Promise<unknown> { return await chrome.tabs.sendMessage(tabId, message); }
async function defaultActivateSite(tabId: number, url: string): Promise<UmtActivateSiteResponse> { return await chrome.runtime.sendMessage({ source: "umt-popup", command: "activateSite", tabId, url }); }
function escapeHtml(value: string): string { return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char); }
function escapeAttr(value: string): string { return escapeHtml(value); }

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountPopupPage(root);
  });
}




