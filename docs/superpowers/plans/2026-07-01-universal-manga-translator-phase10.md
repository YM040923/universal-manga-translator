# Universal Manga Translator Phase 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a repeatable real-site compatibility scanner so detector/scheduler work can be guided by evidence from actual manga reader pages instead of guesses.

**Architecture:** Add a Node Playwright CLI that opens one or more URLs, waits for lazy content, evaluates image/background/canvas candidates in the page, scores manga-like surfaces, and writes a JSON report. Keep the scanner independent of the extension runtime so it can run against arbitrary public sites and local fixtures.

**Tech Stack:** Node ESM, Playwright Chromium, Node built-in test runner, JSON reports.

---

## Task 1: Scanner Core

- [ ] Write failing tests for candidate scoring and report summarization in `scripts/scan-sites.test.mjs`.
- [ ] Implement `scripts/scan-sites.mjs` exporting `scoreCandidate()`, `summarizeCandidates()`, and `scanUrl()`.
- [ ] Add root package script `scan:sites`.
- [ ] Run `pnpm test` and commit.

## Task 2: Fixture Scan Verification

- [ ] Run the scanner against local fixture pages served by `http-server`.
- [ ] Save a compatibility matrix document under `docs/compat/sites.md` with command examples and fixture evidence.
- [ ] Commit.

## Task 3: Real URL Scan Support

- [ ] Run scanner against at least one publicly reachable real manga/reader-like URL if accessible from the environment.
- [ ] Record results or blockers in `docs/compat/sites.md`.
- [ ] Run full verification and commit docs.