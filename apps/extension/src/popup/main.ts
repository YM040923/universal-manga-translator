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
import type { UmtActivateSiteResponse, UmtContentCommand, UmtContentCommandName } from "../content/messages.js";
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
  maskShape: "\u5bf9\u8bdd\u6846\u906e\u7f69\u5f62\u72b6",
  fontScale: "\u6587\u5b57\u5927\u5c0f",
  maskScale: "\u906e\u7f69\u7f29\u653e",
  ellipseX: "\u692d\u5706\u6a2a\u5411\u534a\u5f84",
  ellipseY: "\u692d\u5706\u7eb5\u5411\u534a\u5f84",
  opacity: "\u906e\u7f69\u4e0d\u900f\u660e\u5ea6",
  resetAppearance: "\u6062\u590d\u9ed8\u8ba4\u663e\u793a",
};

export async function mountPopupPage(root: HTMLElement, deps: PopupDeps = {}): Promise<void> {
  await mountPage(root, deps, false);
}

export async function mountSettingsPage(root: HTMLElement, deps: PopupDeps = {}): Promise<void> {
  await mountPage(root, deps, true);
}

async function mountPage(root: HTMLElement, deps: PopupDeps, settingsPage: boolean): Promise<void> {
  const storage = deps.storage;
  let settings = await loadSettings(storage);
  const tab = settingsPage ? await querySettingsTab(deps) : await queryActiveTab(deps);
  let backendOnline: boolean | null = null;
  let selfTestResults = { ocr: "", ai: "", backend: "" };
  let saveSummary = "";

  const render = (options: { preserveScroll?: boolean } = {}): void => {
    const url = tab?.url ?? "";
    const domain = primaryDomainFromUrl(url);
    const unsupported = !domain || !tab?.id;
    const enabled = !unsupported && isSiteEnabled(settings, url);
    const effectiveSite = getEffectiveSiteSettings(settings, url);
    const previousScrollTop = options.preserveScroll === false ? 0 : root.querySelector<HTMLElement>(".umt-popup")?.scrollTop ?? 0;
    root.innerHTML = settingsPage
      ? settingsMarkup({ settings, backendOnline, selfTestResults, saveSummary })
      : popupMarkup({ settings, backendOnline, domain, unsupported, enabled, autoTranslate: effectiveSite.autoTranslate });
    bind({ unsupported, enabled });
    const panel = root.querySelector<HTMLElement>(settingsPage ? ".umt-settings" : ".umt-popup");
    if (panel) panel.scrollTop = previousScrollTop;
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
    root.querySelectorAll<HTMLElement>("[data-backend-status]").forEach((status) => { status.textContent = backendOnline ? "本地后端已连接" : "本地后端离线"; });
    const health = root.querySelector<HTMLElement>(".health");
    if (health) {
      health.textContent = settingsPage
        ? backendOnline ? "本地后端已连接" : "本地后端离线"
        : backendOnline ? TEXT.backendOk : TEXT.backendBad;
      health.classList.toggle("ok", backendOnline);
      health.classList.toggle("bad", !backendOnline);
      health.classList.remove("checking");
    }
  };

  const persist = async (next: ExtensionSettings): Promise<void> => {
    settings = next;
    settings = await saveSettings(settings, storage);
  };

  const sendCommand = async (command: UmtContentCommandName, extra: Partial<UmtContentCommand> = {}): Promise<void> => {
    if (!tab?.id || !tab.url || !isSiteEnabled(settings, tab.url)) return;
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

  let appearancePreviewTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAppearancePreview: ExtensionSettings["overlayAppearance"] | undefined;
  const flushAppearancePreview = (): void => {
    if (appearancePreviewTimer) clearTimeout(appearancePreviewTimer);
    appearancePreviewTimer = undefined;
    const appearance = pendingAppearancePreview;
    pendingAppearancePreview = undefined;
    if (appearance) void sendCommand("applyOverlayAppearance", { appearance });
  };
  const scheduleAppearancePreview = (appearance: ExtensionSettings["overlayAppearance"]): void => {
    pendingAppearancePreview = appearance;
    if (appearancePreviewTimer) clearTimeout(appearancePreviewTimer);
    appearancePreviewTimer = setTimeout(flushAppearancePreview, 40);
  };
  const cancelAppearancePreview = (): void => {
    if (appearancePreviewTimer) clearTimeout(appearancePreviewTimer);
    appearancePreviewTimer = undefined;
    pendingAppearancePreview = undefined;
  };

  const bind = ({ unsupported, enabled }: { unsupported: boolean; enabled: boolean }): void => {
    if (settingsPage) bindSettingsNavigation(root);
    bindOcrInputModeSelect(root);
    root.querySelector<HTMLButtonElement>("[data-action='activate-site']")?.addEventListener("click", async () => {
      if (!tab?.id || !tab.url) return;
      const response = await (deps.activateSite ?? defaultActivateSite)(tab.id, tab.url);
      if (!response.ok) return;
      settings = enableSiteForUrl(settings, tab.url);
      settings = await saveSettings(settings, storage);
      render();
    });
    root.querySelector<HTMLButtonElement>("[data-action='open-settings']")?.addEventListener("click", () => {
      void (deps.openSettingsPage ?? defaultOpenSettingsPage)(tab?.id);
    });
    root.querySelector<HTMLButtonElement>("[data-action='save-api-settings']")?.addEventListener("click", async (event) => {
      const next = readDirectConfigFromDom(root, settings);
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      setSaveFeedback(root, "正在保存设置…");
      try {
        settings = await saveSettings(next, storage);
        backendOnline = null;
        saveSummary = "设置已保存";
        setSaveFeedback(root, saveSummary);
        button.disabled = false;
        if (settings.runMode === "backend") void refreshBackendStatus();
      } catch {
        saveSummary = "保存失败，请检查浏览器扩展存储后重试。";
        setSaveFeedback(root, saveSummary);
        button.disabled = false;
      }
    });
    for (const [action, scope] of [["self-test-ocr", "ocr"], ["self-test-ai", "ai"], ["self-test-backend", "backend"]] as const) {
      root.querySelector<HTMLButtonElement>(`[data-action='${action}']`)?.addEventListener("click", async (event) => {
        const candidate = readDirectConfigFromDom(root, settings);
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        selfTestResults[scope] = "正在测试…";
        setApiFeedback(root, scope, selfTestResults[scope]);
        try {
          selfTestResults[scope] = await runSelfTest(candidate, deps, tab, enabled, !settingsPage || !!tab, scope === "backend" ? "all" : scope);
        } catch {
          selfTestResults[scope] = "自检未完成，请检查网络和接口地址后重试。";
        }
        setApiFeedback(root, scope, selfTestResults[scope]);
        button.disabled = false;
      });
    }
    root.querySelector<HTMLSelectElement>("[data-field='run-mode']")?.addEventListener("change", (event) => {
      const backendMode = (event.currentTarget as HTMLSelectElement).value === "backend";
      root.querySelector<HTMLElement>("[data-mode-panel='backend']")?.toggleAttribute("hidden", !backendMode);
      root.querySelector<HTMLElement>("[data-mode-panel='direct']")?.toggleAttribute("hidden", backendMode);
    });
    bindSecretVisibility(root);
    root.querySelector<HTMLButtonElement>("[data-action='add-ocr-key']")?.addEventListener("click", () => {
      const list = root.querySelector<HTMLElement>("[data-key-list]");
      if (!list) return;
      list.insertAdjacentHTML("beforeend", ocrKeyInputMarkup("", list.children.length + 1));
      const row = list.lastElementChild as HTMLElement | null;
      if (!row) return;
      bindSecretVisibility(row);
      row.querySelector<HTMLInputElement>("[data-field='direct-ocr-key']")?.focus();
      bindRemoveOcrKey(row, root);
    });
    root.querySelectorAll<HTMLElement>("[data-key-row]").forEach((row) => bindRemoveOcrKey(row, root));
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
      cancelAppearancePreview();
      void persist(next);
      void sendCommand("applyOverlayAppearance", { appearance: next.overlayAppearance });
    });
    root.querySelector<HTMLButtonElement>("[data-action='reset-appearance']")?.addEventListener("click", () => {
      const next = normalizeSettings({ ...settings, overlayAppearance: DEFAULT_SETTINGS.overlayAppearance });
      cancelAppearancePreview();
      void persist(next);
      root.querySelector<HTMLSelectElement>("[data-field='overlay-mask-shape']")!.value = next.overlayAppearance.maskShape;
      const values: Array<[string, number]> = [
        ["overlay-font-scale", next.overlayAppearance.fontScale],
        ["overlay-mask-scale", next.overlayAppearance.maskScale],
        ["overlay-ellipse-x", next.overlayAppearance.ellipseX],
        ["overlay-ellipse-y", next.overlayAppearance.ellipseY],
        ["overlay-opacity", next.overlayAppearance.opacity],
      ];
      for (const [field, value] of values) {
        const input = root.querySelector<HTMLInputElement>(`[data-field='${field}']`)!;
        input.value = String(value);
        const output = input.closest<HTMLElement>(".range")?.querySelector<HTMLElement>("em");
        if (output) output.textContent = formatAppearanceValue(field, value);
      }
      void sendCommand("applyOverlayAppearance", { appearance: next.overlayAppearance });
    });
    for (const field of ["overlay-font-scale", "overlay-mask-scale", "overlay-ellipse-x", "overlay-ellipse-y", "overlay-opacity"] as const) {
      root.querySelector<HTMLInputElement>(`[data-field='${field}']`)?.addEventListener("input", (event) => {
        const input = event.currentTarget as HTMLInputElement;
        const key = field === "overlay-font-scale" ? "fontScale"
          : field === "overlay-mask-scale" ? "maskScale"
            : field === "overlay-ellipse-x" ? "ellipseX"
              : field === "overlay-ellipse-y" ? "ellipseY"
                : "opacity";
        const value = Number(input.value);
        const output = input.closest<HTMLElement>(".range")?.querySelector<HTMLElement>("em");
        if (output) output.textContent = formatAppearanceValue(field, value);
        const next = normalizeSettings({ ...settings, overlayAppearance: { ...settings.overlayAppearance, [key]: value } });
        settings = next;
        scheduleAppearancePreview(next.overlayAppearance);
      });
      root.querySelector<HTMLInputElement>(`[data-field='${field}']`)?.addEventListener("change", () => {
        void persist(settings);
        flushAppearancePreview();
      });
    }
    if (unsupported || !enabled) root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-requires-enabled]").forEach((node) => { node.disabled = true; });
  };

  render();
  if (!settingsPage) void ensureActiveTabContentScript();
  void refreshBackendStatus();
}

