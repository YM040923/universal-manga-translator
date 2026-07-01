import { loadSettings, saveSettings, type ExtensionSettings, type ImageRange, type SettingsStorageArea } from "../settings/settings.js";

export interface OptionsPageDeps {
  storage?: SettingsStorageArea;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
}

const TEXT = {
  title: "Universal Manga Translator \u8bbe\u7f6e",
  subtitle: "\u7ba1\u7406\u540e\u7aef\u3001\u63d0\u4f9b\u5546\u3001\u9ed8\u8ba4\u7ffb\u8bd1\u4e0e\u6027\u80fd\u53c2\u6570\u3002",
  notChecked: "\u672a\u68c0\u67e5",
  checking: "\u68c0\u67e5\u4e2d...",
  connected: "\u5df2\u8fde\u63a5",
  offline: "\u79bb\u7ebf",
  backend: "\u540e\u7aef\u8fde\u63a5",
  backendUrl: "\u540e\u7aef URL",
  checkBackend: "\u68c0\u67e5\u540e\u7aef",
  provider: "\u63d0\u4f9b\u5546 / \u6a21\u578b",
  providerProfile: "\u63d0\u4f9b\u5546\u914d\u7f6e",
  translationModel: "\u7ffb\u8bd1\u6a21\u578b",
  compatibleBaseUrl: "OpenAI \u517c\u5bb9 Base URL",
  keyHint: "API key \u5bc6\u94a5\u5e94\u653e\u5728\u672c\u5730\u540e\u7aef\u73af\u5883\u53d8\u91cf\u4e2d\uff0c\u4e0d\u8981\u5b58\u5728\u63d2\u4ef6\u5b58\u50a8\u91cc\u3002",
  defaults: "\u7ffb\u8bd1\u9ed8\u8ba4\u503c",
  targetLanguage: "\u76ee\u6807\u8bed\u8a00",
  defaultRange: "\u9ed8\u8ba4\u56fe\u7247\u8303\u56f4",
  viewport: "\u7a97\u53e3\u8303\u56f4",
  fullPage: "\u6574\u9875",
  pretranslate: "\u9884\u7ffb\u8bd1\u4e0b\u4e00\u9875",
  floating: "\u663e\u793a\u60ac\u6d6e\u7ffb\u8bd1\u6309\u94ae",
  autoDefault: "\u65b0\u7f51\u7ad9\u9ed8\u8ba4\u81ea\u52a8\u7ffb\u8bd1",
  performance: "\u6027\u80fd / \u7f13\u5b58",
  timeout: "\u8bf7\u6c42\u8d85\u65f6\uff08ms\uff09",
  concurrency: "\u6700\u5927\u5e76\u53d1\u63d0\u4ea4\u6570",
  fullPageLimit: "\u6574\u9875\u6700\u5927\u56fe\u7247\u6570",
  retryCount: "\u91cd\u8bd5\u6b21\u6570",
  cacheHint: "\u5f53\u524d\u9875\u9762\u7f13\u5b58\u53ef\u4ee5\u5728 popup \u4e2d\u6e05\u7406\u3002\u540e\u7aef\u6301\u4e45\u7f13\u5b58\u7531\u672c\u5730\u670d\u52a1\u7ba1\u7406\u3002",
  save: "\u4fdd\u5b58\u8bbe\u7f6e",
  saved: "\u5df2\u4fdd\u5b58",
  saveFailed: "\u4fdd\u5b58\u5931\u8d25",
};

