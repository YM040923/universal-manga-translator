# Reference Fusion, OCR Robustness, and Bubble Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine the project's existing browser-first strengths with proven cache, scheduling, diagnostics, bubble-detection, and batch-UX patterns while specifically reducing speech-bubble grouping errors and OCR failures caused by font and image-scale differences.

**Architecture:** Keep the current pure-extension direct pipeline and stable image-anchored renderer. Add shared recognition-unit/evidence types, adaptive OCR capture, selective local preprocessing, bubble-aware grouping, versioned content/bubble caches, and one authoritative per-image state machine behind feature flags. Manual selection and automatic translation will share the same capture/OCR boundary, with manual selection remaining the highest-priority result source.

**Tech Stack:** TypeScript, Chrome Extension Manifest V3, Vite, Node test runner, Vitest-compatible test utilities already used by the repository, Playwright integration tests, `@umt/core`, `@umt/shared`, local generated image fixtures.

---

## Implementation boundaries

The following behavior is frozen until a regression test demonstrates a specific defect:

- image-anchored overlay positioning and scroll stability;
- domain opt-in activation;
- manual-selection priority;
- manual edit/delete persistence;
- first-page priority and single-page retranslation semantics;
- generic OCR URL/key configuration;
- pure-extension direct mode.

The reference repositories provide behavior and architecture ideas only. No GPL/LGPL source or assets will be copied.

## Files to create or modify

### New core/domain files

- Create: `packages/shared/src/recognition.ts` — shared recognition-unit, OCR evidence, bubble candidate, and version types.
- Create: `packages/core/src/recognition-planner.ts` — adaptive tile planning and coordinate transforms.
- Create: `packages/core/src/ocr-quality.ts` — suspicious-recognition scoring and rescue decisions.
- Create: `packages/core/src/ocr-preprocess.ts` — deterministic local image preprocessing interface and browser implementation boundary.
- Create: `packages/core/src/bubble-reconstruction.ts` — OCR-line grouping into conservative bubble candidates.
- Create: `packages/core/src/result-matching.ts` — bubble-level fuzzy matching and manual-override reconciliation.
- Create: `packages/core/src/pipeline-stage.ts` — stage event and stage timing types.

### Existing core files

- Modify: `packages/core/src/pipeline.ts` — accept recognition units, preserve evidence, and expose stage callbacks without changing the existing provider interfaces abruptly.
- Modify: `packages/core/src/generic-ocr.ts` — retain provider-independent parsing while returning parse evidence and normalized boxes where possible.
- Modify: `packages/core/src/index.ts` — export the new stable interfaces.
- Modify: `packages/core/src/*.test.ts` — add deterministic tests for all new pure functions.

### Extension capture/scheduling files

- Modify: `apps/extension/src/content/capture/surface-capture.ts` — route automatic and manual capture through common recognition-unit construction.
- Modify: `apps/extension/src/content/capture/screenshot-crop.ts` — preserve exact natural-image coordinate mapping and record device-pixel metadata.
- Create: `apps/extension/src/content/capture/recognition-capture.ts` — create normalized full-surface and crop recognition inputs.
- Modify: `apps/extension/src/content/client/direct-client.ts` — pass pipeline versions, stage callbacks, and cache context.
- Modify: `apps/extension/src/content/main.ts` — remain orchestration-only; remove duplicated automatic/manual capture decisions as each new boundary becomes available.
- Modify: `apps/extension/src/content/queue/translation-queue.ts` — support authoritative stage transitions, cancellation tokens, and batch completion.
- Modify: `apps/extension/src/content/scheduler/auto-scheduler.ts` — preserve first-page priority and add incremental page-batch scheduling.
- Modify: `apps/extension/src/content/scheduler/viewport-scheduler.ts` — use viewport proximity only for later-page prefetch, never to override first-page priority.

### Extension cache and rendering files