function popupMarkup(input: { settings: ExtensionSettings; backendOnline: boolean | null; domain: string | null; unsupported: boolean; enabled: boolean; autoTranslate: boolean }): string {
  const { settings, backendOnline, domain, unsupported, enabled, autoTranslate } = input;
  const status = unsupported ? TEXT.unsupported : enabled ? TEXT.enabled : TEXT.disabled;
  const directReady = Boolean(settings.directOcr.apiUrl && settings.directOcr.apiKeys.length && settings.directTranslator.baseUrl && settings.directTranslator.apiKey && settings.directTranslator.model);
  const healthClass = settings.runMode === "direct" ? directReady ? "ok" : "bad" : backendOnline === true ? "ok" : backendOnline === null ? "checking" : "bad";
  const healthText = settings.runMode === "direct" ? `${TEXT.directMode} · ${directReady ? TEXT.apiReady : TEXT.apiMissing}` : backendOnline === true ? TEXT.backendOk : backendOnline === null ? TEXT.backendChecking : TEXT.backendBad;
  return `<style>${popupStyles()}</style><section class="umt-popup">
    <header class="topbar"><div class="brand"><span class="logo">译</span><div><b>${TEXT.brand}</b></div></div><button class="muted settings-button" data-action="open-settings">设置</button></header>
    <div class="site-meta"><small title="${escapeAttr(domain ?? "非网页")}">${escapeHtml(domain ?? "非网页")}</small><span class="health ${healthClass}">${healthText}</span></div>
    <main class="card site-card"><div><div class="site-state ${enabled ? "on" : "off"}">${status}</div><small>${enabled ? "此网站已允许插件运行" : "启用后才会在该网站注入功能"}</small></div>${!enabled && !unsupported ? `<button class="primary" data-action="activate-site">${TEXT.activate}</button>` : ""}</main>
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
    </section>
  </section>`;
}

