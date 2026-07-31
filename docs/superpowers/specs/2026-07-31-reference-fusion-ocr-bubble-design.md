# Reference Fusion, Bubble Detection, and OCR Robustness Design

**Date:** 2026-07-31

**Status:** User-approved product direction; implementation not started

**Primary product:** Pure Chrome extension

## 1. Product decision

Universal Manga Translator remains the product foundation. StarFlow, ShinobuTranslator, and MangaNano are design references, not replacement architectures.

The project will preserve its existing strengths:

- opt-in activation by manga-site domain;
- support for arbitrary manga sites rather than hard-coded site adapters;
- pure-extension direct mode with configurable OCR and translation APIs;
- automatic translation with first-page priority and later-page concurrency;
- per-image translation and retranslation;
- persistent chapter cache;
- editable and removable translated bubbles;
- manual-selection translation with the highest result priority;
- configurable mask shape, size, aspect ratio, opacity, and typography;
- image-anchored overlays that remain stable while scrolling.

Reference-project capabilities will be added behind stable interfaces and regression tests. Existing working behavior will not be replaced wholesale.

## 2. Reference capability mapping

| Reference | Capability to learn | Independent adaptation |
| --- | --- | --- |
| ShinobuTranslator | Browser-owned pipeline, bubble-aware layout, stage diagnostics, worker isolation, viewport scheduling | Strengthen the extension pipeline and layout engine without replacing the existing site activation or overlay anchoring model |
| StarFlow | Content fingerprints, fuzzy cache matching, incremental translation, translation history, stable page state | Add layered image and bubble caches, incremental page processing, and more reliable recovery |
| MangaNano | Per-image task state, retry UX, batch progress, explicit API errors, advanced export flow | Unify popup, progress widget, and image-button feedback; reserve export/inpaint for an optional future mode |

GPL/LGPL source code will not be copied into this project. Architecture and behavior will be independently implemented.

## 3. Current problem focus

### 3.1 Speech-bubble recognition

The current pipeline primarily groups OCR boxes using geometry. Nearby lines may be merged even when they belong to separate bubbles, while lines inside one unusually shaped bubble may remain split. A text bounding box is not the same thing as a speech-bubble boundary.

The new pipeline must distinguish:

- OCR text lines;
- logical dialogue blocks;
- visual speech-bubble or narration-box boundaries;
- sound effects and free-floating lettering;
- manually selected regions.

One physical dialogue bubble should normally produce one translated overlay. Separate physical bubbles must not be merged merely because their text boxes are close.

### 3.2 OCR robustness across fonts

Stylized, outlined, compressed, curved, low-contrast, handwritten, all-caps, and unusually spaced fonts currently produce more recognition errors.

Manual-selection translation often succeeds where automatic page translation fails. The current code paths explain a likely cause:

- normal translation sends the original full image, which may be extremely tall or contain large amounts of unrelated artwork;
- manual selection sends a small lossless PNG crop of the visible screenshot;
- the selected crop gives OCR a larger effective text scale, less background noise, and a much smaller search area.

This is a working hypothesis, not a final diagnosis. The implementation must record comparable automatic and manual capture evidence before deciding which factor is responsible.

## 4. Architecture

The pipeline will be divided into explicit stages:

```text
surface discovery
  -> capture normalization
  -> adaptive recognition-unit planning
  -> OCR pass
  -> low-confidence rescue
  -> bubble reconstruction
  -> logical text grouping
  -> contextual translation
  -> bubble-level result reconciliation
  -> stable layout
  -> image-anchored rendering
```

### 4.1 Shared recognition units

Automatic translation and manual-selection translation will use the same `RecognitionUnit` abstraction.

A recognition unit contains:

- source image fingerprint;
- parent surface identifier;
- crop rectangle in natural-image coordinates;
- pixel dimensions and scale;
- preprocessing variant;
- priority and reason;
- mapping back to the original image.

Manual selection becomes a high-priority recognition unit rather than a separate OCR implementation. This makes automatic and manual OCR directly comparable and prevents their behavior from drifting.

### 4.2 Capture normalization

Before OCR, image input will be normalized:

- decode to a known orientation;
- preserve natural-image coordinates;
- convert lossy or browser-specific formats to a deterministic lossless working image when required;
- avoid needless downscaling;
- record source dimensions, rendered dimensions, device-pixel ratio, MIME type, and byte size;
- reject empty or truncated image buffers before entering the OCR queue.

Normalization must not alter the coordinates used by the stable overlay anchoring layer.

### 4.3 Adaptive page tiling

Very tall webtoon pages will be divided into overlapping recognition units before OCR.