- Create: `apps/extension/src/content/cache/content-fingerprint-cache.ts` — exact image-content and OCR-observation cache.
- Create: `apps/extension/src/content/cache/bubble-result-cache.ts` — bubble-level fuzzy result and override lookup.
- Modify: `apps/extension/src/content/cache/chapter-result-cache.ts` — version cache keys and reject permanent empty/failed entries.
- Modify: `apps/extension/src/content/cache/direct-ocr-cache.ts` — migrate to the new OCR-observation key format.
- Modify: `apps/extension/src/content/cache/manual-overrides.ts` — persist edit and deletion tombstone versions.
- Modify: `apps/extension/src/content/cache/manual-selection-cache.ts` — preserve manual-selection priority during migration.
- Modify: `apps/extension/src/content/overlay/overlay-geometry.ts` — consume bubble candidates conservatively.
- Modify: `apps/extension/src/content/overlay/overlay-renderer.ts` — keep stable DOM nodes and render immutable layout snapshots.
- Create: `apps/extension/src/content/overlay/layout-snapshot.ts` — immutable render model used to prevent flashing and repeated refits.

### Extension state and UI files

- Modify: `apps/extension/src/content/surface/surface-state.ts` — add capture/planning/OCR-rescue/bubble-detection stages.
- Create: `apps/extension/src/content/state/surface-state-store.ts` — authoritative state store for content controls.
- Modify: `apps/extension/src/content/progress/chapter-progress.ts` — render state-store snapshots without recomputing approximate status.
- Modify: `apps/extension/src/content/panel/floating-panel.ts` — show stage and retry state without reintroducing the removed label.
- Modify: `apps/extension/src/popup/main.ts` — finish current operation feedback and consume real queue/API status.
- Modify: `apps/extension/src/popup/main.test.ts` — cover busy, success, error, cancellation, and stale-page states.
- Modify: `apps/extension/src/popup/styles.ts` — preserve compact layout and accessible action feedback.

### Tests and fixtures

- Create: `packages/core/src/fixtures/generated-bubbles.ts` — deterministic generated fixture metadata, not copyrighted manga assets.
- Create: `packages/core/src/recognition-planner.test.ts`.
- Create: `packages/core/src/ocr-quality.test.ts`.
- Create: `packages/core/src/bubble-reconstruction.test.ts`.
- Create: `packages/core/src/result-matching.test.ts`.
- Create: `apps/extension/src/content/capture/recognition-capture.test.ts`.
- Create: `apps/extension/src/content/cache/content-fingerprint-cache.test.ts`.
- Create: `apps/extension/src/content/cache/bubble-result-cache.test.ts`.
- Create: `apps/extension/src/content/overlay/layout-snapshot.test.ts`.
- Modify: `tests/integration/*.spec.ts` — add activation, first-page ordering, manual-selection priority, and retry coverage.
- Create: `tests/fixtures/font-compatibility/README.md` — explain generated/permissively licensed fixture requirements.

---

## Task 1: Preserve and verify the current Popup feedback slice

**Files:**
- Modify: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/src/popup/main.test.ts`
- Modify: `apps/extension/src/popup/styles.ts`

- [ ] **Step 1: Review the existing busy-state semantics.**

Confirm that ordinary page actions are mutually exclusive while `取消队列` remains available as the only interrupt action. Do not disable cancellation when another page action is sending.

- [ ] **Step 2: Add the failing cancellation test.**

```ts
test("cancel remains available while another page action is busy", async () => {
  // Arrange the popup harness with a pending page command.
  // Assert the translate/retranslate/selection actions are disabled.
  // Assert the cancel action remains enabled and sends exactly one cancel command.
});
```

- [ ] **Step 3: Implement the narrow busy-state exception.**

Keep `pageActionBusy` for competing actions, but render cancellation independently:

```ts
const competingPageActionDisabled = pageActionBusy;
const cancelDisabled = cancelBusy;
```

- [ ] **Step 4: Run the focused Popup tests.**

Run:

```powershell
pnpm --filter @umt/extension build:test
node --test apps/extension/dist-test/popup/main.test.js
```

Expected: all Popup tests pass, including the cancellation test.

- [ ] **Step 5: Commit the Popup slice without staging unrelated files.**

```powershell
git add apps/extension/src/popup/main.ts apps/extension/src/popup/main.test.ts apps/extension/src/popup/styles.ts
git commit -m "feat: complete popup action feedback loop"
```

---

## Task 2: Add shared recognition-unit and stage contracts

**Files:**
- Create: `packages/shared/src/recognition.ts`
- Create: `packages/core/src/pipeline-stage.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write type-level and serialization tests.**