function settingsMarkup(input: { settings: ExtensionSettings; backendOnline: boolean | null; selfTestResults: { ocr: string; ai: string; backend: string }; saveSummary: string }): string {
  const { settings, backendOnline, selfTestResults, saveSummary } = input;
  const directReady = Boolean(settings.directOcr.apiUrl && settings.directOcr.apiKeys.length && settings.directTranslator.baseUrl && settings.directTranslator.apiKey && settings.directTranslator.model);
  const healthClass = settings.runMode === "direct" ? directReady ? "ok" : "bad" : backendOnline === true ? "ok" : backendOnline === null ? "checking" : "bad";
  const healthText = settings.runMode === "direct" ? `插件直连 · ${directReady ? TEXT.apiReady : TEXT.apiMissing}` : backendOnline === true ? "本地后端已连接" : backendOnline === null ? "正在检测后端" : "本地后端离线";
  return `<style>${popupStyles()}</style><section class="umt-settings">
    <header class="settings-header">
      <div class="brand"><span class="logo">译</span><div><b>漫译设置</b><small>全局配置 · 仅在已启用的网站运行</small></div></div>
      <span class="health ${healthClass}" data-backend-status>${healthText}</span>
    </header>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类">
        <a href="#settings-service" data-settings-nav aria-current="location">服务与模型</a>
        <a href="#settings-translation" data-settings-nav>翻译策略</a>
        <a href="#settings-display" data-settings-nav>阅读显示</a>
      </nav>
      <main class="settings-content">
        <section class="settings-section" id="settings-service" aria-labelledby="settings-service-title">
          <div class="section-heading"><h1 id="settings-service-title">服务与模型</h1><p>配置翻译运行方式，以及 OCR 和 AI 接口。</p></div>
          ${apiSettingsMarkup(settings, backendOnline, selfTestResults)}
          <p class="settings-help">OCR 与 AI 可分别测试。启用网站并从漫画页打开时，OCR 测试还会检查当前页样本。</p>
        </section>
        <section class="settings-section" id="settings-translation" aria-labelledby="settings-translation-title">
          <div class="section-heading"><h1 id="settings-translation-title">翻译策略</h1><p>控制自动识别的用量上限，并统一漫画中的人名与术语译法。</p></div>
          <div class="preference-grid">
            <section class="api-section">
              <h2>OCR 用量保护</h2>
              <p>达到限制时暂停自动翻译，避免持续发送无效请求。</p>
              <label class="api-field"><span>每次自动最多处理图片</span><input data-field="direct-ocr-max-auto-pages" type="number" min="1" max="120" value="${settings.directOcr.maxAutoOcrPages}"></label>
              <label class="api-field"><span>连续失败后停止</span><input data-field="direct-ocr-stop-after-failures" type="number" min="1" max="10" value="${settings.directOcr.stopAfterConsecutiveFailures}"></label>
            </section>
            <section class="api-section">
              <h2>人名与术语表</h2>
              <p>每行填写“原文 = 固定译名”，帮助保持角色名、地名和招式名一致。</p>
              <label class="api-field"><span>术语</span><textarea data-field="glossary-text" rows="6" placeholder="Clark = 克拉克&#10;Murim = 武林">${escapeHtml(settings.glossaryText)}</textarea></label>
            </section>
          </div>
        </section>
        <section class="settings-section" id="settings-display" aria-labelledby="settings-display-title">
          <div class="section-heading"><h1 id="settings-display-title">阅读显示</h1><p>调整漫画阅读页上的控件和译文覆盖效果。</p></div>
          <section class="api-section">
            <h2>页面控件</h2>
            <p>这些控件只影响已启用网站中的漫画阅读页。</p>
            ${toggle(TEXT.floatingButton, "floating-button-enabled", settings.floatingButtonEnabled, false)}
            ${toggle(TEXT.progressWidget, "progress-widget-enabled", settings.progressWidgetEnabled, false)}
          </section>
          <section class="api-section appearance">
            <h2>${TEXT.appearance}</h2>
            <div class="appearance-grid">
              <label class="api-field"><span>${TEXT.maskShape}</span><select data-field="overlay-mask-shape">${shapeOptions(settings.overlayAppearance.maskShape)}</select></label>
              ${range(TEXT.fontScale, "overlay-font-scale", settings.overlayAppearance.fontScale, 0.5, 1.8)}
              ${range(TEXT.maskScale, "overlay-mask-scale", settings.overlayAppearance.maskScale, 0.2, 4)}
              ${range(TEXT.ellipseX, "overlay-ellipse-x", settings.overlayAppearance.ellipseX, 10, 50, 1, "自动模式按气泡比例选择椭圆或圆角；宽气泡使用圆角遮罩")}
              ${range(TEXT.ellipseY, "overlay-ellipse-y", settings.overlayAppearance.ellipseY, 10, 50, 1, "自动模式按气泡比例选择椭圆或圆角；宽气泡使用圆角遮罩")}
              ${range(TEXT.opacity, "overlay-opacity", settings.overlayAppearance.opacity, 0.05, 1)}
            </div>
            <button class="muted" data-action="reset-appearance">${TEXT.resetAppearance}</button>
          </section>
        </section>
        <footer class="api-footer">
          <div class="self-test" data-save-result role="status" aria-live="polite" ${saveSummary ? "" : "hidden"}>${escapeHtml(saveSummary)}</div>
          <div class="api-actions"><button type="button" class="primary" data-action="save-api-settings">保存设置</button></div>
        </footer>
      </main>
    </div>
  </section>`;
}