export async function mountOptionsPage(root: HTMLElement, deps: OptionsPageDeps = {}): Promise<void> {
  let settings = await loadSettings(deps.storage);
  root.innerHTML = markup(settings);

  const form = root.querySelector<HTMLFormElement>("[data-options-form]")!;
  const status = root.querySelector<HTMLElement>("[data-options-status]")!;
  const backendHealth = root.querySelector<HTMLElement>("[data-backend-health]")!;

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
          <div class="inline-actions"><button type="button" data-action="check-backend">${TEXT.checkBackend}</button><code>powershell -ExecutionPolicy Bypass -File .\\scripts\\start-backend.ps1</code></div>
        </section>

        <section class="settings-card" data-section="provider">
          <h2>${TEXT.provider}</h2>
          <label>${TEXT.providerProfile} <input name="providerProfile" type="text" required value="${escapeAttr(settings.providerProfile)}" /></label>
          <label>${TEXT.translationModel} <input name="translationModel" type="text" required value="${escapeAttr(settings.translationModel)}" /></label>
          <label>${TEXT.compatibleBaseUrl} <input name="openAICompatibleBaseUrl" type="url" value="${escapeAttr(settings.openAICompatibleBaseUrl)}" placeholder="https://api.openai.com/v1" /></label>
          <p class="hint">${TEXT.keyHint}</p>
        </section>

        <section class="settings-card" data-section="defaults">
          <h2>${TEXT.defaults}</h2>
          <label>${TEXT.targetLanguage} <input name="targetLanguage" type="text" required value="${escapeAttr(settings.targetLanguage)}" /></label>
          <label>${TEXT.defaultRange} <select name="imageRange"><option value="viewport" ${settings.imageRange === "viewport" ? "selected" : ""}>${TEXT.viewport}</option><option value="fullPage" ${settings.imageRange === "fullPage" ? "selected" : ""}>${TEXT.fullPage}</option></select></label>
          ${checkbox("pretranslateNextPage", TEXT.pretranslate, settings.pretranslateNextPage)}
          ${checkbox("floatingButtonEnabled", TEXT.floating, settings.floatingButtonEnabled)}
          ${checkbox("autoTranslateDefault", TEXT.autoDefault, settings.autoTranslateDefault)}
        </section>

        <section class="settings-card" data-section="performance">
          <h2>${TEXT.performance}</h2>
          <label>${TEXT.timeout} <input name="requestTimeoutMs" type="number" min="5000" max="180000" step="1000" value="${settings.requestTimeoutMs}" /></label>
          <label>${TEXT.concurrency} <input name="maxConcurrentSubmissions" type="number" min="1" max="8" value="${settings.maxConcurrentSubmissions}" /></label>
          <label>${TEXT.fullPageLimit} <input name="maxFullPageSurfaces" type="number" min="1" max="300" value="${settings.maxFullPageSurfaces}" /></label>
          <label>${TEXT.retryCount} <input name="retryCount" type="number" min="0" max="5" value="${settings.retryCount}" /></label>
          <p class="hint">${TEXT.cacheHint}</p>
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

function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char] ?? char);
}

function styles(): string {
  return `.umt-settings-page{max-width:860px;margin:0 auto;padding:24px;font:14px system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a}.page-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.page-header h1{margin:0;font-size:26px}.page-header p{margin:6px 0 0;color:#64748b}.health{border-radius:999px;background:#e2e8f0;color:#475569;padding:7px 12px;font-weight:800}.health[data-state='ok']{background:#dcfce7;color:#166534}.health[data-state='bad']{background:#fee2e2;color:#991b1b}.settings-card{background:#fff;border:1px solid #d8e2ef;border-radius:18px;padding:18px;margin:14px 0;box-shadow:0 8px 24px rgba(15,23,42,.06)}.settings-card h2{font-size:17px;margin:0 0 14px}.settings-card label{display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:center;margin:10px 0}.settings-card input:not([type='checkbox']),.settings-card select{border:1px solid #cbd5e1;border-radius:12px;padding:9px 11px;background:#f8fafc}.checkbox{display:flex!important;grid-template-columns:none!important;gap:9px!important;justify-content:flex-start}.inline-actions{display:flex;align-items:center;gap:12px;margin-top:10px}.inline-actions button,.form-footer button{border:0;border-radius:12px;background:#ff6a1a;color:#fff;padding:10px 14px;font-weight:900;cursor:pointer}.inline-actions code{background:#f1f5f9;border-radius:10px;padding:8px 10px;color:#334155}.hint{color:#64748b;margin:10px 0 0}.form-footer{display:flex;align-items:center;gap:12px;margin:18px 0 0}[data-options-status]{font-weight:800;color:#166534}`;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountOptionsPage(root);
  });
}