The tile planner will:

- keep enough source pixels for small lettering;
- use overlap so text crossing a tile edge is not lost;
- avoid splitting through likely dense text zones when inexpensive image evidence is available;
- preserve exact tile-to-page coordinate transforms;
- deduplicate overlapping OCR observations after mapping them back;
- prioritize the first page and the earliest page region;
- emit early batches without waiting for the entire page.

Tiling is an OCR input strategy only. The website DOM and rendered manga image remain unchanged.

### 4.4 OCR quality assessment

Each OCR observation will retain evidence instead of immediately becoming a final region:

- source text;
- confidence when supplied by the provider;
- box or polygon;
- orientation;
- recognition-unit identifier;
- preprocessing variant;
- duplicate relationships;
- suspicious-text indicators.

Suspicious-text indicators include:

- low provider confidence;
- excessive symbols or broken single characters;
- improbable character sequences;
- many tiny fragmented boxes in one likely bubble;
- bubble-like image evidence with no recognized text;
- major disagreement between overlapping recognition units.

### 4.5 Low-confidence rescue

The default path still performs one OCR call per required recognition unit. Extra calls are selective.

Only failed or suspicious local areas may be retried using variants such as:

- higher-resolution crop;
- grayscale contrast normalization;
- local contrast enhancement;
- mild sharpening;
- light-background or dark-background threshold variants;
- expanded crop padding.

The rescue path must operate on a small crop, not resend the entire page. It must have configurable per-image and per-chapter call budgets so OCR quality improvements do not silently multiply cost.

### 4.6 Bubble reconstruction

Bubble detection will combine OCR geometry with local image evidence.

For each cluster of nearby OCR lines:

1. inspect a padded local crop;
2. estimate whether line centers belong to the same enclosed light/dark component;
3. examine contour closure, border continuity, whitespace, and component connectivity;
4. derive a bubble candidate polygon, ellipse, rounded rectangle, or free-text region;
5. assign OCR lines to bubble candidates;
6. merge lines only when they share sufficient bubble evidence;
7. split geometrically close lines when image evidence indicates separate bubbles.

The system must support:

- white speech bubbles;
- dark speech bubbles;
- rectangular narration boxes;
- borderless text;
- overlapping balloons;
- tails extending outside the main bubble body;
- vertical and horizontal text;
- sound effects that should not be treated as dialogue bubbles.

Bubble detection confidence will be retained. Low-confidence candidates fall back to conservative text-box rendering rather than aggressive merging.

### 4.7 Logical text grouping

The current geometry grouping heuristics will become one signal instead of the final authority.

Grouping order:

1. explicit manual-selection ownership;
2. shared visual bubble identifier;
3. compatible orientation and text kind;
4. reading order and geometric distance;
5. conservative fallback.

Every resulting logical block retains the original OCR line observations so incorrect merges can be diagnosed and, later, manually split.

### 4.8 Translation context

Translation receives logical bubbles in reading order, with:

- neighboring bubble text;
- chapter context;
- stable names and glossary entries;
- speaker or bubble-type hints when available;
- prior user corrections;
- OCR uncertainty markers.

The translator must not silently invent text to repair uncertain OCR. Low-confidence source text is translated conservatively and marked in diagnostics for optional re-OCR.

### 4.9 Result priority and reconciliation

Result priority is fixed:

```text
manual selection
  > user edit
  > user deletion tombstone
  > explicit single-image retranslation
  > normal automatic translation
  > cached automatic result
```

Bubble-level matching will use:

- image content fingerprint;
- intersection-over-union;
- center distance;
- normalized OCR-text similarity;
- reading-order neighborhood;
- bubble-shape evidence.

This allows user edits and deletions to survive small OCR-coordinate changes.

### 4.10 Stable rendering boundary

The existing image-anchored positioning principle is preserved.

OCR and bubble improvements may change natural-image regions, but they must not:

- anchor overlays to the viewport;
- recreate completed overlays during ordinary scrolling;
- repeatedly refit unchanged text;
- mutate site image URLs or dimensions;
- introduce site-specific polling patches as the default solution.

Rendering receives immutable layout input. A completed bubble is replaced only when its result version or user settings actually change.

## 5. State and diagnostics

Each image uses one authoritative state:

```text
idle
queued
capturing
planning
ocr
ocr-rescue
bubble-detection
translating
layout
rendering
completed
empty
failed
cancelled
```

The popup, progress widget, floating controls, and image buttons read this state rather than calculating their own approximations.

Diagnostics will record:

