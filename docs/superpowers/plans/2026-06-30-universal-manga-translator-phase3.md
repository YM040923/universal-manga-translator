# Universal Manga Translator Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve reading smoothness with automatic scan-on-load, throttled scroll prefetch, pause/resume controls, and cache-hit verification.

**Architecture:** Keep extension-side scheduling simple and deterministic. Add a reusable `AutoScheduler` that debounces scan/translate requests, respects pause state, and uses existing detector/scheduler/submit pipeline. Add backend tests proving the same image hits cache on the second submit.

**Tech Stack:** TypeScript, Chrome MV3 content script, Node test runner, Playwright.

---

## Task 1: Backend Cache-Hit Regression

- [ ] Add server test that submits the same `imageData` twice with an injected SQLite `SurfaceCache` and asserts the second response status is `cached`.
- [ ] Run server tests and commit.

## Task 2: Extension Auto Scheduler

- [ ] Create `apps/extension/src/content/scheduler/auto-scheduler.ts` with pause/resume, debounce, and `requestRun(reason)`.
- [ ] Add Node tests for debounce and pause behavior.
- [ ] Wire content script to run once after backend health succeeds and on throttled scroll.
- [ ] Add pause/resume button to floating panel.
- [ ] Run extension tests/build and commit.

## Task 3: E2E Smoothness Smoke

- [ ] Update loaded extension test to wait for overlay without clicking the translate button.
- [ ] Keep click path covered through unit tests and manual controls.
- [ ] Run full verification and commit README update.
