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
import type { UmtActivateSiteResponse, UmtContentCommand, UmtContentCommandName, UmtDirectHttpRequest, UmtDirectHttpResponse, UmtPageSampleSelfTestResponse } from "../content/messages.js";

type DirectHttpFormFields = NonNullable<NonNullable<UmtDirectHttpRequest["init"]>["formFields"]>;

export interface PopupTab { id?: number; url?: string; }

export interface PopupDeps {
  storage?: SettingsStorageArea;
  queryActiveTab?: () => Promise<PopupTab | null>;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  configStatus?: (backendUrl: string) => Promise<ApiResponse<ConfigStatusResponse>>;
  directHttp?: (request: Omit<UmtDirectHttpRequest, "source" | "command">) => Promise<UmtDirectHttpResponse>;
  sendMessageToTab?: (tabId: number, message: UmtContentCommand) => Promise<unknown> | unknown;
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
  let view: "main" | "api" = "main";

  const render = (options: { preserveScroll?: boolean } = {}): void => {
    const url = tab?.url ?? "";
    const domain = primaryDomainFromUrl(url);
    const unsupported = !domain || !tab?.id;
    const enabled = !unsupported && isSiteEnabled(settings, url);
    const effectiveSite = getEffectiveSiteSettings(settings, url);
    const previousScrollTop = options.preserveScroll === false ? 0 : root.querySelector<HTMLElement>(".umt-popup")?.scrollTop ?? 0;
    root.innerHTML = markup({ settings, backendOnline, domain, unsupported, enabled, autoTranslate: effectiveSite.autoTranslate, selfTestSummary, view });
    bind({ unsupported, enabled });
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
    root.querySelector<HTMLButtonElement>("[data-action='translate']")?.addEventListener("click", () => void sendCommand("translate"));
    root.querySelector<HTMLButtonElement>("[data-action='retranslate']")?.addEventListener("click", () => void sendCommand("retranslateVisible"));
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

function markup(input: { settings: ExtensionSettings; backendOnline: boolean | null; domain: string | null; unsupported: boolean; enabled: boolean; autoTranslate: boolean; selfTestSummary: string; view: "main" | "api" }): string {
  const { settings, backendOnline, domain, unsupported, enabled, autoTranslate, selfTestSummary, view } = input;
  const status = unsupported ? TEXT.unsupported : enabled ? TEXT.enabled : TEXT.disabled;
  const directReady = Boolean(settings.directOcr.apiUrl && settings.directOcr.apiKeys.length && settings.directTranslator.baseUrl && settings.directTranslator.apiKey && settings.directTranslator.model);
  const healthClass = settings.runMode === "direct" ? directReady ? "ok" : "bad" : backendOnline === true ? "ok" : backendOnline === null ? "checking" : "bad";
  const healthText = settings.runMode === "direct" ? `${TEXT.directMode} · ${directReady ? TEXT.apiReady : TEXT.apiMissing}` : backendOnline === true ? TEXT.backendOk : backendOnline === null ? TEXT.backendChecking : TEXT.backendBad;
  const directStatus = `OCR ${settings.directOcr.apiKeys.length} key · ${escapeHtml(settings.directTranslator.model || "未选模型")}`;
  if (view === "api") return `<style>${styles()}</style><section class="umt-popup">
    <header class="topbar"><div class="brand"><span class="logo">译</span><div><b>API 设置</b><small>${escapeHtml(domain ?? "非网页")}</small></div></div><button class="muted" data-action="back-main">返回</button></header>
    ${apiSettingsMarkup(settings, selfTestSummary)}
  </section>`;
  return `<style>${styles()}</style><section class="umt-popup">
    <header class="topbar"><div class="brand"><span class="logo">译</span><div><b>${TEXT.brand}</b><small>${escapeHtml(domain ?? "非网页")}</small></div></div><span class="health ${healthClass}">${healthText}</span></header>
    <main class="card site-card"><div><div class="site-state ${enabled ? "on" : "off"}">${status}</div><small>${enabled ? "此网站已允许插件运行" : "启用后才会在该网站注入功能"}</small></div>${!enabled && !unsupported ? `<button class="primary" data-action="activate-site">${TEXT.activate}</button>` : ""}</main>
    <section class="card mode-card"><b>运行与 API</b><small>${settings.runMode === "direct" ? directStatus : escapeHtml(settings.backendUrl)}</small><button class="muted wide" data-action="open-api-settings">API 设置 / 自检</button></section>
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
      ${range(TEXT.maskScale, "overlay-mask-scale", settings.overlayAppearance.maskScale, 0.2, 4)}
      ${range(TEXT.ellipseX, "overlay-ellipse-x", settings.overlayAppearance.ellipseX, 20, 90, 1)}
      ${range(TEXT.ellipseY, "overlay-ellipse-y", settings.overlayAppearance.ellipseY, 20, 90, 1)}
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
  "direct-ocr-max-auto-pages",
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
      <small>自动翻译会按第一页优先；达到页数或连续失败上限后停止，避免无意义扣费。</small>
      <div class="config-grid">
        <label><span>每次自动最多 OCR 页</span><input data-field="direct-ocr-max-auto-pages" type="number" min="1" max="120" value="${settings.directOcr.maxAutoOcrPages}"></label>
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

function readDirectConfigFromDom(root: HTMLElement, settings: ExtensionSettings): ExtensionSettings {
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

async function runSelfTest(settings: ExtensionSettings, deps: PopupDeps, tab?: PopupTab | null, siteEnabled = false): Promise<string> {
  if (settings.runMode === "backend") {
    try { return await (deps.checkBackend ?? defaultCheckBackend)(settings.backendUrl) ? "后端连通正常" : "后端离线或无法访问"; }
    catch (error) { return `后端自检失败：${formatError(error)}`; }
  }
  const results: string[] = [];
  if (!settings.directOcr.apiUrl || !settings.directOcr.apiKeys.length) results.push("OCR 未配置");
  else results.push(await testDirectOcr(settings, deps, tab, siteEnabled));
  if (!settings.directTranslator.baseUrl || !settings.directTranslator.apiKey || !settings.directTranslator.model) results.push("翻译 API 未配置");
  else results.push(await testTranslator(settings, deps));
  return results.join("；");
}

async function testDirectOcr(settings: ExtensionSettings, deps: PopupDeps, tab?: PopupTab | null, siteEnabled = false): Promise<string> {
  const key = settings.directOcr.apiKeys[0] ?? "";
  const imageBase64 = OCR_SELF_TEST_PNG_BASE64;
  const formFields: DirectHttpFormFields = settings.directOcr.inputMode === "file"
    ? [{ type: "file", name: settings.directOcr.imageField || "file", fileName: "selftest.png", mimeType: "image/png", base64: imageBase64 }]
    : [
      { type: "text", name: settings.directOcr.imageField || "image_base64", value: imageBase64 },
      { type: "text", name: "image_name", value: "selftest.png" },
    ];
  appendStaticOcrFields(formFields, settings.directOcr.staticFieldsText);
  const response = await directHttp(deps, { url: settings.directOcr.apiUrl, init: { method: "POST", headers: { authorization: `Bearer ${key}` }, formFields } });
  const bodyText = response.bodyText ?? "";
  if (!response.ok) return explainHttpFailure("OCR", response.status, bodyText, response.error ?? response.statusText ?? "");
  const providerError = extractProviderError(bodyText);
  if (providerError) return explainHttpFailure("OCR", response.status, bodyText, providerError);
  const parsed = parseSelfTestOcrRegions(bodyText, settings);
  if (parsed.status === "ok") return `OCR 解析正常：识别 ${parsed.count} 行 · ${parsed.preview}`;
  if (parsed.status === "mapping-mismatch") return "OCR 接口连通正常；未解析到文字区域，请检查 regionsPaths/textPaths/boxPaths 字段映射";
  const pageSample = await testCurrentPageOcrSample(deps, tab, siteEnabled);
  if (pageSample) return pageSample;
  if (parsed.status === "empty") return siteEnabled
    ? "OCR 接口连通正常；页面样本自检未执行，请确认当前标签页已重载插件并处于漫画阅读页"
    : "OCR 接口连通正常；测试图未返回文字区域。当前网站未启用，无法执行页面样本自检";
  return "OCR 接口连通正常；未解析到文字区域，请检查 regionsPaths/textPaths/boxPaths 字段映射";
}

async function testCurrentPageOcrSample(deps: PopupDeps, tab?: PopupTab | null, siteEnabled = false): Promise<string> {
  if (!siteEnabled) return "";
  if (!tab?.id) return "OCR 接口连通正常；页面样本自检未执行：无法读取当前标签页";
  try {
    const response = await sendPageSampleSelfTestCommand(deps, tab);
    if (!response) return "OCR 接口连通正常；页面样本自检未返回，请重载当前漫画页或重新启用该网站";
    if (response.ok) return `页面样本 OCR 正常：第 ${response.surfaceIndex} 张，识别 ${response.regionCount} 个区域`;
    if (response.status === "no-reader-page" || response.status === "no-surface") return "OCR 接口连通正常；当前页没有可用于自检的漫画图片";
    return `页面样本 OCR 未通过：${response.detail}`;
  } catch {
    return "OCR 接口连通正常；页面样本自检无法连接当前页面，请重载当前漫画页后再试";
  }
}

async function sendPageSampleSelfTestCommand(deps: PopupDeps, tab: PopupTab): Promise<UmtPageSampleSelfTestResponse | undefined> {
  if (!tab.id) return undefined;
  const message: UmtContentCommand = { source: "umt-popup", command: "sampleOcrSelfTest" };
  try {
    return await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message) as UmtPageSampleSelfTestResponse | undefined;
  } catch (error) {
    if (!tab.url) throw error;
    const response = await (deps.ensureContentScript ?? deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
    if (!response.ok) throw error;
    return await (deps.sendMessageToTab ?? defaultSendMessageToTab)(tab.id, message) as UmtPageSampleSelfTestResponse | undefined;
  }
}

function explainHttpFailure(prefix: string, status: number | undefined, bodyText: string, fallback: string): string {
  const detail = extractProviderError(bodyText) || fallback;
  const statusText = status ? `${status} ` : "";
  const combined = `${statusText}${detail}`;
  if (/402|credit|quota|insufficient|余额|额度|积分不足/i.test(combined)) return `${prefix} 失败：${combined}。账户额度不足，请充值或切换 API Key。`;
  if (/401|403|unauthorized|forbidden|invalid.?key|鉴权|权限/i.test(combined)) return `${prefix} 失败：${combined}。API Key 无效或没有权限。`;
  if (/429|rate.?limit|qps|too many/i.test(combined)) return `${prefix} 失败：${combined}。请求过快或 QPS 受限，请稍后重试或降低并发。`;
  return `${prefix} 失败：${combined}`.trim();
}

function extractProviderError(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const code = parsed.code ?? parsed.error_code ?? parsed.errcode ?? parsed.error ?? "";
    const message = parsed.message ?? parsed.error_msg ?? parsed.msg ?? "";
    if (!code || String(code).toUpperCase() === "OK" || String(code).toUpperCase() === "SUCCESS" || code === 0 || code === "0") return "";
    return `${String(code)}${message ? ` ${String(message)}` : ""}`;
  } catch {
    return "";
  }
}

function appendStaticOcrFields(formFields: DirectHttpFormFields, staticFieldsText: string): void {
  let parsed: unknown;
  try {
    parsed = staticFieldsText.trim() ? JSON.parse(staticFieldsText) : {};
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const [name, value] of Object.entries(parsed)) {
    if (value === undefined || value === null) continue;
    formFields.push({
      type: "text",
      name,
      value: Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value),
    });
  }
}

function parseSelfTestOcrRegions(bodyText: string, settings: ExtensionSettings): { status: "ok"; count: number; preview: string } | { status: "empty" } | { status: "mapping-mismatch" } {
  try {
    const parsed = JSON.parse(bodyText);
    const regions = firstArrayAtPaths(parsed, settings.directOcr.regionsPaths);
    if (!regions) return /words_result|text|location|box/i.test(bodyText) || containsArray(parsed) ? { status: "mapping-mismatch" } : { status: "empty" };
    if (regions.length === 0) return { status: "empty" };
    const texts = regions
      .map((region) => firstStringAtPaths(region, settings.directOcr.textPaths))
      .filter((text): text is string => Boolean(text?.trim()));
    const hasBox = regions.some((region) => settings.directOcr.boxPaths.some((path) => readPath(region, path) !== undefined));
    if (!texts.length || !hasBox) return { status: "mapping-mismatch" };
    return { status: "ok", count: texts.length, preview: texts.slice(0, 2).join(" / ").slice(0, 80) };
  } catch {
    return { status: "mapping-mismatch" };
  }
}

function containsArray(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(containsArray);
}

function firstArrayAtPaths(value: unknown, paths: string[]): unknown[] | null {
  for (const path of paths) {
    const found = readPath(value, path);
    if (Array.isArray(found)) return found;
  }
  return null;
}

function firstStringAtPaths(value: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const found = readPath(value, path);
    if (typeof found === "string") return found;
    if (typeof found === "number") return String(found);
  }
  return null;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && !Array.isArray(current)) return (current as Record<string, unknown>)[part];
    return undefined;
  }, value);
}

async function testTranslator(settings: ExtensionSettings, deps: PopupDeps): Promise<string> {
  const baseUrl = settings.directTranslator.baseUrl.replace(/\/$/, "");
  const models = await directHttp(deps, { url: `${baseUrl}/models`, init: { method: "GET", headers: { authorization: `Bearer ${settings.directTranslator.apiKey}` }, cache: "no-store" } });
  if (!models.ok) return explainHttpFailure("AI", models.status, models.bodyText ?? "", models.error ?? models.statusText ?? "");
  const contentType = models.headers?.["content-type"] ?? models.headers?.["Content-Type"] ?? "";
  if (!/json/i.test(contentType)) return `AI 失败：返回非 JSON。请检查 Base URL 是否包含 /v1`;
  const chat = await directHttp(deps, {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${settings.directTranslator.apiKey}`, "content-type": "application/json" },
      bodyText: JSON.stringify({
        model: settings.directTranslator.model,
        messages: [
          { role: "system", content: "You are a manga translation connectivity self-test. Return only the Chinese translation." },
          { role: "user", content: "Translate to Simplified Chinese: HELLO OCR" },
        ],
        temperature: 0,
        max_tokens: 24,
      }),
    },
  });
  if (!chat.ok) return explainHttpFailure("AI", chat.status, chat.bodyText ?? "", chat.error ?? chat.statusText ?? "");
  const chatContentType = chat.headers?.["content-type"] ?? chat.headers?.["Content-Type"] ?? "";
  if (!/json/i.test(chatContentType)) return `AI 失败：chat/completions 返回非 JSON。请检查 Base URL 和模型接口`;
  const sample = extractChatCompletionText(chat.bodyText ?? "");
  if (!sample) return "AI 失败：chat/completions 未返回可读文本，请检查模型是否兼容 OpenAI Chat Completions";
  return `AI 调用正常：${sample.slice(0, 40)}`;
}

