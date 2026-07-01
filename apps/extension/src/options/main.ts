import { loadSettings, saveSettings, type ExtensionSettings, type ImageRange, type SettingsStorageArea } from "../settings/settings.js";

export interface OptionsPageDeps {
  storage?: SettingsStorageArea;
  checkBackend?: (backendUrl: string) => Promise<boolean>;
}

export async function mountOptionsPage(root: HTMLElement, deps: OptionsPageDeps = {}): Promise<void> {
  let settings = await loadSettings(deps.storage);
  root.innerHTML = markup(settings);

  const form = root.querySelector<HTMLFormElement>("[data-options-form]")!;
  const status = root.querySelector<HTMLElement>("[data-options-status]")!;
  const backendHealth = root.querySelector<HTMLElement>("[data-backend-health]")!;

  root.querySelector<HTMLButtonElement>("[data-action='check-backend']")!.addEventListener("click", () => {
    const backendUrl = field<HTMLInputElement>(form, "backendUrl").value;
    backendHealth.textContent = "Checking...";
    void (deps.checkBackend ?? defaultCheckBackend)(backendUrl).then((ok) => {
      backendHealth.textContent = ok ? "Connected" : "Offline";
      backendHealth.dataset.state = ok ? "ok" : "bad";
    }).catch(() => {
      backendHealth.textContent = "Offline";
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
      status.textContent = "Saved";
      syncForm(form, saved);
    }).catch((error) => {
      status.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

function markup(settings: ExtensionSettings): string {
  return `
    <style>${styles()}</style>
    <section class="umt-settings-page">
      <header class="page-header">
        <div><h1>Universal Manga Translator Settings</h1><p>Backend, provider, defaults, and performance controls.</p></div>
        <span data-backend-health class="health">Not checked</span>
      </header>
      <form data-options-form>
        <section class="settings-card" data-section="backend">
          <h2>Backend connection</h2>
          <label>Backend URL <input name="backendUrl" type="url" required value="${escapeAttr(settings.backendUrl)}" /></label>
          <div class="inline-actions"><button type="button" data-action="check-backend">Check backend</button><code>powershell -ExecutionPolicy Bypass -File .\\scripts\\start-backend.ps1</code></div>
        </section>

        <section class="settings-card" data-section="provider">
          <h2>Provider / model</h2>
          <label>Provider profile <input name="providerProfile" type="text" required value="${escapeAttr(settings.providerProfile)}" /></label>
          <label>Translation model <input name="translationModel" type="text" required value="${escapeAttr(settings.translationModel)}" /></label>
          <label>OpenAI-compatible base URL <input name="openAICompatibleBaseUrl" type="url" value="${escapeAttr(settings.openAICompatibleBaseUrl)}" placeholder="https://api.openai.com/v1" /></label>
          <p class="hint">API key secrets should stay in the local backend environment, not in extension storage.</p>
        </section>

        <section class="settings-card" data-section="defaults">
          <h2>Translation defaults</h2>
          <label>Target language <input name="targetLanguage" type="text" required value="${escapeAttr(settings.targetLanguage)}" /></label>
          <label>Default image range <select name="imageRange"><option value="viewport" ${settings.imageRange === "viewport" ? "selected" : ""}>Viewport</option><option value="fullPage" ${settings.imageRange === "fullPage" ? "selected" : ""}>Full page</option></select></label>
          ${checkbox("pretranslateNextPage", "Pretranslate next page", settings.pretranslateNextPage)}
          ${checkbox("floatingButtonEnabled", "Show floating translate button", settings.floatingButtonEnabled)}
          ${checkbox("autoTranslateDefault", "Auto-translate new sites by default", settings.autoTranslateDefault)}
        </section>

        <section class="settings-card" data-section="performance">
          <h2>Performance / cache</h2>
          <label>Request timeout (ms) <input name="requestTimeoutMs" type="number" min="5000" max="180000" step="1000" value="${settings.requestTimeoutMs}" /></label>
          <label>Max concurrent submissions <input name="maxConcurrentSubmissions" type="number" min="1" max="8" value="${settings.maxConcurrentSubmissions}" /></label>
          <label>Max full-page surfaces <input name="maxFullPageSurfaces" type="number" min="1" max="300" value="${settings.maxFullPageSurfaces}" /></label>
          <label>Retry count <input name="retryCount" type="number" min="0" max="5" value="${settings.retryCount}" /></label>
          <p class="hint">Cache clearing is available from the popup for the current page. Backend persistent cache remains managed by the local service.</p>
        </section>

        <footer class="form-footer"><button type="submit">Save settings</button><p data-options-status></p></footer>
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