The tests must verify that a recognition unit preserves natural-image coordinates, scale, parent surface, priority, and preprocessing version.

- [ ] **Step 2: Add the stable contracts.**

```ts
export type RecognitionReason = "automatic" | "manual-selection" | "ocr-rescue";

export interface RecognitionUnit {
  id: string;
  parentSurfaceId: string;
  imageHash?: string;
  crop: Rect;
  naturalSize: Size;
  pixelSize: Size;
  scaleX: number;
  scaleY: number;
  priority: "p0" | "p1" | "p2";
  reason: RecognitionReason;
  preprocessingVersion: string;
}

export interface OcrObservation {
  id: string;
  unitId: string;
  box: Rect;
  sourceText: string;
  confidence: number;
  orientation: "horizontal" | "vertical";
  kind: "dialogue" | "narration" | "sfx";
  variant: string;
  suspicious: boolean;
}

export type PipelineStage =
  | "idle" | "queued" | "capturing" | "planning" | "ocr"
  | "ocr-rescue" | "bubble-detection" | "translating"
  | "layout" | "rendering" | "completed" | "cached"
  | "empty" | "failed" | "cancelled";
```

- [ ] **Step 3: Build shared and core packages.**

Run:

```powershell
pnpm --filter @umt/shared build
pnpm --filter @umt/core build
```

Expected: both packages compile with the new exports.

- [ ] **Step 4: Commit the contracts.**

```powershell
git add packages/shared/src packages/core/src/index.ts packages/core/src/pipeline-stage.ts
git commit -m "feat: add shared recognition and pipeline stage contracts"
```

---

## Task 3: Unify automatic and manual capture

**Files:**
- Create: `apps/extension/src/content/capture/recognition-capture.ts`
- Modify: `apps/extension/src/content/capture/surface-capture.ts`
- Modify: `apps/extension/src/content/capture/screenshot-crop.ts`
- Modify: `apps/extension/src/content/main.ts`
- Test: `apps/extension/src/content/capture/recognition-capture.test.ts`

- [ ] **Step 1: Add tests proving equivalent crops produce equivalent metadata.**

The test must use a fixed screenshot size and viewport rectangle and assert that manual and automatic crop construction produce the same natural coordinate transform.

- [ ] **Step 2: Implement common capture construction.**

Create a single function:

```ts
export interface RecognitionCapture {
  unit: RecognitionUnit;
  imageData: string;
  mimeType: string;
}

export async function captureRecognitionUnit(
  input: CaptureRecognitionUnitInput,
): Promise<RecognitionCapture>;
```

Both normal image capture and manual selection must call it. Manual selection remains `priority: "p0"` and `reason: "manual-selection"`.

- [ ] **Step 3: Record capture evidence.**

Log dimensions, MIME type, device-pixel ratio, crop rectangle, and byte length. Never log image data or API credentials.

- [ ] **Step 4: Run capture tests.**

```powershell
pnpm --filter @umt/extension build:test
node --test apps/extension/dist-test/content/capture/recognition-capture.test.js
```

- [ ] **Step 5: Commit the shared capture boundary.**

```powershell
git add apps/extension/src/content/capture apps/extension/src/content/main.ts
git commit -m "refactor: unify automatic and manual recognition capture"
```

---

## Task 4: Add adaptive page tiling

