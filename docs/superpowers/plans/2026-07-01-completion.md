# Universal Manga Translator Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining high-impact Universal Manga Translator functionality needed for personal daily use.

**Architecture:** Add small tested capabilities to the existing TypeScript monorepo. Keep secrets in the local backend, route browser-only screenshot capture through the MV3 background script, and expose product controls through the toolbar popup/options page.

**Tech Stack:** TypeScript, Chrome MV3, Fastify, SQLite, Node test runner, Vite, Playwright fixtures.

---

## Phase 11: Runtime AI Status and UI Polish

### Task 1: Backend sanitized config status

**Files:**
- Modify: `apps/server/src/api/server.ts`
- Modify: `apps/server/src/api/server.test.ts`
- Modify: `apps/server/src/config/env.ts`

Steps:
- [ ] Add a failing server test for `GET /v1/config/status` that proves API keys are not returned.
- [ ] Extend `BuildServerOptions` with optional `openAICompatibleBaseUrl`, `openAIModel`, and `openAIApiKeyConfigured` fields.
- [ ] Implement `GET /v1/config/status` returning provider, target language, provider profile, base URL, model, and boolean key status.
- [ ] Wire `main.ts` to pass sanitized env-derived config.
- [ ] Run `pnpm --filter @umt/server test`.
- [ ] Commit `feat(server): expose sanitized provider status`.

### Task 2: Extension config status client and settings display

**Files:**
- Modify: `apps/extension/src/content/client/backend-client.ts`
- Modify: `apps/extension/src/content/client/backend-client.test.ts`
- Modify: `apps/extension/src/options/main.ts`
- Modify: `apps/extension/src/options/main.test.ts`

Steps:
- [ ] Add failing tests for `BackendClient.configStatus()` and Chinese options-page provider status rendering.
- [ ] Implement the client method.
- [ ] Show backend provider status in the options page without exposing secrets.
- [ ] Run `pnpm --filter @umt/extension test`.
- [ ] Commit `feat(extension): show backend provider status`.

## Phase 12: Screenshot Fallback and Manual Region Translation

### Task 3: MV3 screenshot capture bridge

**Files:**
- Modify: `apps/extension/src/background/main.ts`
- Create: `apps/extension/src/background/capture.test.ts`
- Create: `apps/extension/src/background/capture.ts`
- Modify: `apps/extension/src/content/messages.ts`

Steps:
- [ ] Add failing tests for capture request/response message shapes.
- [ ] Implement typed screenshot capture messages.
- [ ] Implement background handler using `chrome.tabs.captureVisibleTab`.
- [ ] Add manifest permission if missing.
- [ ] Run extension tests/build.
- [ ] Commit `feat(extension): add visible tab capture bridge`.

### Task 4: Crop and fallback submission

**Files:**
- Create: `apps/extension/src/content/capture/screenshot-crop.ts`
- Create: `apps/extension/src/content/capture/screenshot-crop.test.ts`
- Modify: `apps/extension/src/content/capture/surface-capture.ts`
- Modify: `apps/extension/src/content/main.ts`

Steps:
- [ ] Add failing tests for viewport-rect to screenshot-pixel crop math.
- [ ] Implement screenshot cropping with device-pixel-ratio support.
- [ ] Attempt screenshot fallback when a detected surface has no usable image URL/data.
- [ ] Run extension tests/build.
- [ ] Commit `feat(extension): submit screenshot fallback crops`.

### Task 5: Manual selection mode

**Files:**
- Create: `apps/extension/src/content/selection/manual-selection.ts`
- Create: `apps/extension/src/content/selection/manual-selection.test.ts`
- Modify: `apps/extension/src/content/main.ts`
- Modify: `apps/extension/src/content/panel/floating-panel.ts`
- Modify: `apps/extension/src/popup/main.ts`

