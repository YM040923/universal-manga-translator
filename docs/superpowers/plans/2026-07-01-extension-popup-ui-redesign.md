# Extension Popup UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished Chrome toolbar popup control panel for Universal Manga Translator and replace the current in-page debug panel with a minimal floating translate button.

**Architecture:** Add a MV3 `action.default_popup` page that reads/writes shared extension settings, queries backend health, and sends commands to the active tab. Extend the content script to use normalized global/per-site settings, listen for storage and popup command messages, and render only a compact floating button. Preserve the existing backend translation pipeline and overlay renderer.

**Tech Stack:** TypeScript, Chrome MV3 APIs, Vite multi-entry build, Node built-in test runner, jsdom, Fastify backend health endpoint.

---

## File Structure

- `apps/extension/src/settings/settings.ts`: Owns global settings, per-site settings, normalization, site matching, and storage helpers.
- `apps/extension/src/popup/main.ts`: Owns popup rendering, backend health display, active-tab site settings, storage writes, and tab messaging.
- `apps/extension/src/popup/main.test.ts`: jsdom unit tests for popup behavior.
- `apps/extension/public/popup.html`: Static popup shell loaded by Chrome action popup.
- `apps/extension/public/manifest.json`: Adds `action.default_popup`.
- `apps/extension/vite.app.config.ts`: Adds popup build entry.
- `apps/extension/src/content/panel/floating-panel.ts`: Replaces debug panel with compact floating button component.
- `apps/extension/src/content/panel/floating-panel.test.ts`: Updates tests for compact button behavior.
- `apps/extension/src/content/main.ts`: Integrates live settings, site auto-translate matching, full-page vs viewport translation range, popup commands, and compact button visibility.
- `apps/extension/src/content/messages.ts`: Defines typed popup-to-content command messages.
- `apps/extension/src/options/main.ts`: Keeps advanced backend settings but uses extended settings model.
- `apps/extension/src/options/main.test.ts`: Updates options tests for extended settings preservation.
- `apps/extension/scripts/build-output.test.mjs`: Ensures `popup.html` and `popup.js` are emitted and manifest references the popup.

---

### Task 1: Extend settings model and site-scope matching

**Files:**
- Modify: `apps/extension/src/settings/settings.ts`
- Modify: `apps/extension/src/settings/settings.test.ts`

- [ ] Write failing settings tests covering extended defaults, legacy `autoTranslate`, invalid value normalization, origin overrides, similar-path overrides, unsupported URLs, and normalized persistence.
- [ ] Run `pnpm --filter @umt/extension build:test` and `node --test apps/extension/dist-test/settings/settings.test.js`; expect failure before implementation.
- [ ] Implement `ImageRange`, `SiteScope`, `SiteSettings`, `ExtensionSettings`, `normalizeSettings`, `loadSettings`, `saveSettings`, `getEffectiveSiteSettings`, `setSiteSettings`, and `deriveSimilarPathPrefix` in `apps/extension/src/settings/settings.ts`.
- [ ] Ensure backward compatibility maps old `autoTranslate` to new `autoTranslateDefault`.
- [ ] Run the settings test commands again; expect PASS.
- [ ] Commit: `feat(extension): extend popup settings model`.

### Task 2: Add popup shell, build entry, and manifest wiring

**Files:**
- Create: `apps/extension/public/popup.html`
- Create initially: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/public/manifest.json`
- Modify: `apps/extension/vite.app.config.ts`
- Modify: `apps/extension/scripts/build-output.test.mjs`

- [ ] Add build-output assertions that `dist/popup.html` and `dist/popup.js` exist and `manifest.action.default_popup` equals `popup.html`.
- [ ] Run `pnpm --filter @umt/extension build` and `node --test apps/extension/scripts/build-output.test.mjs`; expect failure before wiring.
- [ ] Create `popup.html` with `<main id="app"></main>` and `<script type="module" src="./popup.js"></script>`.
- [ ] Add `"default_popup": "popup.html"` under manifest `action`.
- [ ] Add `popup: resolve(__dirname, "src/popup/main.ts")` to `vite.app.config.ts` Rollup input.
- [ ] Add temporary popup entry that writes `Universal Manga Translator` into `#app`.
- [ ] Run build-output commands again; expect PASS.
- [ ] Commit: `feat(extension): add toolbar popup entry`.

### Task 3: Implement polished popup control panel

**Files:**
- Replace: `apps/extension/src/popup/main.ts`
- Create: `apps/extension/src/popup/main.test.ts`
- Create: `apps/extension/src/content/messages.ts`