**Files:**
- Create: `packages/core/src/recognition-planner.ts`
- Create: `packages/core/src/recognition-planner.test.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `apps/extension/src/content/client/direct-client.ts`

- [ ] **Step 1: Write planner tests.**

Cover:

- short images produce one unit;
- tall images produce overlapping units;
- tile coordinates map back to original image coordinates;
- the first tile is first in priority order;
- no tile has a zero or negative crop;
- overlap deduplication metadata is retained.

- [ ] **Step 2: Implement deterministic planning.**

```ts
export interface RecognitionPlan {
  units: RecognitionUnit[];
  overlapPx: number;
}

export function planRecognitionUnits(input: {
  surfaceId: string;
  naturalSize: Size;
  maxTileHeight: number;
  overlapRatio: number;
  reason: RecognitionReason;
}): RecognitionPlan;
```

Keep initial defaults conservative and configurable through internal constants. Do not change user-facing settings in this task.

- [ ] **Step 3: Add coordinate remapping and overlap dedupe.**

Map tile-local OCR boxes to parent-image coordinates before grouping. Deduplicate only when normalized text and IoU both indicate the same observation.

- [ ] **Step 4: Run core tests.**

```powershell
pnpm --filter @umt/core test
```

- [ ] **Step 5: Commit tiling.**

```powershell
git add packages/core/src/recognition-planner.ts packages/core/src/recognition-planner.test.ts packages/core/src/pipeline.ts apps/extension/src/content/client/direct-client.ts
git commit -m "feat: add adaptive recognition tiling"
```

---

## Task 5: Add OCR evidence and selective font rescue

**Files:**
- Create: `packages/core/src/ocr-quality.ts`
- Create: `packages/core/src/ocr-quality.test.ts`
- Create: `packages/core/src/ocr-preprocess.ts`
- Modify: `packages/core/src/generic-ocr.ts`
- Modify: `packages/core/src/pipeline.ts`

- [ ] **Step 1: Write failing quality-classification tests.**

Cover:

- high-confidence normal text is not rescued;
- empty response with bubble-like candidate is rescued;
- fragmented all-caps output is suspicious;
- provider quota/auth failures are not retried as image variants;
- network errors use provider retry, not OCR preprocessing rescue.

- [ ] **Step 2: Implement pure quality assessment.**

```ts
export interface OcrQualityAssessment {
  suspicious: boolean;
  reasons: string[];
  rescue: "none" | "upscale" | "contrast" | "threshold" | "expanded-crop";
}

export function assessOcrQuality(
  observations: OcrObservation[],
  unit: RecognitionUnit,
): OcrQualityAssessment;
```

- [ ] **Step 3: Add deterministic preprocessing descriptors.**

The core package must describe variants without requiring DOM APIs:

```ts
export type OcrPreprocessVariant =
  | "original"
  | "lossless-normalized"
  | "upscale-2x"
  | "grayscale-contrast"
  | "adaptive-threshold"
  | "expanded-crop";
```

The extension capture layer will later implement the actual Canvas transformations.

- [ ] **Step 4: Integrate a bounded rescue loop.**

Rules:

- never retry quota, auth, or permission errors with another image;
- rescue only suspicious recognition units;
- cap rescue attempts per unit and per image;
- retain the best observation set by quality score;
- mark rescued results in diagnostics and cache keys.

- [ ] **Step 5: Run core tests and commit.**

```powershell
pnpm --filter @umt/core test
git add packages/core/src/generic-ocr.ts packages/core/src/pipeline.ts packages/core/src/ocr-quality.ts packages/core/src/ocr-quality.test.ts packages/core/src/ocr-preprocess.ts
git commit -m "feat: add bounded OCR quality rescue"
```

---

## Task 6: Implement bubble-aware reconstruction

**Files:**
- Create: `packages/core/src/bubble-reconstruction.ts`
- Create: `packages/core/src/bubble-reconstruction.test.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `apps/extension/src/content/overlay/overlay-geometry.ts`

