import type { ApiResponse, CacheStatsResponse, ClearCacheResponse, ConfigStatusResponse } from "@umt/shared/protocol";
import { loadSettings, saveSettings, type ExtensionSettings, type ImageRange, type SettingsStorageArea } from "../settings/settings.js";

export interface DiagnosticsResponse { ok: true; records: Array<Record<string, unknown>>; }

export interface OptionsPageDeps {
  storage?: SettingsStorageArea;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
  configStatus?: (backendUrl: string) => Promise<ApiResponse<ConfigStatusResponse>>;
  cacheStats?: (backendUrl: string) => Promise<ApiResponse<CacheStatsResponse>>;
  clearCache?: (backendUrl: string) => Promise<ApiResponse<ClearCacheResponse>>;
  diagnostics?: (backendUrl: string, limit?: number) => Promise<ApiResponse<DiagnosticsResponse>>;
}

const TEXT = {
  title: "Universal Manga Translator 设置",
  subtitle: "管理后端、提供商、默认翻译与性能参数。",
  notChecked: "未检查",
  checking: "检查中...",
  connected: "已连接",
  offline: "离线",
  backend: "后端连接",
  backendUrl: "后端 URL",
  checkBackend: "检查后端",
  provider: "提供商 / 模型",
  checkProvider: "检查提供商",
  keyConfigured: "API key 已配置",
  keyMissing: "API key 未配置",
  providerProfile: "提供商配置",
  translationModel: "翻译模型",
  compatibleBaseUrl: "OpenAI 兼容 Base URL",
  keyHint: "API key 密钥应放在本地后端环境变量中，不要存在插件存储里。",
  defaults: "翻译默认值",
  targetLanguage: "目标语言",
  defaultRange: "默认图片范围",
  viewport: "窗口范围",
  fullPage: "整页",
  pretranslate: "预翻译下一页",
  floating: "显示悬浮翻译按钮",
  autoDefault: "新网站默认自动翻译",
  debugOverlay: "调试覆盖层",
  performance: "性能 / 缓存",
  timeout: "请求超时（ms）",
  concurrency: "最大并发提交数",
  fullPageLimit: "整页最大图片数",
  retryCount: "重试次数",
  cacheHint: "当前页面缓存可以在 popup 中清理。后端持久缓存由本地服务管理。",
  cacheStats: "查看缓存",
  clearCache: "清理缓存",
  cacheCleared: "已清理",
  diagnostics: "最近诊断",
  diagnosticsTitle: "翻译诊断",
  diagnosticsHint: "只显示安全诊断字段，不包含 API key、图片内容或 base64 数据。",
  diagnosticsEmpty: "暂无诊断记录",
  save: "保存设置",
  saved: "已保存",
  saveFailed: "保存失败",
};

