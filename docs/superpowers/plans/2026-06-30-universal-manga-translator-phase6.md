# Universal Manga Translator Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extension configurable for personal daily use without editing source code: backend URL, target language, and auto-translate can be changed from an options page and used by the content script.

**Architecture:** Add a small shared extension settings module backed by `chrome.storage.sync` with safe defaults and testable dependency injection. Add a Manifest V3 options page built by Vite. Load settings before constructing the backend client and surface tasks, and add an “打开设置” button to the floating panel.

**Tech Stack:** TypeScript, Chrome MV3, Vite multi-entry build, chrome.storage, Node built-in test runner, jsdom.

---

## File Structure

- Create `apps/extension/src/settings/settings.ts`: defaults, normalize/validate, load/save settings with injectable storage area.
- Create `apps/extension/src/settings/settings.test.ts`: unit tests for defaults, partial saved settings, invalid values, and save payload.
- Modify `apps/extension/src/content/main.ts`: load settings, use backend URL, target language, and auto-translate flag.
- Modify `apps/extension/src/content/capture/surface-capture.ts`: accept `targetLanguage` argument instead of hardcoding `zh-CN`.
- Modify `apps/extension/src/content/capture/surface-capture.test.ts`: assert configured target language is used.
- Modify `apps/extension/src/content/panel/floating-panel.ts`: add optional settings button action.
- Create `apps/extension/src/options/main.ts`: options page UI and save/test status behavior.
- Create `apps/extension/src/options/main.test.ts`: jsdom test for rendering and saving options.
- Create `apps/extension/public/options.html`: options page shell.
- Modify `apps/extension/public/manifest.json`: add `options_page`.
- Modify `apps/extension/vite.config.ts`: build `options.js` entry.
- Modify `apps/extension/scripts/copy-static.mjs`: copy all files from `public/` into `dist/`.
- Modify `README.md`: document options usage and Phase 6 verification.

---

## Task 1: Settings Storage Module

- [ ] Write failing tests in `apps/extension/src/settings/settings.test.ts` for `loadSettings()` defaults, partial persisted values, invalid backend URL fallback, and `saveSettings()` payload.
- [ ] Run `pnpm --filter @umt/extension test`; expected FAIL because module does not exist.
- [ ] Implement `apps/extension/src/settings/settings.ts` with `DEFAULT_SETTINGS`, `normalizeSettings()`, `loadSettings(storage)`, and `saveSettings(settings, storage)`.
- [ ] Run `pnpm --filter @umt/extension test`; expected PASS.
- [ ] Commit: `git add apps/extension/src/settings && git commit -m "feat(extension): add persistent settings module"`.

## Task 2: Apply Settings in Content Script

- [ ] Update `apps/extension/src/content/capture/surface-capture.test.ts` to expect `createSurfaceTask(surface, priority, "ja")` uses target language `ja`.
- [ ] Run `pnpm --filter @umt/extension test`; expected FAIL because `createSurfaceTask()` accepts only two args.
- [ ] Update `createSurfaceTask(surface, priority, targetLanguage = "zh-CN")` and use the provided target.
- [ ] Update `apps/extension/src/content/main.ts` to await `loadSettings()`, pass `settings.backendUrl` to `BackendClient`, skip auto run when `settings.autoTranslate` is false, and pass `settings.targetLanguage` to `createSurfaceTask()`.
- [ ] Run `pnpm --filter @umt/extension test`, `typecheck`, and `build`; expected PASS.
- [ ] Commit: `git add apps/extension/src/content apps/extension/src/settings && git commit -m "feat(extension): apply user settings in content script"`.

## Task 3: Options Page UI

- [ ] Write failing test `apps/extension/src/options/main.test.ts` that mounts the options page with fake storage, edits backend URL/target language/auto translate, clicks save, and asserts saved settings and success text.
- [ ] Run `pnpm --filter @umt/extension test`; expected FAIL because options module does not exist.
- [ ] Implement `apps/extension/src/options/main.ts` with exported `mountOptionsPage(root, deps)` and browser auto-mount on DOMContentLoaded.
- [ ] Create `apps/extension/public/options.html` with a root element and `options.js` script.
- [ ] Update `apps/extension/public/manifest.json` with `"options_page": "options.html"`.
- [ ] Update `apps/extension/vite.config.ts` to build `options` entry.
- [ ] Update `apps/extension/scripts/copy-static.mjs` to copy every file in `public/`.
- [ ] Run `pnpm --filter @umt/extension test`, `typecheck`, and `build`; expected PASS and `apps/extension/dist/options.html` exists.
- [ ] Commit: `git add apps/extension/src/options apps/extension/public apps/extension/vite.config.ts apps/extension/scripts/copy-static.mjs && git commit -m "feat(extension): add options page"`.

## Task 4: Panel Settings Button

- [ ] Add/adjust panel test if needed to verify an optional settings button calls `chrome.runtime.openOptionsPage()` via an injected action.
- [ ] Implement `onOpenSettings?: () => void` in `FloatingPanelActions` and add button label `打开设置` when provided.
- [ ] Wire `apps/extension/src/content/main.ts` to call `chrome.runtime.openOptionsPage()` when available.
- [ ] Run extension test/typecheck/build; expected PASS.
- [ ] Commit: `git add apps/extension/src/content && git commit -m "feat(extension): open options from floating panel"`.

## Task 5: Full Verification and Docs

- [ ] Run full verification: `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`; expected all exit 0.
- [ ] Update README with settings usage and Phase 6 verification notes.
- [ ] Commit: `git add README.md docs/superpowers/plans/2026-06-30-universal-manga-translator-phase6.md && git commit -m "docs: record phase 6 settings verification"`.