- [ ] **Step 1: Create generated bubble fixtures.**

Use generated geometry and text observations for:

- one bubble with two lines;
- two adjacent bubbles;
- overlapping bubbles;
- one narration box;
- SFX beside dialogue;
- vertical dialogue;
- borderless text.

- [ ] **Step 2: Write grouping tests before implementation.**

Assert that one visual bubble produces one block and adjacent bubbles remain separate even when their text boxes are close.

- [ ] **Step 3: Implement conservative candidate construction.**

```ts
export interface BubbleCandidate {
  id: string;
  box: Rect;
  shape: "ellipse" | "rounded-rect" | "rect" | "free-text";
  observationIds: string[];
  confidence: number;
  evidence: string[];
}

export function reconstructBubbles(
  observations: OcrObservation[],
  image: BubbleEvidenceImage | undefined,
): BubbleCandidate[];
```

Start with geometry plus optional image evidence. If image evidence is unavailable or ambiguous, use conservative text-block fallback rather than a broad merge.

- [ ] **Step 4: Make pipeline translation operate on logical bubbles.**

Preserve original observation IDs inside each bubble so diagnostics and future manual split operations remain possible.

- [ ] **Step 5: Run tests and commit.**

```powershell
pnpm --filter @umt/core test
git add packages/core/src/bubble-reconstruction.ts packages/core/src/bubble-reconstruction.test.ts packages/core/src/pipeline.ts apps/extension/src/content/overlay/overlay-geometry.ts packages/core/src/fixtures/generated-bubbles.ts
git commit -m "feat: reconstruct conservative manga bubbles"
```

---

## Task 7: Add content and bubble-level cache v2

**Files:**
- Create: `apps/extension/src/content/cache/content-fingerprint-cache.ts`
- Create: `apps/extension/src/content/cache/content-fingerprint-cache.test.ts`
- Create: `apps/extension/src/content/cache/bubble-result-cache.ts`
- Create: `apps/extension/src/content/cache/bubble-result-cache.test.ts`
- Modify: `apps/extension/src/content/cache/chapter-result-cache.ts`
- Modify: `apps/extension/src/content/cache/direct-ocr-cache.ts`
- Modify: `apps/extension/src/content/cache/manual-overrides.ts`
- Modify: `apps/extension/src/content/cache/manual-selection-cache.ts`

- [ ] **Step 1: Write cache-key and status tests.**

Verify configuration-version separation and that `failed`/permanent `empty` results cannot be returned as successful results.

- [ ] **Step 2: Implement versioned exact image cache.**

Cache keys must include:

```ts
imageHash
naturalWidth
naturalHeight
ocrProfile
preprocessingVersion
targetLanguage
translationProfile
promptVersion
layoutVersion
```

- [ ] **Step 3: Implement bubble fuzzy matching.**

Match by normalized source text, IoU, center distance, and reading-order neighborhood. Manual edits and deletion tombstones must win over automatic results.

- [ ] **Step 4: Add dual-write migration.**

Continue reading v1 while writing v2. Do not delete v1 until a later release after v2 has been verified.

- [ ] **Step 5: Run tests and commit.**

```powershell
pnpm --filter @umt/extension build:test
node --test apps/extension/dist-test/content/cache/content-fingerprint-cache.test.js apps/extension/dist-test/content/cache/bubble-result-cache.test.js
git add apps/extension/src/content/cache
git commit -m "feat: add versioned content and bubble caches"
```

---

## Task 8: Unify authoritative state, cancellation, and incremental scheduling

**Files:**
- Create: `apps/extension/src/content/state/surface-state-store.ts`
- Modify: `apps/extension/src/content/surface/surface-state.ts`
- Modify: `apps/extension/src/content/queue/translation-queue.ts`
- Modify: `apps/extension/src/content/scheduler/auto-scheduler.ts`
- Modify: `apps/extension/src/content/scheduler/viewport-scheduler.ts`
- Modify: `apps/extension/src/content/main.ts`
- Modify: `apps/extension/src/content/progress/chapter-progress.ts`

