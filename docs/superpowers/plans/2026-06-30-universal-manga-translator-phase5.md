# Universal Manga Translator Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve universal-site support by detecting `<img>`, CSS background manga panels, and exportable canvas readers, sending either image URLs or image data to the backend, and keeping overlays aligned after layout changes.

**Architecture:** Extend the extension surface model from image-only to element-based surfaces. Keep backend protocol unchanged because `SurfaceTask` already supports both `imageUrl` and `imageData`. Add capture fallbacks in the content script, then make the overlay renderer remember rendered surfaces and refresh their coordinates on resize/lazy-layout changes.

**Tech Stack:** TypeScript, Chrome MV3 content scripts, Node built-in test runner, jsdom, existing shared geometry/protocol helpers.

---

## File Structure

- Modify `apps/extension/src/content/detector/surface-detector.ts`: introduce generic `DetectedSurface` with `kind`, optional `imageUrl`, optional `imageData`, and support for image/background/canvas surfaces.
- Modify `apps/extension/src/content/detector/surface-detector.test.ts`: add tests for background and canvas detection.
- Modify `apps/extension/src/content/capture/surface-capture.ts`: submit `imageUrl` when available and `imageData` for exportable canvas/background fallback surfaces.
- Create `apps/extension/src/content/capture/surface-capture.test.ts`: verify `SurfaceTask` carries image URL and canvas image data correctly.
- Modify `apps/extension/src/content/overlay/overlay-renderer.ts`: remember surface render inputs and expose `refreshAll()`.
- Modify `apps/extension/src/content/overlay/overlay-renderer.test.ts`: verify refresh updates overlay coordinates after element rect changes.
- Modify `apps/extension/src/content/main.ts`: call `renderer.refreshAll()` on resize and after rescans/scroll-driven layout changes.
- Update `README.md`: document Phase 5 verification and supported surface types.

---

## Task 1: Generic Surface Detection

**Files:**
- Modify: `apps/extension/src/content/detector/surface-detector.ts`
- Modify: `apps/extension/src/content/detector/surface-detector.test.ts`

- [ ] **Step 1: Write failing detector tests**

Add tests that create a large CSS background element and a large canvas, then assert they are detected with kind `background` and `canvas`.

- [ ] **Step 2: Run detector tests to verify failure**

Run: `pnpm --filter @umt/extension test`
Expected: FAIL because detector currently returns only `<img>` surfaces.

- [ ] **Step 3: Implement generic detector**

Update `DetectedSurface` so `element` is `HTMLElement`, `kind` is `"image" | "background" | "canvas"`, `imageUrl` is optional, and `imageData` is optional. Add `detectBackgroundSurfaces()` using `getComputedStyle(element).backgroundImage` URL extraction. Add `detectCanvasSurfaces()` for large canvases. Keep `detectImageSurfaces()` as the exported aggregate name so existing callers do not change.

- [ ] **Step 4: Run extension tests**

Run: `pnpm --filter @umt/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```powershell
git add apps/extension/src/content/detector/surface-detector.ts apps/extension/src/content/detector/surface-detector.test.ts
git commit -m "feat(extension): detect background and canvas manga surfaces"
```

## Task 2: Capture Image Data Fallback

**Files:**
- Modify: `apps/extension/src/content/capture/surface-capture.ts`
- Create: `apps/extension/src/content/capture/surface-capture.test.ts`

- [ ] **Step 1: Write failing capture tests**

Add tests for `createSurfaceTask()` showing image surfaces send `imageUrl`, while canvas surfaces with `imageData` send `imageData` without requiring `imageUrl`.

- [ ] **Step 2: Run capture tests to verify failure**

Run: `pnpm --filter @umt/extension test`
Expected: FAIL because `createSurfaceTask()` currently assumes `imageUrl` is always present.

- [ ] **Step 3: Implement capture fallback**

Update `createSurfaceTask()` to include `imageUrl` only when present and include `imageData` only when present. Keep target language `zh-CN` for now.

- [ ] **Step 4: Run extension tests/build/typecheck**

Run:
```powershell
pnpm --filter @umt/extension test
pnpm --filter @umt/extension typecheck
pnpm --filter @umt/extension build
```
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```powershell
git add apps/extension/src/content/capture/surface-capture.ts apps/extension/src/content/capture/surface-capture.test.ts
git commit -m "feat(extension): submit image data fallback surfaces"
```

## Task 3: Overlay Repositioning

**Files:**
- Modify: `apps/extension/src/content/overlay/overlay-renderer.ts`
- Modify: `apps/extension/src/content/overlay/overlay-renderer.test.ts`
- Modify: `apps/extension/src/content/main.ts`

- [ ] **Step 1: Write failing overlay refresh test**

Add a test that renders a result, changes the element `getBoundingClientRect()` return value, calls `refreshAll()`, and asserts the overlay left/top changed.

- [ ] **Step 2: Run overlay tests to verify failure**

Run: `pnpm --filter @umt/extension test`
Expected: FAIL because `refreshAll()` does not exist.

- [ ] **Step 3: Implement remembered render state**

Store `{ element, naturalSize, result }` by `surfaceId` inside `OverlayRenderer`. Implement `refreshAll()` to re-render every stored surface. Keep manual edits working.

- [ ] **Step 4: Wire resize/scroll refresh**

In `apps/extension/src/content/main.ts`, call `renderer.refreshAll()` on `resize` and after scroll-triggered scheduler requests so overlays stay aligned when layout shifts.

- [ ] **Step 5: Run extension tests/build/typecheck**

Run:
```powershell
pnpm --filter @umt/extension test
pnpm --filter @umt/extension typecheck
pnpm --filter @umt/extension build
```
Expected: PASS.

- [ ] **Step 6: Commit**

Run:
```powershell
git add apps/extension/src/content/overlay/overlay-renderer.ts apps/extension/src/content/overlay/overlay-renderer.test.ts apps/extension/src/content/main.ts
git commit -m "feat(extension): keep overlays aligned after layout changes"
```

## Task 4: Fixture and Loaded Extension E2E

**Files:**
- Modify: `tests/fixtures/simple-manga.html`
- Modify: `tests/fixtures/fixtures.css`
- Modify: `tests/integration/extension-loaded.spec.ts`

- [ ] **Step 1: Add background/canvas fixture content**

Add one large CSS background manga panel and one canvas-like large element to the fixture without breaking the existing image case.

- [ ] **Step 2: Add loaded-extension E2E expectation**

Assert the extension still automatically renders at least one overlay and the panel remains visible after fixture layout includes mixed surface types.

- [ ] **Step 3: Run E2E**

Run: `pnpm test:e2e`
Expected: PASS.

- [ ] **Step 4: Commit**

Run:
```powershell
git add tests/fixtures/simple-manga.html tests/fixtures/fixtures.css tests/integration/extension-loaded.spec.ts
git commit -m "test(e2e): cover mixed manga surface fixture"
```

## Task 5: Full Verification and Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run full verification**

Run:
```powershell
pnpm test
pnpm build
pnpm test:e2e
pnpm exec playwright test tests/integration/extension-loaded.spec.ts
```
Expected: all commands exit 0.

- [ ] **Step 2: Update README**

Append a Phase 5 note listing image/background/canvas detection and overlay refresh verification.

- [ ] **Step 3: Commit**

Run:
```powershell
git add README.md docs/superpowers/plans/2026-06-30-universal-manga-translator-phase5.md
git commit -m "docs: record phase 5 mixed surface verification"
```