- capture source and dimensions;
- tile count and coordinate transforms;
- OCR call count and key index without exposing the key;
- OCR response count and parse count;
- suspicious and rescued region counts;
- bubble candidates, merges, and splits;
- translation and layout timing;
- final rendered-region count;
- exact failure stage.

Debug exports must redact API keys, authorization headers, personal endpoints when requested, and image contents by default.

## 6. Cache design

The cache will have four levels:

1. URL/page lookup;
2. exact image-content hash;
3. OCR observation cache by image/crop/configuration fingerprint;
4. bubble-level fuzzy result and manual-override cache.

Cache versions include:

- OCR adapter and field-mapping fingerprint;
- preprocessing version;
- bubble-detection version;
- translation model and prompt version;
- target language;
- layout version where relevant.

Permanent cache rules:

- failed results are never cached as success;
- empty OCR is not permanently cached;
- low-confidence rescue failures expire quickly;
- user edits and deletion tombstones persist independently of automatic-cache eviction.

## 7. Delivery strategy

### Phase 0: Preserve current work

- finish and verify the current popup action-feedback changes;
- commit them separately;
- capture a clean full-project test baseline.

### Phase 1: Recognition evidence and shared units

- add `RecognitionUnit` and OCR evidence models;
- route automatic and manual selection through the same normalization boundary;
- add diagnostics comparing both paths;
- do not change final rendering behavior.

### Phase 2: Adaptive tiling and OCR rescue

- introduce tiled automatic OCR behind a feature flag;
- add local preprocessing;
- enforce call budgets;
- shadow-compare with the existing full-image path;
- enable only after fixture and live-site gates pass.

### Phase 3: Bubble reconstruction

- add bubble candidates and visual grouping;
- retain the old grouping result for comparison;
- switch only high-confidence cases first;
- preserve conservative fallback for uncertain regions.

### Phase 4: Cache v2 and fuzzy reconciliation

- dual-write old and new caches;
- shadow-read and compare;
- migrate manual overrides without deleting old data;
- enable content-hash and bubble-level matching.

### Phase 5: Incremental translation and unified state

- render the first validated bubble batch early;
- continue later batches concurrently;
- expose authoritative stage state to all controls;
- implement real request cancellation.

### Phase 6: Layout strengthening

- build bubble-aware layout fixtures and benchmarks;
- improve layout only behind screenshot and scroll-stability regression gates;
- retain existing stable positioning code unless a measured defect requires a narrowly scoped change.

## 8. Test strategy

### 8.1 Deterministic fixtures

Create permissively licensed or generated fixtures covering:

- standard comic fonts;
- outlined and shadowed fonts;
- condensed and expanded fonts;
- handwritten and irregular fonts;
- all-caps names;
- very small lettering;
- rotated and curved text;
- white, dark, elliptical, rectangular, borderless, and overlapping bubbles;
- horizontal and vertical layouts;
- long webtoon pages and tile-edge text.

### 8.2 Required comparisons

- automatic crop versus equivalent manual-selection crop;
- original image versus normalized PNG;
- full-page OCR versus tiled OCR;
- default OCR versus selective rescue;
- old geometry grouping versus bubble-aware grouping;
- old cache versus cache v2;
- unchanged overlay before and after scrolling.

### 8.3 Acceptance gates

- automatic and manual selection produce equivalent OCR text when given the same pixel crop;
- difficult-font empty/error rate is reduced by at least 50% on the agreed fixture set;
- at least 95% of validated dialogue bubbles produce one logical translated bubble;
- separate validated bubbles are not incorrectly merged in at least 98% of fixtures;
- average OCR call count increases by no more than 20% under the default rescue budget;
- long-page first-result latency improves by at least 30% without increasing final error rate;
- scrolling produces no observable overlay movement for unchanged images;
- manual edits, manual selections, and deletion tombstones survive refresh, retry, and OCR-coordinate drift;
- all existing extension, E2E, packaging, and release checks pass.

Targets will be measured against a recorded baseline. A phase cannot replace the existing implementation if it fails any relevant gate.

## 9. Non-goals

The initial implementation will not:

- copy GPL/LGPL implementation code;
- replace the pure-extension product with a required backend;
- bundle a large local OCR model by default;
- introduce full-page generative inpainting into normal reading mode;
- rewrite stable overlay anchoring without reproducible evidence;
- add per-site fixes as the primary compatibility strategy.

## 10. Rollback and migration

Every major capability is introduced behind an internal version or feature flag:

- recognition pipeline v2;
- adaptive OCR rescue;
- bubble geometry v2;
- cache v2;
- incremental rendering.

Old cache data remains readable during migration. New caches use new namespaces. A failed rollout can disable the new stage without deleting user edits or requiring users to reinstall the extension.