Steps:
- [ ] Add failing tests for selection rectangle lifecycle.
- [ ] Implement drag-to-select overlay.
- [ ] Wire floating button and popup command to start selection.
- [ ] Submit selected screenshot crop and render result at selected location.
- [ ] Run extension tests/build and loaded-extension E2E.
- [ ] Commit `feat(extension): add manual region translation`.

## Phase 13: Task Control and Cache Management

### Task 6: Cache stats and clear API

**Files:**
- Modify: `apps/server/src/cache/surface-cache.ts`
- Modify: `apps/server/src/cache/surface-cache.test.ts`
- Modify: `apps/server/src/api/server.ts`
- Modify: `apps/server/src/api/server.test.ts`

Steps:
- [ ] Add failing tests for stats and clear counts.
- [ ] Implement `SurfaceCache.stats()` and `SurfaceCache.clear()`.
- [ ] Add `GET /v1/cache/stats` and `POST /v1/cache/clear`.
- [ ] Run server tests.
- [ ] Commit `feat(server): add cache management api`.

### Task 7: Retranslate and cancellation endpoints

**Files:**
- Modify: `apps/server/src/api/server.ts`
- Modify: `apps/server/src/api/server.test.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/extension/src/content/client/backend-client.ts`

Steps:
- [ ] Add failing tests for force retranslate bypassing cache and cancel returning accepted status.
- [ ] Add protocol types.
- [ ] Implement `POST /v1/surfaces/retranslate` and `POST /v1/surfaces/cancel` with current synchronous-server limitations documented in response.
- [ ] Add extension client methods.
- [ ] Run shared/server/extension tests.
- [ ] Commit `feat: add retranslate and cancel controls`.

### Task 8: Popup/options controls

**Files:**
- Modify: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/src/popup/main.test.ts`
- Modify: `apps/extension/src/options/main.ts`
- Modify: `apps/extension/src/options/main.test.ts`

Steps:
- [ ] Add failing tests for clear-cache and retranslate UI actions.
- [ ] Implement UI actions that call backend client or content messages.
- [ ] Run extension tests/build.
- [ ] Commit `feat(extension): expose cache and retranslate controls`.

## Phase 14: Provider Pipeline Interfaces

### Task 9: OCR + translation interfaces

**Files:**
- Create: `apps/server/src/providers/pipeline-provider.ts`
- Create: `apps/server/src/providers/pipeline-provider.test.ts`
- Modify: `apps/server/src/providers/provider.ts`

Steps:
- [ ] Add failing tests for composing OCR regions with translated text.
- [ ] Add interfaces for `OcrProvider` and `TextTranslationProvider`.
- [ ] Implement `OcrThenTranslateProvider` with injectable providers.
- [ ] Run server tests.
- [ ] Commit `feat(server): add ocr translation provider pipeline`.

## Phase 15: Overlay and Compatibility Hardening

### Task 10: Text fitting and style modes

**Files:**
- Modify: `apps/server/src/layout/layout.ts`
- Modify: `apps/extension/src/content/overlay/overlay-renderer.ts`
- Modify: tests for both files

Steps:
- [ ] Add failing tests for long-text fitting style and vertical orientation.
- [ ] Implement deterministic style values that the renderer can apply.
- [ ] Run tests/build.
- [ ] Commit `feat(extension): improve overlay text fitting`.

### Task 11: Real-site compatibility evidence loop

**Files:**
- Modify: `scripts/scan-sites.mjs`
- Modify: `docs/compat/sites.md`

Steps:
- [ ] Add scanner output fields for screenshot/capture capability hints.
- [ ] Run scanner against fixtures.
- [ ] Document evidence and next real-site blockers.
- [ ] Run root tests.
- [ ] Commit `docs: update compatibility evidence`.

## Final Verification

- [ ] Run `pnpm doctor`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `pnpm test:e2e`.
- [ ] Run `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
- [ ] Update README with final usage notes.
- [ ] Commit final docs.
