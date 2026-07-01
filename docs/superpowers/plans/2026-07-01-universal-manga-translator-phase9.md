# Universal Manga Translator Phase 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve universal manga-site compatibility by automatically responding to lazy-loaded images, dynamically appended reader pages, and layout/size changes.

**Architecture:** Add a small content-side observer module that wraps `MutationObserver`, capture-phase image `load` events, and `ResizeObserver` when available. The observer does not do translation work itself; it only asks the existing `AutoScheduler` to rescan/translate and asks the overlay renderer to refresh positions.

**Tech Stack:** TypeScript, Chrome content script APIs, jsdom tests, Playwright E2E fixtures.

---

## Task 1: Page Change Observer

- [ ] Write failing unit tests for mutation-triggered scheduling and image-load-triggered scheduling.
- [ ] Implement `apps/extension/src/content/scheduler/page-change-observer.ts`.
- [ ] Run extension tests/typecheck/build and commit.

## Task 2: Wire Observer into Content Script

- [ ] Update `main.ts` to create a `PageChangeObserver` after panel mount.
- [ ] Observer should call `renderer.refreshAll()` and `autoScheduler.requestRun("mutation" | "image-load" | "resize-observer")` only when autoTranslate is enabled.
- [ ] Run extension tests/typecheck/build and commit.

## Task 3: Dynamic Fixture E2E

- [ ] Add fixture page that appends a manga image after load.
- [ ] Add Playwright loaded-extension test proving overlay appears for the dynamically appended image.
- [ ] Run E2E and commit.

## Task 4: Full Verification and Docs

- [ ] Run `pnpm doctor`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, and loaded-extension E2E.
- [ ] Update README with Phase 9 verification notes.
- [ ] Commit docs.