function toggle(label: string, field: string, checked: boolean, requiresEnabled: boolean): string {
  return `<label class="toggle"><span>${label}</span><input data-field="${field}" ${requiresEnabled ? "data-requires-enabled" : ""} type="checkbox" ${checked ? "checked" : ""}></label>`;
}

function shapeOptions(selected: string): string {
  const items = [["auto", "自动"], ["ellipse", "椭圆"], ["rounded", "圆角"], ["transparent", "透明"]];
  return items.map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function range(label: string, field: string, value: number, min: number, max: number, step = 0.05, title = ""): string {
  return `<label class="range"${title ? ` title="${escapeHtml(title)}"` : ""}><span>${label}<em>${formatAppearanceValue(field, value)}</em></span><input data-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function formatAppearanceValue(field: string, value: number): string {
  if (field === "overlay-opacity") return `${Math.round(value * 100)}%`;
  if (field === "overlay-ellipse-x" || field === "overlay-ellipse-y") return `${Math.round(value)}%`;
  return `${value.toFixed(2)}\u00d7`;
}

function apiSettingsMarkup(settings: ExtensionSettings, backendOnline: boolean | null, selfTestResults: { ocr: string; ai: string; backend: string }): string {
  const isBackend = settings.runMode === "backend";
  const keyInputs = (settings.directOcr.apiKeys.length ? settings.directOcr.apiKeys : [""])
    .map((key, index) => ocrKeyInputMarkup(key, index + 1)).join("");
  const backendStatus = backendOnline === true ? "本地后端已连接" : backendOnline === false ? "本地后端离线" : "尚未检测";
  return `<div class="api-page">
    <section class="api-section">
      <h2>运行方式</h2>
      <label class="api-field"><span>翻译处理位置</span><select data-field="run-mode"><option value="direct" ${!isBackend ? "selected" : ""}>${TEXT.directMode}</option><option value="backend" ${isBackend ? "selected" : ""}>${TEXT.backendMode}</option></select></label>
    </section>
    <div class="mode-panel" data-mode-panel="backend" ${isBackend ? "" : "hidden"}>
      <section class="api-section">
        <h2>本地后端</h2>
        <label class="api-field"><span>服务地址</span><input data-field="backend-url" type="url" value="${escapeAttr(settings.backendUrl)}" placeholder="http://127.0.0.1:47831"></label>
        <p>状态：<span data-backend-status>${backendStatus}</span></p>
        <div class="service-test"><button type="button" class="muted" data-action="self-test-backend">测试后端</button><div class="self-test" data-self-test-result="backend" role="status" aria-live="polite" ${selfTestResults.backend ? "" : "hidden"}>${escapeHtml(selfTestResults.backend)}</div></div>
      </section>
    </div>
    <div class="mode-panel" data-mode-panel="direct" ${isBackend ? "hidden" : ""}>
      <div class="service-grid">
      <section class="api-section">
        <h2>OCR 识别</h2>
        <label class="api-field"><span>OCR 接口完整地址</span><input data-field="direct-ocr-url" type="url" placeholder="https://example.com/api/image/ocr" value="${escapeAttr(settings.directOcr.apiUrl)}"></label>
        <p class="api-help">填写服务商提供的完整 OCR 接口地址。</p>
        <div class="api-key-list" data-key-list>${keyInputs}</div>
        <button type="button" class="muted api-add-key" data-action="add-ocr-key">添加 OCR Key</button>
        <div class="config-grid">
          <div class="api-field"><span id="direct-ocr-input-mode-label">图片提交方式</span><div class="api-select-control" data-custom-select="direct-ocr-input-mode">
            <select class="api-select-native" data-field="direct-ocr-input-mode" tabindex="-1" aria-hidden="true" hidden><option value="image_base64" ${settings.directOcr.inputMode === "image_base64" ? "selected" : ""}>Base64 文本</option><option value="file" ${settings.directOcr.inputMode === "file" ? "selected" : ""}>文件上传</option></select>
            <button type="button" class="api-select-trigger" id="direct-ocr-input-mode-trigger" role="combobox" aria-labelledby="direct-ocr-input-mode-label" aria-haspopup="listbox" aria-expanded="false" aria-controls="direct-ocr-input-mode-options" aria-activedescendant="direct-ocr-input-mode-option-${settings.directOcr.inputMode}"><span data-select-value>${settings.directOcr.inputMode === "file" ? "文件上传" : "Base64 文本"}</span></button>
            <div class="api-select-listbox" id="direct-ocr-input-mode-options" role="listbox" aria-labelledby="direct-ocr-input-mode-label" hidden>
              <div class="api-select-option" id="direct-ocr-input-mode-option-image_base64" role="option" aria-selected="${settings.directOcr.inputMode === "image_base64"}" data-option-value="image_base64">Base64 文本</div>
              <div class="api-select-option" id="direct-ocr-input-mode-option-file" role="option" aria-selected="${settings.directOcr.inputMode === "file"}" data-option-value="file">文件上传</div>
            </div>
          </div></div>
          <label class="api-field"><span>图片字段名</span><input type="text" data-field="direct-ocr-image-field" value="${escapeAttr(settings.directOcr.imageField)}"></label>
        </div>
        <details class="advanced-config"><summary><span>自定义 OCR 接口适配</span><small>一般无需修改</small></summary>
          <p class="mapping-help">仅当接口能连通但无法识别返回结果时调整。前四项填写响应 JSON 路径，每行一个候选；额外请求字段用于接口要求提交的参数。</p>
          <div class="mapping-grid">
            <label class="api-field"><span>文字区域列表路径</span><textarea data-field="direct-ocr-regions-paths" rows="4">${escapeHtml(settings.directOcr.regionsPaths.join("\n"))}</textarea></label>
            <label class="api-field"><span>识别文字路径</span><textarea data-field="direct-ocr-text-paths" rows="3">${escapeHtml(settings.directOcr.textPaths.join("\n"))}</textarea></label>
            <label class="api-field"><span>文字坐标路径</span><textarea data-field="direct-ocr-box-paths" rows="4">${escapeHtml(settings.directOcr.boxPaths.join("\n"))}</textarea></label>
            <label class="api-field"><span>置信度路径</span><textarea data-field="direct-ocr-confidence-paths" rows="3">${escapeHtml(settings.directOcr.confidencePaths.join("\n"))}</textarea></label>
            <label class="api-field mapping-wide"><span>额外请求字段（JSON）</span><textarea data-field="direct-ocr-static-fields" rows="2">${escapeHtml(settings.directOcr.staticFieldsText)}</textarea></label>
          </div>
        </details>
        <div class="service-test"><button type="button" class="muted" data-action="self-test-ocr">测试 OCR</button><div class="self-test" data-self-test-result="ocr" role="status" aria-live="polite" ${selfTestResults.ocr ? "" : "hidden"}>${escapeHtml(selfTestResults.ocr)}</div></div>
      </section>
      <section class="api-section">
        <h2>AI 翻译</h2>
        <label class="api-field"><span>OpenAI 兼容 Base URL</span><input data-field="direct-translator-base-url" type="url" placeholder="https://api.example/v1" value="${escapeAttr(settings.directTranslator.baseUrl)}"></label>
        <p class="api-help">填写服务根地址，通常以 /v1 结尾。</p>
        <div class="secret-field">
          <label class="secret-label" for="translator-api-key">翻译 API Key</label>
          <div class="secret-control"><input id="translator-api-key" data-field="direct-translator-api-key" type="password" autocomplete="off" aria-label="翻译 API Key" placeholder="输入 API Key" value="${escapeAttr(settings.directTranslator.apiKey)}"><button type="button" class="muted" data-action="toggle-secret" aria-label="显示翻译 API Key" aria-pressed="false">显示</button></div>
        </div>
        <label class="api-field"><span>模型 ID</span><input data-field="direct-translator-model" type="text" placeholder="例如 gpt-4.1-mini" value="${escapeAttr(settings.directTranslator.model)}"></label>
        <div class="service-test"><button type="button" class="muted" data-action="self-test-ai">测试 AI</button><div class="self-test" data-self-test-result="ai" role="status" aria-live="polite" ${selfTestResults.ai ? "" : "hidden"}>${escapeHtml(selfTestResults.ai)}</div></div>
      </section>
      </div>
    </div>
  </div>`;
}

function bindSettingsNavigation(root: HTMLElement): void {
  const links = [...root.querySelectorAll<HTMLAnchorElement>("[data-settings-nav]")];
  const panels = links.map((link) => root.querySelector<HTMLElement>(link.hash));
  const view = root.ownerDocument.defaultView;
  const syncActiveLink = (hash = view?.location.hash || "#settings-service"): void => {
    const activeLink = links.find((link) => link.hash === hash) ?? links[0];
    for (const [index, link] of links.entries()) {
      const active = link === activeLink;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
      panels[index]?.toggleAttribute("hidden", !active);
    }
  };
  for (const link of links) link.addEventListener("click", () => syncActiveLink(link.hash));
  view?.addEventListener("hashchange", () => syncActiveLink());
  syncActiveLink();
}

function bindOcrInputModeSelect(root: HTMLElement): void {
  const control = root.querySelector<HTMLElement>("[data-custom-select='direct-ocr-input-mode']");
  const select = control?.querySelector<HTMLSelectElement>("[data-field='direct-ocr-input-mode']");
  const trigger = control?.querySelector<HTMLButtonElement>(".api-select-trigger");
  const listbox = control?.querySelector<HTMLElement>("[role='listbox']");
  const value = control?.querySelector<HTMLElement>("[data-select-value]");
  const options = [...(control?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
  const view = root.ownerDocument.defaultView;
  if (!control || !select || !trigger || !listbox || !value || !options.length || !view) return;

  let activeIndex = 0;
  let outsidePointerDown: ((event: PointerEvent) => void) | undefined;
  const selectedIndex = (): number => Math.max(0, options.findIndex((option) => option.dataset.optionValue === select.value));
  const setActiveIndex = (index: number): void => {
    activeIndex = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => option.classList.toggle("is-active", optionIndex === activeIndex));
    const activeOption = options[activeIndex];
    if (activeOption) trigger.setAttribute("aria-activedescendant", activeOption.id);
  };
  const syncSelection = (): void => {
    const selected = selectedIndex();
    value.textContent = options[selected]?.textContent?.trim() ?? "";
    options.forEach((option, optionIndex) => option.setAttribute("aria-selected", String(optionIndex === selected)));
    setActiveIndex(selected);
  };
  const close = (): void => {
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (outsidePointerDown) view.removeEventListener("pointerdown", outsidePointerDown, true);
    outsidePointerDown = undefined;
  };
  const open = (): void => {
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    setActiveIndex(selectedIndex());
    outsidePointerDown = (event) => {
      if (!control.contains(event.target as Node)) close();
    };
    view.addEventListener("pointerdown", outsidePointerDown, true);
  };
  const commit = (index: number): void => {
    const option = options[index];
    if (!option) return;
    select.value = option.dataset.optionValue ?? select.value;
    select.dispatchEvent(new view.Event("change", { bubbles: true }));
    close();
    trigger.focus();
  };

  syncSelection();
  select.addEventListener("change", syncSelection);
  trigger.addEventListener("click", () => listbox.hidden ? open() : close());
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (listbox.hidden) open();
      else setActiveIndex(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (listbox.hidden) open();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (listbox.hidden) open();
      else commit(activeIndex);
    } else if (event.key === "Escape" && !listbox.hidden) {
      event.preventDefault();
      close();
    } else if (event.key === "Tab" && !listbox.hidden) close();
  });
  options.forEach((option, index) => {
    option.addEventListener("pointermove", () => setActiveIndex(index));
    option.addEventListener("click", () => commit(index));
  });
}

function ocrKeyInputMarkup(value: string, index: number): string {
  return `<div class="secret-field" data-key-row>
    <label class="secret-label" for="ocr-api-key-${index}">OCR API Key ${index}</label>
    <div class="secret-control"><input id="ocr-api-key-${index}" data-field="direct-ocr-key" type="password" autocomplete="off" spellcheck="false" aria-label="OCR API Key ${index}" placeholder="输入 OCR API Key" value="${escapeAttr(value)}"><button type="button" class="muted" data-action="toggle-secret" aria-label="显示 OCR API Key ${index}" aria-pressed="false">显示</button><button type="button" class="muted" data-action="remove-ocr-key" aria-label="移除 OCR API Key ${index}" title="移除">×</button></div>
  </div>`;
}

function bindSecretVisibility(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-action='toggle-secret']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = button.closest<HTMLElement>(".secret-control")?.querySelector<HTMLInputElement>("input");
      if (!input) return;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.textContent = visible ? "隐藏" : "显示";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", `${visible ? "隐藏" : "显示"} ${input.getAttribute("aria-label") ?? "密钥"}`);
    });
  });
}

function bindRemoveOcrKey(row: HTMLElement, root: HTMLElement): void {
  row.querySelector<HTMLButtonElement>("[data-action='remove-ocr-key']")?.addEventListener("click", () => {
    const list = root.querySelector<HTMLElement>("[data-key-list]");
    if (!list) return;
    if (list.children.length === 1) row.querySelector<HTMLInputElement>("input")!.value = "";
    else row.remove();
    [...list.querySelectorAll<HTMLElement>("[data-key-row]")].forEach((item, index) => {
      const number = index + 1;
      const label = item.querySelector<HTMLLabelElement>(".secret-label");
      const input = item.querySelector<HTMLInputElement>("input");
      const showButton = item.querySelector<HTMLButtonElement>("[data-action='toggle-secret']");
      const removeButton = item.querySelector<HTMLButtonElement>("[data-action='remove-ocr-key']");
      if (label) { label.htmlFor = `ocr-api-key-${number}`; label.textContent = `OCR API Key ${number}`; }
      if (input) { input.id = `ocr-api-key-${number}`; input.setAttribute("aria-label", `OCR API Key ${number}`); }
      showButton?.setAttribute("aria-label", `显示 OCR API Key ${number}`);
      removeButton?.setAttribute("aria-label", `移除 OCR API Key ${number}`);
    });
  });
}

function setApiFeedback(root: HTMLElement, target: "ocr" | "ai" | "backend", message: string): void {
  const output = root.querySelector<HTMLElement>(`[data-self-test-result='${target}']`);
  if (!output) return;
  output.textContent = message;
  output.hidden = !message;
}

function setSaveFeedback(root: HTMLElement, message: string): void {
  const output = root.querySelector<HTMLElement>("[data-save-result]");
  if (!output) return;
  output.textContent = message;
  output.hidden = !message;
}

async function queryActiveTab(deps: PopupDeps): Promise<PopupTab | null> {
  if (deps.queryActiveTab) return deps.queryActiveTab();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) return null;
  return { ...(typeof tab.id === "number" ? { id: tab.id } : {}), ...(typeof tab.url === "string" ? { url: tab.url } : {}) };
}

async function querySettingsTab(deps: PopupDeps): Promise<PopupTab | null> {
  if (deps.querySettingsTab) return deps.querySettingsTab();
  const tabId = Number(new URLSearchParams(window.location.search).get("tabId"));
  if (!Number.isInteger(tabId) || tabId <= 0) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return { ...(typeof tab.id === "number" ? { id: tab.id } : {}), ...(typeof tab.url === "string" ? { url: tab.url } : {}) };
  } catch {
    return null;
  }
}

async function defaultOpenSettingsPage(tabId?: number): Promise<void> {
  const baseUrl = chrome.runtime.getURL("settings.html");
  const url = typeof tabId === "number" ? `${baseUrl}?tabId=${encodeURIComponent(String(tabId))}` : baseUrl;
  await chrome.tabs.create({ url });
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