- [ ] **Step 1: Add state transition tests.**

Cover legal transitions, terminal-state protection, first-page ordering, cancellation, and retry.

- [ ] **Step 2: Implement the state store.**

The store is the only writer of per-image stage state. UI components subscribe to snapshots.

- [ ] **Step 3: Implement true cancellation.**

Pass an `AbortSignal` from the queue into image fetch, OCR, translation, and rescue operations. Mark a task `cancelled` only after the request has actually stopped or the provider has returned.

- [ ] **Step 4: Preserve first-page priority.**

Schedule:

```text
page 1 / image 1: exclusive priority
page 1 / remaining images: bounded concurrency
later pages: viewport-aware prefetch
```

- [ ] **Step 5: Add incremental batch completion.**

Render the first completed valid bubble batch immediately. Never rewrite completed bubbles merely because a later batch arrived.

- [ ] **Step 6: Run extension tests and commit.**

```powershell
pnpm --filter @umt/extension test
git add apps/extension/src/content/state apps/extension/src/content/surface apps/extension/src/content/queue apps/extension/src/content/scheduler apps/extension/src/content/main.ts apps/extension/src/content/progress
git commit -m "feat: unify surface state and incremental scheduling"
```

---

## Task 9: Stabilize immutable overlay layout

**Files:**
- Create: `apps/extension/src/content/overlay/layout-snapshot.ts`
- Create: `apps/extension/src/content/overlay/layout-snapshot.test.ts`
- Modify: `apps/extension/src/content/overlay/overlay-renderer.ts`
- Modify: `apps/extension/src/content/overlay/overlay-geometry.ts`

- [ ] **Step 1: Write layout snapshot tests.**

Verify that unchanged results produce the same snapshot, scrolling does not change natural coordinates, and text is not re-fit unless text or settings changed.

- [ ] **Step 2: Implement immutable layout snapshots.**

```ts
export interface LayoutSnapshot {
  resultVersion: string;
  settingsVersion: string;
  regions: readonly RenderedLayoutRegion[];
}
```

- [ ] **Step 3: Commit DOM updates atomically.**

Build a complete off-DOM layout and replace only the affected bubble node. Do not clear and recreate the whole image overlay on every update.

- [ ] **Step 4: Add scroll-stability assertions.**

Use existing overlay renderer tests and a jsdom scroll simulation to verify that `top/left` are relative to the image anchor, not the viewport.

- [ ] **Step 5: Run tests and commit.**

```powershell
pnpm --filter @umt/extension test
git add apps/extension/src/content/overlay
git commit -m "fix: stabilize immutable overlay layout"
```

---

## Task 10: Improve Popup, floating controls, and progress truthfulness

**Files:**
- Modify: `apps/extension/src/popup/main.ts`
- Modify: `apps/extension/src/popup/main.test.ts`
- Modify: `apps/extension/src/popup/styles.ts`
- Modify: `apps/extension/src/content/panel/floating-panel.ts`
- Modify: `apps/extension/src/content/progress/chapter-progress.ts`

- [ ] **Step 1: Add tests for every real command.**

Each visible button must have a test that verifies its message, busy state, success feedback, error feedback, and stale-page handling.

- [ ] **Step 2: Bind UI to the authoritative state snapshot.**

Remove approximate local counters where a queue/state snapshot is available.

- [ ] **Step 3: Keep the floating button compact and functional.**

Use one primary left-click action for show/hide. Keep retry current image and selection actions in the context menu. Do not add a persistent label or decorative arc.

- [ ] **Step 4: Run focused UI tests.**

```powershell
pnpm --filter @umt/extension build:test
node --test apps/extension/dist-test/popup/main.test.js
```

- [ ] **Step 5: Commit UI truthfulness changes.**

```powershell
git add apps/extension/src/popup apps/extension/src/content/panel/floating-panel.ts apps/extension/src/content/progress/chapter-progress.ts
git commit -m "fix: synchronize translation controls with real state"
```

