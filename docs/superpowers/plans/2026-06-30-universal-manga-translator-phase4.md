# Universal Manga Translator Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve real-world robustness with normalized image payloads, tolerant OpenAI JSON parsing, graceful server failures, and extension failure status.

**Architecture:** Add server image normalization before provider calls, preserve original hash/cache key behavior, and make provider/server failures produce structured failed responses/events instead of uncaught 500s. Add extension handling for failed submit responses and job.failed events.

**Tech Stack:** TypeScript, sharp, Fastify, Chrome MV3, Node test runner.

---

## Task 1: Image Normalization
- Add `apps/server/src/image/normalize.ts` with sharp-based JPEG normalization and tests.
- Use normalized buffer for provider input but original buffer hash for cache key.
- Verify server tests and commit.

## Task 2: Tolerant OpenAI JSON Parsing
- Extract fenced JSON/object JSON from model response content.
- Test raw JSON, fenced ```json, and prefix/suffix text.
- Verify server tests and commit.

## Task 3: Graceful Failed Responses
- Add failed response/event on provider or image errors.
- Test submit with provider throwing returns `{ ok:false }` and publishes `job.failed`.
- Verify server tests and commit.

## Task 4: Extension Failure Status
- Extension increments failed counter for failed responses/events.
- Add unit test for event counter helper.
- Verify extension tests/build and commit.

## Task 5: Full Verification and Docs
- Run `pnpm test`, `pnpm build`, `pnpm test:e2e`.
- Append Phase 4 notes to README and commit.
