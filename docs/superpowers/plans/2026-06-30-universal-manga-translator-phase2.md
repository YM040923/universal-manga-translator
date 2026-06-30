# Universal Manga Translator Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MVP practical for self-use by adding persistent SQLite caching, backend image URL download, WebSocket job events, and extension-side prefetch/status updates.

**Architecture:** Extend the existing TypeScript monorepo without changing the public surface protocol unnecessarily. The backend submit route will normalize task images from either `imageData` or `imageUrl`, use SQLite-backed cache instead of memory-only cache, and publish queue lifecycle events over WebSocket. The extension will connect to the event stream, render cache hits/results, and submit P0/P1 surfaces with basic dedupe.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Node fetch, Chrome MV3, Playwright, Node test runner.

---

## Task 1: Persistent SQLite Surface Cache

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\server\src\cache\db.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\cache\surface-cache.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\cache\surface-cache.test.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\server\src\api\server.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\server\src\main.ts`

- [ ] **Step 1: Write cache test**

Create `apps/server/src/cache/surface-cache.test.ts` with a Node test that opens a temp SQLite file, saves a `SurfaceResult`, closes/reopens DB, and verifies the result persists.

- [ ] **Step 2: Implement DB and cache classes**

Create `db.ts` with `openDatabase(path)` and table `surface_results(cache_key primary key, result_json, updated_at)`. Create `SurfaceCache` with `get(cacheKey)` and `save(cacheKey, result)`.

- [ ] **Step 3: Inject cache into server**

Update `BuildServerOptions` to accept optional `surfaceCache`; submit route checks SQLite first, saves completed/empty results, and falls back to memory only if no cache is supplied.

- [ ] **Step 4: Wire main to data/cache.sqlite**

`main.ts` creates `apps/server/data/cache.sqlite`, opens DB, and passes `SurfaceCache` to `buildServer`.

- [ ] **Step 5: Verify and commit**

Run `pnpm --filter @umt/server test` and commit `feat(server): persist surface results in sqlite`.

## Task 2: Backend Image URL Download

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\server\src\image\image-input.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\image\image-input.test.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\server\src\api\server.ts`

- [ ] **Step 1: Write image input tests**

Test that `readTaskImage` decodes data URLs and fetches `imageUrl` using a mocked `fetch`.

- [ ] **Step 2: Implement image input reader**

`readTaskImage(task)` returns `{ buffer, source }`; data URL wins over URL. URL fetch throws a clear error for non-2xx responses.

- [ ] **Step 3: Use reader in submit route**

Replace local decode logic with `readTaskImage`.

- [ ] **Step 4: Verify and commit**

Run server tests and commit `feat(server): accept image urls in submit route`.

## Task 3: WebSocket Event Stream

**Files:**
- Create: `F:\meihua\universal-manga-translator\apps\server\src\api\events.ts`
- Create: `F:\meihua\universal-manga-translator\apps\server\src\api\events.test.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\server\src\api\server.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\server\package.json`

- [ ] **Step 1: Write event stream test**

Create a server with EventBus, connect to `/v1/events` using `WebSocket`, submit a task, and assert queued/processing/completed event types arrive.

- [ ] **Step 2: Implement EventBus and WebSocket route**

Add dependency `@fastify/websocket`. `EventBus` supports subscribe/publish. `buildServer` registers `/v1/events` and publishes `job.queued`, `job.processing`, `job.cached`, `job.completed`, `job.failed`.

- [ ] **Step 3: Verify and commit**

Run server tests and commit `feat(server): stream job events over websocket`.

## Task 4: Extension Event Client and Dedupe

**Files:**
- Modify: `F:\meihua\universal-manga-translator\apps\extension\src\content\client\backend-client.ts`
- Modify: `F:\meihua\universal-manga-translator\apps\extension\src\content\main.ts`
- Create: `F:\meihua\universal-manga-translator\apps\extension\src\content\client\backend-client.test.ts`

- [ ] **Step 1: Write client tests**

Test URL conversion from `http://127.0.0.1:47831` to `ws://127.0.0.1:47831/v1/events`, and ensure duplicate surface IDs are not submitted twice during one scan.

- [ ] **Step 2: Implement event client**

BackendClient gets `eventsUrl()` and `connectEvents(onEvent)`. Content script maintains `submittedSurfaceIds` and panel status counters.

- [ ] **Step 3: Verify and commit**

Run extension tests/build and commit `feat(extension): consume backend events and dedupe submissions`.

## Task 5: Phase 2 Verification

**Files:**
- Modify: `F:\meihua\universal-manga-translator\README.md`

- [ ] **Step 1: Run full verification**

Run `pnpm test`, `pnpm build`, `pnpm test:e2e`, and loaded extension Playwright test.

- [ ] **Step 2: Document Phase 2 verification**

Append README notes for persistent cache and WebSocket event verification.

- [ ] **Step 3: Commit docs**

Commit `docs: record phase 2 verification`.
