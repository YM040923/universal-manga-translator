# Compact Popup Backend Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the toolbar popup more compact and turn the options page into a dedicated backend/provider/performance settings page.

**Architecture:** Extend the shared extension settings model with backend and performance fields, then update the popup to remain a high-frequency compact control surface. Redesign the options page as a full settings page that owns lower-frequency backend/provider/default/performance settings, while content script consumes practical limits such as full-page surface cap and max concurrent submissions.

**Tech Stack:** TypeScript, Chrome MV3 APIs, Vite, Node built-in test runner, jsdom.

---

## File Structure

- `apps/extension/src/settings/settings.ts`: Add provider/performance fields, URL validation, and numeric clamping.
- `apps/extension/src/settings/settings.test.ts`: Cover new defaults, normalization, and persistence.
- `apps/extension/src/popup/main.ts`: Reduce spacing, remove long hint, keep only high-frequency controls, ensure gear opens options page.
- `apps/extension/src/popup/main.test.ts`: Assert compact CSS markers, settings button behavior, and existing popup functionality.
- `apps/extension/src/options/main.ts`: Replace simple form with full settings page sections: backend, provider/model, defaults, performance/cache.
- `apps/extension/src/options/main.test.ts`: Cover rendering sections, health check, saving all settings, and preserving site settings.
- `apps/extension/src/content/main.ts`: Use `maxFullPageSurfaces` and `maxConcurrentSubmissions` when submitting surfaces.

---

### Task 1: Extend settings model for backend and performance controls

**Files:**
- Modify: `apps/extension/src/settings/settings.ts`
- Modify: `apps/extension/src/settings/settings.test.ts`

- [ ] Add failing tests asserting new defaults: `providerProfile: "mock"`, `openAICompatibleBaseUrl: ""`, `requestTimeoutMs: 60000`, `maxConcurrentSubmissions: 2`, `maxFullPageSurfaces: 80`, `retryCount: 1`.
- [ ] Add failing tests asserting invalid numeric values clamp/fallback to defaults and valid values persist.
- [ ] Run `pnpm --filter @umt/extension build:test` and `node --test apps/extension/dist-test/settings/settings.test.js`; expect failure before implementation.
- [ ] Implement new fields in `ExtensionSettings`, `DEFAULT_SETTINGS`, and `normalizeSettings`.
- [ ] Add helpers: HTTP/HTTPS-or-empty URL normalization and integer clamping.
- [ ] Run settings tests; expect PASS.
- [ ] Commit: `feat(extension): add backend performance settings`.

### Task 2: Compact the toolbar popup

**Files:**
- Modify: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/src/popup/main.test.ts`

- [ ] Add failing tests that assert the popup root has `data-density="compact"`, the long current-scope hint is absent, and clicking the gear calls `openOptionsPage`.
- [ ] Run popup tests; expect failure before implementation.
- [ ] Update popup markup to use a compact header, compact site card, compact settings rows, two-column toggle row, and condensed bottom action row.
- [ ] Change CSS target width from 390px to about 350px, reduce padding and row heights, and remove paragraph-style current-scope text from normal view.
- [ ] Keep existing popup controls and command behavior unchanged.
- [ ] Run popup tests; expect PASS.
- [ ] Commit: `feat(extension): compact toolbar popup layout`.

### Task 3: Redesign options page into settings page

**Files:**
- Modify: `apps/extension/src/options/main.ts`
- Modify: `apps/extension/src/options/main.test.ts`

- [ ] Add failing options tests for section headings: backend connection, provider/model, translation defaults, performance/cache.
- [ ] Add failing options tests for saving backend URL, model, provider profile, compatible base URL, target language, default range, pretranslate, floating button, default auto translate, timeout, concurrency, full-page cap, and retry count while preserving `siteSettings`.
- [ ] Add failing options test for backend health check dependency injection showing connected/offline status.
- [ ] Run options tests; expect failure before implementation.
- [ ] Implement `OptionsPageDeps.checkBackend` and a card-based settings page.
- [ ] Render fields with `data-field` selectors and section `data-section` markers.
- [ ] Save all fields through `saveSettings({ ...settings, ...formValues })`.
- [ ] Add health check button that checks the configured backend URL and writes `Connected` or `Offline` to a status element.
- [ ] Include API key guidance text saying secrets belong in the local backend environment, not extension storage.
- [ ] Run options tests; expect PASS.
- [ ] Commit: `feat(extension): add backend settings page`.

### Task 4: Apply performance limits in content script

**Files:**
- Modify: `apps/extension/src/content/main.ts`

- [ ] Add a small helper inside content main or nearby module to limit selected surfaces: full-page mode slices to `settings.maxFullPageSurfaces`; viewport mode remains p0/p1.
- [ ] Change submission loop to process with up to `settings.maxConcurrentSubmissions` concurrent submissions.
- [ ] Keep status updates, overlay rendering, and failure accounting intact.
- [ ] Run `pnpm --filter @umt/extension typecheck` and `pnpm --filter @umt/extension test`; expect PASS.
- [ ] Commit: `feat(extension): apply advanced submission limits`.

### Task 5: Full verification

**Files:**
- Modify only files needed for verification fixes.

- [ ] Run `pnpm doctor`; expect exit 0.
- [ ] Run `pnpm test`; expect exit 0.
- [ ] Run `pnpm build`; expect exit 0.
- [ ] Run `pnpm test:e2e`; expect exit 0.
- [ ] Run `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`; expect exit 0.
- [ ] Inspect popup build artifacts and manifest action popup.
- [ ] Run `git status --short`; ensure `.superpowers/`, `dist`, and `dist-test` are not committed.
- [ ] Commit any verification fixes as `fix(extension): verify compact settings redesign`.