export async function mountOptionsPage(root: HTMLElement, deps: OptionsPageDeps = {}): Promise<void> {
  let settings = await loadSettings(deps.storage);
  root.innerHTML = markup(settings);

  const form = root.querySelector<HTMLFormElement>("[data-options-form]")!;
  const status = root.querySelector<HTMLElement>("[data-options-status]")!;
  const backendHealth = root.querySelector<HTMLElement>("[data-backend-health]")!;
  const providerStatus = root.querySelector<HTMLElement>("[data-provider-status]")!;
  const cacheStatus = root.querySelector<HTMLElement>("[data-cache-status]")!;
  const diagnosticsStatus = root.querySelector<HTMLElement>("[data-diagnostics-status]")!;

  root.querySelector<HTMLButtonElement>("[data-action='check-provider']")!.addEventListener("click", () => {
    const backendUrl = field<HTMLInputElement>(form, "backendUrl").value;
    providerStatus.textContent = TEXT.checking;
    void (deps.configStatus ?? defaultConfigStatus)(backendUrl).then((config) => {
      if (!config.ok) {
        providerStatus.textContent = TEXT.offline;
        providerStatus.dataset.state = "bad";
        return;
      }
      const keyState = config.openAICompatible.apiKeyConfigured ? TEXT.keyConfigured : TEXT.keyMissing;
      providerStatus.textContent = `${config.provider} | ${config.providerProfile} | ${config.openAICompatible.model || "mock"} | ${keyState}`;
      providerStatus.dataset.state = config.openAICompatible.apiKeyConfigured || config.provider === "mock" ? "ok" : "bad";
    }).catch(() => {
      providerStatus.textContent = TEXT.offline;
      providerStatus.dataset.state = "bad";
    });
  });

  root.querySelector<HTMLButtonElement>("[data-action='check-backend']")!.addEventListener("click", () => {
    const backendUrl = field<HTMLInputElement>(form, "backendUrl").value;
    backendHealth.textContent = TEXT.checking;
    void (deps.checkBackend ?? defaultCheckBackend)(backendUrl).then((ok) => {
      backendHealth.textContent = ok ? TEXT.connected : TEXT.offline;
      backendHealth.dataset.state = ok ? "ok" : "bad";
    }).catch(() => {
      backendHealth.textContent = TEXT.offline;
      backendHealth.dataset.state = "bad";
    });
  });

  root.querySelector<HTMLButtonElement>("[data-action='cache-stats']")!.addEventListener("click", () => {
    const backendUrl = field<HTMLInputElement>(form, "backendUrl").value;
    cacheStatus.textContent = TEXT.checking;
    void (deps.cacheStats ?? defaultCacheStats)(backendUrl).then((response) => {
      cacheStatus.textContent = response.ok ? `${response.stats.entries} 条 | ${formatBytes(response.stats.bytes)}` : TEXT.offline;
    }).catch(() => {
      cacheStatus.textContent = TEXT.offline;
    });
  });

  root.querySelector<HTMLButtonElement>("[data-action='clear-cache']")!.addEventListener("click", () => {
    const backendUrl = field<HTMLInputElement>(form, "backendUrl").value;
    cacheStatus.textContent = TEXT.checking;
    void (deps.clearCache ?? defaultClearCache)(backendUrl).then((response) => {
      cacheStatus.textContent = response.ok ? `${TEXT.cacheCleared} ${response.deleted}` : TEXT.offline;
    }).catch(() => {
      cacheStatus.textContent = TEXT.offline;
    });
  });

  root.querySelector<HTMLButtonElement>("[data-action='diagnostics']")!.addEventListener("click", () => {
    const backendUrl = field<HTMLInputElement>(form, "backendUrl").value;
    diagnosticsStatus.textContent = TEXT.checking;
    void (deps.diagnostics ?? defaultDiagnostics)(backendUrl, 10).then((response) => {
      diagnosticsStatus.textContent = response.ok ? formatDiagnostics(response.records) : TEXT.offline;
    }).catch(() => {
      diagnosticsStatus.textContent = TEXT.offline;
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next: ExtensionSettings = {
      ...settings,
      backendUrl: field<HTMLInputElement>(form, "backendUrl").value,
      providerProfile: field<HTMLInputElement>(form, "providerProfile").value,
      translationModel: field<HTMLInputElement>(form, "translationModel").value,
      openAICompatibleBaseUrl: field<HTMLInputElement>(form, "openAICompatibleBaseUrl").value,
      targetLanguage: field<HTMLInputElement>(form, "targetLanguage").value,
      imageRange: field<HTMLSelectElement>(form, "imageRange").value as ImageRange,
      pretranslateNextPage: field<HTMLInputElement>(form, "pretranslateNextPage").checked,
      floatingButtonEnabled: field<HTMLInputElement>(form, "floatingButtonEnabled").checked,
      autoTranslateDefault: field<HTMLInputElement>(form, "autoTranslateDefault").checked,
      debugOverlayEnabled: field<HTMLInputElement>(form, "debugOverlayEnabled").checked,
      requestTimeoutMs: Number(field<HTMLInputElement>(form, "requestTimeoutMs").value),
      maxConcurrentSubmissions: Number(field<HTMLInputElement>(form, "maxConcurrentSubmissions").value),
      maxFullPageSurfaces: Number(field<HTMLInputElement>(form, "maxFullPageSurfaces").value),
      retryCount: Number(field<HTMLInputElement>(form, "retryCount").value),
    };
    void saveSettings(next, deps.storage).then((saved) => {
      settings = saved;
      status.textContent = TEXT.saved;
      syncForm(form, saved);
    }).catch((error) => {
      status.textContent = `${TEXT.saveFailed}: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

function markup(settings: ExtensionSettings): string {
  return `
    <style>${styles()}</style>
    <section class="umt-settings-page">
      <header class="page-header">
        <div><h1>${TEXT.title}</h1><p>${TEXT.subtitle}</p></div>
        <span data-backend-health class="health">${TEXT.notChecked}</span>
      </header>
      <form data-options-form>
        <section class="settings-card" data-section="backend">
          <h2>${TEXT.backend}</h2>
          <label>${TEXT.backendUrl} <input name="backendUrl" type="url" required value="${escapeAttr(settings.backendUrl)}" /></label>
          <div class="inline-actions"><button type="button" data-action="check-backend">${TEXT.checkBackend}</button><code>powershell -ExecutionPolicy Bypass -File ./scripts/start-backend.ps1</code></div>
        </section>

        <section class="settings-card" data-section="provider">
          <h2>${TEXT.provider}</h2>
          <label>${TEXT.providerProfile} <input name="providerProfile" type="text" required value="${escapeAttr(settings.providerProfile)}" /></label>
          <label>${TEXT.translationModel} <input name="translationModel" type="text" required value="${escapeAttr(settings.translationModel)}" /></label>
          <label>${TEXT.compatibleBaseUrl} <input name="openAICompatibleBaseUrl" type="url" value="${escapeAttr(settings.openAICompatibleBaseUrl)}" placeholder="https://api.openai.com/v1" /></label>
          <div class="provider-status-row"><button type="button" data-action="check-provider">${TEXT.checkProvider}</button><span data-provider-status class="health">${TEXT.notChecked}</span></div>
          <p class="hint">${TEXT.keyHint}</p>
        </section>

        <section class="settings-card" data-section="defaults">
          <h2>${TEXT.defaults}</h2>
          <label>${TEXT.targetLanguage} <input name="targetLanguage" type="text" required value="${escapeAttr(settings.targetLanguage)}" /></label>
          <label>${TEXT.defaultRange} <select name="imageRange"><option value="viewport" ${settings.imageRange === "viewport" ? "selected" : ""}>${TEXT.viewport}</option><option value="fullPage" ${settings.imageRange === "fullPage" ? "selected" : ""}>${TEXT.fullPage}</option></select></label>
          ${checkbox("pretranslateNextPage", TEXT.pretranslate, settings.pretranslateNextPage)}
          ${checkbox("floatingButtonEnabled", TEXT.floating, settings.floatingButtonEnabled)}
          ${checkbox("autoTranslateDefault", TEXT.autoDefault, settings.autoTranslateDefault)}
          ${checkbox("debugOverlayEnabled", TEXT.debugOverlay, settings.debugOverlayEnabled)}
        </section>

        <section class="settings-card" data-section="performance">
          <h2>${TEXT.performance}</h2>
          <label>${TEXT.timeout} <input name="requestTimeoutMs" type="number" min="5000" max="180000" step="1000" value="${settings.requestTimeoutMs}" /></label>
          <label>${TEXT.concurrency} <input name="maxConcurrentSubmissions" type="number" min="1" max="8" value="${settings.maxConcurrentSubmissions}" /></label>
          <label>${TEXT.fullPageLimit} <input name="maxFullPageSurfaces" type="number" min="1" max="300" value="${settings.maxFullPageSurfaces}" /></label>
          <label>${TEXT.retryCount} <input name="retryCount" type="number" min="0" max="5" value="${settings.retryCount}" /></label>
          <div class="provider-status-row"><button type="button" data-action="cache-stats">${TEXT.cacheStats}</button><button type="button" data-action="clear-cache">${TEXT.clearCache}</button><span data-cache-status class="health">${TEXT.notChecked}</span></div>
          <p class="hint">${TEXT.cacheHint}</p>
        </section>

        <section class="settings-card" data-section="diagnostics">
          <h2>${TEXT.diagnosticsTitle}</h2>
          <div class="provider-status-row"><button type="button" data-action="diagnostics">${TEXT.diagnostics}</button></div>
          <pre data-diagnostics-status class="diagnostics-log">${TEXT.notChecked}</pre>
          <p class="hint">${TEXT.diagnosticsHint}</p>
        </section>

        <footer class="form-footer"><button type="submit">${TEXT.save}</button><p data-options-status></p></footer>
      </form>
    </section>
  `;
}

function syncForm(form: HTMLFormElement, settings: ExtensionSettings): void {
  field<HTMLInputElement>(form, "backendUrl").value = settings.backendUrl;
  field<HTMLInputElement>(form, "providerProfile").value = settings.providerProfile;
  field<HTMLInputElement>(form, "translationModel").value = settings.translationModel;
  field<HTMLInputElement>(form, "openAICompatibleBaseUrl").value = settings.openAICompatibleBaseUrl;
  field<HTMLInputElement>(form, "targetLanguage").value = settings.targetLanguage;
  field<HTMLSelectElement>(form, "imageRange").value = settings.imageRange;
  field<HTMLInputElement>(form, "pretranslateNextPage").checked = settings.pretranslateNextPage;
  field<HTMLInputElement>(form, "floatingButtonEnabled").checked = settings.floatingButtonEnabled;
  field<HTMLInputElement>(form, "autoTranslateDefault").checked = settings.autoTranslateDefault;
  field<HTMLInputElement>(form, "debugOverlayEnabled").checked = settings.debugOverlayEnabled;
  field<HTMLInputElement>(form, "requestTimeoutMs").value = String(settings.requestTimeoutMs);
  field<HTMLInputElement>(form, "maxConcurrentSubmissions").value = String(settings.maxConcurrentSubmissions);
  field<HTMLInputElement>(form, "maxFullPageSurfaces").value = String(settings.maxFullPageSurfaces);
  field<HTMLInputElement>(form, "retryCount").value = String(settings.retryCount);
}

function field<T extends HTMLInputElement | HTMLSelectElement>(form: HTMLFormElement, name: string): T {
  return form.elements.namedItem(name) as T;
}

function checkbox(name: string, label: string, checked: boolean): string {
  return `<label class="checkbox"><input name="${name}" type="checkbox" ${checked ? "checked" : ""} /> ${label}</label>`;
}

async function defaultCheckBackend(backendUrl: string): Promise<boolean> {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/health`, { cache: "no-store" });
  return response.ok;
}

async function defaultConfigStatus(backendUrl: string): Promise<ApiResponse<ConfigStatusResponse>> {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/v1/config/status`, { cache: "no-store" });
  return (await response.json()) as ApiResponse<ConfigStatusResponse>;
}

async function defaultCacheStats(backendUrl: string): Promise<ApiResponse<CacheStatsResponse>> {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/v1/cache/stats`, { cache: "no-store" });
  return (await response.json()) as ApiResponse<CacheStatsResponse>;
}

async function defaultClearCache(backendUrl: string): Promise<ApiResponse<ClearCacheResponse>> {
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/v1/cache/clear`, { method: "POST" });
  return (await response.json()) as ApiResponse<ClearCacheResponse>;
}

async function defaultDiagnostics(backendUrl: string, limit = 10): Promise<ApiResponse<DiagnosticsResponse>> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/v1/diagnostics/recent?limit=${safeLimit}`, { cache: "no-store" });
  return (await response.json()) as ApiResponse<DiagnosticsResponse>;
}

function formatDiagnostics(records: Array<Record<string, unknown>>): string {
  if (!records.length) return TEXT.diagnosticsEmpty;
  return records.map((record) => {
    const status = String(record.status ?? "?");
    const surfaceId = String(record.surfaceId ?? "?");
    const regions = String(record.finalRegionCount ?? "?");
    const inputSource = String(record.inputSource ?? "?");
    const elapsedMs = String(record.elapsedMs ?? "?");
    const provider = String(record.providerProfile ?? "?");
    return `${status} | ${surfaceId} | ${regions} regions | ${inputSource} | ${elapsedMs}ms | ${provider}`;
  }).join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

function styles(): string {
  return `.umt-settings-page{max-width:860px;margin:0 auto;padding:24px;font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a}.page-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.page-header h1{margin:0;font-size:26px}.page-header p{margin:6px 0 0;color:#64748b}.health{border-radius:999px;background:#e2e8f0;color:#475569;padding:7px 12px;font-weight:800}.health[data-state='ok']{background:#dcfce7;color:#166534}.health[data-state='bad']{background:#fee2e2;color:#991b1b}.settings-card{background:#fff;border:1px solid #d8e2ef;border-radius:18px;padding:18px;margin:14px 0;box-shadow:0 8px 24px rgba(15,23,42,.06)}.settings-card h2{font-size:17px;margin:0 0 14px}.settings-card label{display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:center;margin:10px 0}.settings-card input:not([type='checkbox']),.settings-card select{border:1px solid #cbd5e1;border-radius:12px;padding:9px 11px;background:#f8fafc}.checkbox{display:flex!important;grid-template-columns:none!important;gap:9px!important;justify-content:flex-start}.inline-actions,.provider-status-row{display:flex;align-items:center;gap:12px;margin-top:10px}.inline-actions button,.provider-status-row button,.form-footer button{border:0;border-radius:12px;background:#ff6a1a;color:#fff;padding:10px 14px;font-weight:900;cursor:pointer}.inline-actions code{background:#f1f5f9;border-radius:10px;padding:8px 10px;color:#334155}.diagnostics-log{min-height:88px;max-height:220px;overflow:auto;white-space:pre-wrap;background:#0f172a;color:#e2e8f0;border-radius:14px;padding:12px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.hint{color:#64748b;margin:10px 0 0}.form-footer{display:flex;align-items:center;gap:12px;margin:18px 0 0}[data-options-status]{font-weight:800;color:#166534}`;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountOptionsPage(root);
  });
}