- [ ] Write jsdom tests for popup rendering active site state, backend status, unsupported tabs, saving target language/image range, and sending translate command.
- [ ] Run `pnpm --filter @umt/extension build:test` and `node --test apps/extension/dist-test/popup/main.test.js`; expect failure before implementation.
- [ ] Implement `mountPopupPage(root, deps)` with dependency injection for storage, active tab query, backend health, tab messaging, and options-page opening.
- [ ] Render product-style popup: header, backend health pill, site auto-translate card, origin/similar-path segmented control, target language select, model select, viewport/full-page segmented control, pretranslate toggle, floating button toggle, upload placeholder, action row.
- [ ] Persist global settings with `saveSettings` and per-site settings with `setSiteSettings`.
- [ ] Implement clear-cache action with second-click confirmation.
- [ ] Create `UmtContentCommand` and `isUmtContentCommand` in `apps/extension/src/content/messages.ts` for `translate`, `refresh`, `togglePause`, and `clearPage`.
- [ ] Run popup tests; expect PASS.
- [ ] Commit: `feat(extension): implement toolbar popup controls`.

### Task 4: Replace in-page debug panel with compact floating button

**Files:**
- Modify: `apps/extension/src/content/panel/floating-panel.ts`
- Modify: `apps/extension/src/content/panel/floating-panel.test.ts`

- [ ] Replace tests so they expect `[data-umt-floating-button]`, Chinese compact label, status updates, state data attribute, and visibility toggling.
- [ ] Run `pnpm --filter @umt/extension build:test` and `node --test apps/extension/dist-test/content/panel/floating-panel.test.js`; expect failure against old panel.
- [ ] Replace the old multi-button debug box with a compact rounded orange floating button containing an icon and status text.
- [ ] Provide `setStatus(text, state)` and `setEnabled(enabled)` APIs.
- [ ] Run floating-panel tests; expect PASS.
- [ ] Commit: `feat(extension): simplify in-page floating button`.

### Task 5: Integrate popup commands and live settings into content script

**Files:**
- Modify: `apps/extension/src/content/main.ts`

- [ ] Refactor `settings`, `client`, and `renderer` to support reloading settings when storage changes.
- [ ] Use `getEffectiveSiteSettings(settings, window.location.href)` to decide whether auto-translate is enabled for this site.
- [ ] Use `settings.imageRange`: `viewport` submits p0/p1, `fullPage` submits all prioritized surfaces.
- [ ] Apply `settings.floatingButtonEnabled` to the compact floating button.
- [ ] Add `chrome.storage.onChanged` listener to reload settings, refresh panel state, and trigger translation when enabled.
- [ ] Add `chrome.runtime.onMessage` listener using `isUmtContentCommand` for `translate`, `refresh`, `togglePause`, and `clearPage`.
- [ ] Preserve page-change observer, backend event stream, health check, scroll/resize refresh, manual override saving, and overlay rendering.
- [ ] Run `pnpm --filter @umt/extension typecheck` and `pnpm --filter @umt/extension test`; expect PASS.
- [ ] Commit: `feat(extension): connect popup commands to content script`.

### Task 6: Update options page for extended settings preservation

**Files:**
- Modify: `apps/extension/src/options/main.ts`
- Modify: `apps/extension/src/options/main.test.ts`

- [ ] Update options tests to verify saving backend URL, target language, and translation model preserves popup-controlled fields such as `imageRange` and `floatingButtonEnabled`.
- [ ] Run `pnpm --filter @umt/extension build:test` and `node --test apps/extension/dist-test/options/main.test.js`; expect failure before options update.
- [ ] Add `translationModel` input to options page.
- [ ] On submit, save `{ ...settings, backendUrl, targetLanguage, translationModel }` instead of replacing the settings object with a partial legacy shape.
- [ ] Run options tests; expect PASS.
- [ ] Commit: `feat(extension): preserve popup settings in options`.

### Task 7: Full verification and completion audit

**Files:**
- Modify only files needed to fix verification failures.

- [ ] Run `pnpm doctor`; expect exit 0.
- [ ] Run `pnpm test`; expect exit 0.
- [ ] Run `pnpm build`; expect exit 0.
- [ ] Run `pnpm test:e2e`; expect exit 0.
- [ ] Run `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`; expect exit 0.
- [ ] Inspect `apps/extension/dist/manifest.json`; verify `action.default_popup` is `popup.html`.
- [ ] Verify `apps/extension/dist/popup.html` and `apps/extension/dist/popup.js` exist.
- [ ] Run `git status --short`; ensure generated `dist` and `dist-test` artifacts are not committed.
- [ ] If verification fixes are needed, commit them as `fix(extension): polish popup redesign verification`.
- [ ] Audit acceptance criteria from the design spec: toolbar popup, compact page button, origin/similar-path settings, editable popup settings, backend health, popup commands, confirmed clear action, and passing tests.