function extractChatCompletionText(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
    const content = parsed.choices?.[0]?.message?.content ?? parsed.choices?.[0]?.text;
    return typeof content === "string" ? content.trim() : "";
  } catch {
    return "";
  }
}

const OCR_SELF_TEST_PNG_BASE64 = "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";

async function directHttp(deps: PopupDeps, request: Omit<UmtDirectHttpRequest, "source" | "command">): Promise<UmtDirectHttpResponse> {
  if (deps.directHttp) return deps.directHttp(request);
  return await chrome.runtime.sendMessage({ source: "umt-popup", command: "directHttp", ...request });
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function styles(): string {
  return `.umt-popup{box-sizing:border-box;width:320px;max-height:600px;overflow:auto;padding:12px;background:linear-gradient(180deg,#fff7ed 0,#f8fbff 44px,#f8fbff 100%);color:#10223b;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.34) transparent}.umt-popup::-webkit-scrollbar{width:6px}.umt-popup::-webkit-scrollbar-track{background:transparent}.umt-popup::-webkit-scrollbar-thumb{background:rgba(148,163,184,.26);border-radius:999px}.umt-popup::-webkit-scrollbar-thumb:hover{background:rgba(100,116,139,.44)}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.brand{display:flex;align-items:center;gap:8px}.logo{display:grid;place-items:center;width:32px;height:32px;border-radius:12px;background:linear-gradient(135deg,#ff7a1a,#ff4d00);color:#fff;font-weight:900;box-shadow:0 8px 18px rgba(255,96,20,.24)}header b{display:block;color:#172033;font-size:18px;line-height:1}header small{display:block;max-width:155px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;margin-top:3px}.health{border-radius:999px;padding:5px 8px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:800;white-space:nowrap}.health.ok{background:#dcfce7;color:#166534}.health.checking{background:#e0f2fe;color:#075985}.card{background:rgba(255,255,255,.95);border:1px solid #dbe6f3;border-radius:16px;padding:10px;margin:8px 0;box-shadow:0 8px 22px rgba(30,55,90,.08)}.site-card{display:flex;justify-content:space-between;align-items:center;gap:10px}.site-card small{color:#64748b}.site-state{font-weight:900;margin-bottom:3px}.site-state.on{color:#15803d}.site-state.off{color:#b45309}button{border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:8px 9px;cursor:pointer;font-weight:850;color:#10223b;transition:transform .12s ease,box-shadow .12s ease,background .12s ease}button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 14px rgba(15,23,42,.10)}.primary{background:linear-gradient(135deg,#ff7a1a,#ff4d00);border-color:#ff6a1a;color:#fff}.wide{grid-column:1/-1}.muted{background:#f8fafc;color:#475569}.danger{background:#fff1f2;border-color:#fecdd3;color:#be123c}.controls{display:grid;grid-template-columns:1fr 1fr;gap:7px}.toggles,.appearance,.mode-card,.direct-config,.advanced-config{display:grid;gap:9px}.api-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.self-test{padding:8px;border-radius:10px;background:#fff7ed;color:#9a3412;font-weight:750;white-space:pre-wrap;word-break:break-word}.config-checklist{display:grid;gap:8px;padding:9px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0}.config-checklist>div{display:flex;flex-wrap:wrap;gap:6px}.config-check{border-radius:999px;padding:4px 7px;background:#fff;border:1px solid #dbe6f3;color:#475569;font-size:12px;font-weight:850}.config-check.ok{color:#166534;background:#f0fdf4;border-color:#bbf7d0}.config-check.warn{color:#9a3412;background:#fff7ed;border-color:#fed7aa}.toggles>b,.appearance>b,.config-checklist>b,summary{font-size:13px;color:#0f172a;font-weight:900;cursor:pointer}.toggle{display:flex;align-items:center;justify-content:space-between;font-weight:800}.toggle input{width:34px;height:19px;accent-color:#ff6a1a}.appearance label,.mode-card label,.direct-config label,.advanced-config label{display:grid;gap:4px;font-weight:750}.appearance label>span,.range>span,.direct-config label>span{display:flex;justify-content:space-between;color:#334155}.appearance em{font-style:normal;color:#64748b}select,input[type=url],input[type=password],input:not([type]),textarea{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:7px;background:#fff;color:#10223b;font-weight:750}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.config-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}input[type=range]{width:100%;accent-color:#ff6a1a}button:disabled,input:disabled,select:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none}`;
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




