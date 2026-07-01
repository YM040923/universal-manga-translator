# Compact Popup and Backend Settings Page Design

Date: 2026-07-01
Project: Universal Manga Translator

## Purpose

Refine the extension UI after the first popup implementation. The current toolbar popup works functionally, but it has too much vertical whitespace and mixes high-frequency reading controls with lower-frequency backend configuration.

The new design keeps the toolbar popup as the fast control surface and moves advanced/backend settings into a dedicated settings page opened from the popup's top-right settings button.

## Design Goals

1. Make the popup feel like a compact browser extension control panel, not a tall settings page.
2. Keep high-frequency reading actions in the popup.
3. Move low-frequency backend/provider/performance settings into the options/settings page.
4. Preserve all existing behavior: site auto-translate, scope controls, language/model/range settings, pretranslation, floating button, backend health, and page actions.
5. Keep the implementation small and testable.

## Popup Information Architecture

The popup should be condensed into four compact areas.

### Header

The header should be a single short row:

- Small brand mark and product name.
- Compact backend status text, for example `Connected · mock` or `Backend offline`.
- Right-side icon buttons:
  - Settings opens the full options page.
  - Optional future feedback/help button may remain visual-only or be omitted in this phase.

The header should not consume large vertical space.

### Site card

The site card remains the most important section, but it should be compressed.

Content:

- `本站自动翻译` label.
- ON/OFF pill or toggle on the same row.
- Two compact segmented buttons:
  - 全站页面
  - 相似路径

Remove the long current-scope hint from the default popup view. If needed, show it as a small title/tooltip later, not as a full paragraph.

### Quick settings card

Keep only compact rows:

- 语言: select.
- 模型: select.
- 范围: window/full page segmented control.
- A compact two-column toggle row:
  - 预翻译.
  - 悬浮按钮.

Rows should be about 36-42 px high, not 56 px. Card padding should be around 8-10 px, not 16-18 px.

### Bottom actions

Condense the footer actions:

- Primary button: `翻译/刷新` or `翻译本页`.
- Secondary button: `暂停`.
- Icon/destructive button: clear current page/cache, with second-click confirmation.

The popup should fit comfortably without feeling stretched. The target width is about 330-360 px; target height is about 430-480 px depending on platform font rendering.

## Settings Page Information Architecture

The existing options page should become the full settings page. The popup's gear button opens this page.

The settings page should use sections/cards and can be taller because it is not constrained by the extension popup.

### Section 1: Backend connection

Fields and status:

- Backend URL.
- Health status/check button.
- Short local startup hint, for example the PowerShell backend start command.

### Section 2: Provider and model

Fields:

- Translation model name.
- Provider mode/profile display or text field.
- OpenAI-compatible base URL field for future provider use.
- API key environment variable hint. Do not collect or store plaintext API keys in extension storage in this phase.

### Section 3: Translation defaults

Fields:

- Target language.
- Default image range.
- Pretranslate next page.
- Floating button enabled.
- Default auto-translate behavior for new sites.

### Section 4: Performance and cache

Fields:

- Max concurrent image submissions.
- Max full-page surfaces per scan.
- Request timeout seconds.
- Retry count.
- Clear local extension settings/cache action if supported.

Not every field has to be wired to backend behavior immediately if the backend does not yet consume it, but it must be represented in the settings model only when the value is meaningful to extension behavior or near-term backend calls. Avoid fake controls that do nothing silently. If a field is reserved for future backend support, mark it clearly.

## Settings Model Changes

Extend `ExtensionSettings` with backend/control fields needed by the settings page:

- `providerProfile`: string, default `mock`.
- `openAICompatibleBaseUrl`: string, default empty string.
- `requestTimeoutMs`: number, default 60000.
- `maxConcurrentSubmissions`: number, default 2.
- `maxFullPageSurfaces`: number, default 80.
- `retryCount`: number, default 1.

Existing fields remain:

- `backendUrl`.
- `targetLanguage`.
- `translationModel`.
- `autoTranslateDefault`.
- `imageRange`.
- `pretranslateNextPage`.
- `floatingButtonEnabled`.
- `siteSettings`.

Validation rules:

- URLs must be HTTP/HTTPS or empty where allowed.
- Numeric fields must be clamped to safe ranges.
- Invalid saved values fall back to defaults.
- Existing old settings must continue to load.

## Behavior Changes

### Popup

- Re-layout popup to be tighter.
- Gear button continues to call `chrome.runtime.openOptionsPage()`.
- No backend advanced fields are shown in popup.
- Popup tests should assert compact behavior through rendered content and class names/data attributes, not pixel snapshots.

### Options/settings page

- Replace the basic form with a product-style settings page.
- Save all fields without overwriting site settings.
- Include a backend health check state using the configured backend URL.
- Make API key guidance explicit: use local backend environment variables, not extension storage.

### Content script

- Use `maxFullPageSurfaces` when image range is full page.
- Use `maxConcurrentSubmissions` to avoid flooding the backend. A simple sequential/concurrency-limited loop is sufficient.
- Timeout/retry can remain stored for backend/client use if implemented in the frontend client; if not implemented in this phase, display them as advanced settings but avoid claiming they affect requests.

## Error Handling

- If backend health check fails in settings page, show a clear offline state and keep form editable.
- Invalid fields should normalize on save and show the normalized result.
- Clear/destructive controls require confirmation.
- Settings page must not store secrets.

## Testing Strategy

Automated tests:

- Settings normalization tests for new fields and numeric clamping.
- Popup rendering tests for compact layout markers and settings button behavior.
- Options page tests for rendering sections, preserving site settings, saving advanced fields, and backend health check behavior.
- Existing extension build-output tests.
- Existing e2e tests must continue to pass.

Manual verification:

- Load popup and confirm it is visually tighter.
- Click gear and confirm it opens the settings/options page.
- Save backend/provider/performance settings and reload options page to confirm persistence.
- Confirm popup still controls current page translation.

## Acceptance Criteria

1. Popup is visibly more compact than the previous implementation.
2. Popup no longer exposes backend/provider advanced settings.
3. Popup gear opens a dedicated settings/options page.
4. Settings page contains backend connection, provider/model, defaults, and performance/cache sections.
5. Settings page can save and reload advanced settings without losing site settings.
6. Existing popup/content translation behavior still works.
7. Tests and build pass.

## Visual Reference

The approved visual direction is the right-side mockup in the visual companion session at:

`F:\meihua\universal-manga-translator\.superpowers\brainstorm\popup-settings-compact\content\compact-popup-and-settings.html`