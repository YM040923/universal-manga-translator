import { loadSettings, saveSettings, type SettingsStorageArea } from "../settings/settings.js";

export interface OptionsPageDeps {
  storage?: SettingsStorageArea;
}

export async function mountOptionsPage(root: HTMLElement, deps: OptionsPageDeps = {}): Promise<void> {
  const settings = await loadSettings(deps.storage);
  root.innerHTML = `
    <section class="umt-options">
      <h1>Universal Manga Translator Settings</h1>
      <form data-options-form>
        <label>Backend URL <input name="backendUrl" type="url" required /></label>
        <label>Target language <input name="targetLanguage" type="text" required /></label>
        <label class="checkbox"><input name="autoTranslate" type="checkbox" /> Auto translate current and nearby pages</label>
        <button type="submit">Save</button>
        <p data-options-status></p>
      </form>
    </section>
  `;
  const form = root.querySelector<HTMLFormElement>("[data-options-form]")!;
  const backendUrl = form.elements.namedItem("backendUrl") as HTMLInputElement;
  const targetLanguage = form.elements.namedItem("targetLanguage") as HTMLInputElement;
  const autoTranslate = form.elements.namedItem("autoTranslate") as HTMLInputElement;
  const status = root.querySelector<HTMLElement>("[data-options-status]")!;
  backendUrl.value = settings.backendUrl;
  targetLanguage.value = settings.targetLanguage;
  autoTranslate.checked = settings.autoTranslate;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings({ backendUrl: backendUrl.value, targetLanguage: targetLanguage.value, autoTranslate: autoTranslate.checked }, deps.storage).then(() => {
      status.textContent = "Saved";
    }).catch((error) => {
      status.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (root) void mountOptionsPage(root);
  });
}