---

## Task 11: Add font and bubble visual regression fixtures

**Files:**
- Create: `tests/fixtures/font-compatibility/README.md`
- Create: `packages/core/src/fixtures/generated-bubbles.ts`
- Modify: `apps/extension/src/content/overlay/overlay-renderer.test.ts`
- Modify: `tests/integration/*.spec.ts`

- [ ] **Step 1: Generate deterministic test images.**

Generate fixtures locally with known text, fonts, bubble shapes, and background noise. Do not add copyrighted manga images to the repository.

- [ ] **Step 2: Add OCR fixture metadata.**

Store expected boxes, orientation, source text, and bubble ownership in JSON adjacent to each generated fixture.

- [ ] **Step 3: Add screenshots for stable layout.**

Compare:

- first render;
- after scroll;
- after edit;
- after deletion;
- after retry;
- after settings change and single-page retranslation.

- [ ] **Step 4: Add a difficult-font quality report.**

Report OCR recall, region precision, bubble merge/split errors, rescue count, and elapsed time for each fixture.

- [ ] **Step 5: Run integration tests and commit.**

```powershell
pnpm test:e2e
git add tests/fixtures packages/core/src/fixtures apps/extension/src/content/overlay/overlay-renderer.test.ts tests/integration
git commit -m "test: add font and bubble quality fixtures"
```

---

## Task 12: Live-site acceptance and release gate

**Files:**
- Modify: `tests/integration/*.spec.ts`
- Modify: `docs/quickstart.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/release-checklist.md`

- [ ] **Step 1: Add live-site workflow coverage.**

Validate on at least:

- `asurascans.com`;
- `comix.to`;
- one additional reader with lazy-loaded images.

The test must activate a domain explicitly before content code is expected to run.

- [ ] **Step 2: Validate the required user flows.**

1. Enable a site from Popup.
2. Translate only the current image.
3. Start automatic translation and verify page-one-first ordering.
4. Retry one image only.
5. Edit and delete a bubble.
6. Refresh and verify persistence.
7. Use manual selection and verify it is not overwritten.
8. Scroll repeatedly and verify overlay stability.
9. Clear cache and verify old empty/failed results are not reused.

- [ ] **Step 3: Run the full release gate.**

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm package:extension
pnpm verify:release
git diff --check
```

Expected: all commands exit successfully, the extension package is produced, and no API key or local endpoint appears in the package or diagnostic logs.

- [ ] **Step 4: Run the extension-load QA script.**

```powershell
pnpm qa:extension
```

Expected: the unpacked extension loads, the popup opens, and the content script does not run on a non-enabled domain.

- [ ] **Step 5: Commit release documentation only after behavior is verified.**

```powershell
git add docs/quickstart.md docs/troubleshooting.md docs/release-checklist.md tests/integration
git commit -m "docs: document reference-fusion release behavior"
```

---

## Plan self-review

### Spec coverage

- Existing product strengths are protected in the implementation boundaries and Task 1/3/8/9/10.
- Bubble recognition is covered by Tasks 4, 5, 6, and 11.
- Font compatibility is covered by Tasks 3, 5, and 11.
- Cache and manual edit priority are covered by Task 7.
- Incremental translation and first-page ordering are covered by Task 8.
- Stage diagnostics and truthful UI are covered by Tasks 2, 8, and 10.
- Scroll stability is protected by Task 9 and Task 12.
- Packaging and release checks are covered by Task 12.

### Placeholder scan

No placeholder markers or unspecified implementation steps are present in this plan.

### Type consistency

- `RecognitionUnit`, `OcrObservation`, `BubbleCandidate`, and `PipelineStage` are introduced before their consumers.
- The queue and UI consume `PipelineStage` through the state store.
- Bubble matching consumes `BubbleCandidate` and manual override records after both are defined.
- Manual selection remains a `RecognitionReason` and retains p0 priority.
