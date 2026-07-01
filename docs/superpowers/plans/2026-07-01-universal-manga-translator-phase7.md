# Universal Manga Translator Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist manual translation edits in the local backend SQLite database so user corrections survive page reloads, browser restarts, and backend restarts.

**Architecture:** Add a `manual_overrides` SQLite table keyed by image hash, target language, and region id. The backend exposes small REST endpoints to save/list overrides and applies matching overrides before returning cached or newly generated surface results. The extension keeps instant local edits for responsiveness and asynchronously saves edits to the backend.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Chrome content script, Node built-in test runner.

---

## File Structure

- Modify `apps/server/src/cache/db.ts`: create `manual_overrides` table.
- Create `apps/server/src/cache/manual-overrides.ts`: `ManualOverrideStore` with `save()`, `listForImage()`, and `applyToResult()`.
- Create `apps/server/src/cache/manual-overrides.test.ts`: persistence and apply behavior.
- Modify `apps/server/src/api/server.ts`: apply overrides to submit results and add `POST /v1/overrides` plus `GET /v1/overrides`.
- Modify `apps/server/src/api/server.test.ts`: API tests for saving and applying overrides.
- Modify `packages/shared/src/protocol.ts`: add override request/response types.
- Modify `apps/extension/src/content/client/backend-client.ts`: add `saveManualOverride()`.
- Modify `apps/extension/src/content/client/backend-client.test.ts`: assert URL/method/body for override save using fake fetch.
- Modify `apps/extension/src/content/overlay/overlay-renderer.ts`: accept optional `onManualEdit` callback and call it after prompt edit.
- Modify `apps/extension/src/content/overlay/overlay-renderer.test.ts`: verify callback receives image hash, target language, region id, text.
- Modify `apps/extension/src/content/main.ts`: pass callback that calls backend client.
- Modify `README.md`: document Phase 7 verification.

---

## Task 1: Manual Override Store

- [ ] Write failing tests for saving overrides, listing by image hash/target language, and applying overrides to a `SurfaceResult`.
- [ ] Run `pnpm --filter @umt/server test`; expected FAIL because store does not exist.
- [ ] Implement table migration in `db.ts` and `ManualOverrideStore` in `manual-overrides.ts`.
- [ ] Run `pnpm --filter @umt/server test`; expected PASS.
- [ ] Commit: `git add apps/server/src/cache && git commit -m "feat(server): persist manual translation overrides"`.

## Task 2: Override API and Submit Application

- [ ] Add server tests: `POST /v1/overrides` saves an override; subsequent identical submit returns the edited text in the matching region.
- [ ] Run `pnpm --filter @umt/server test`; expected FAIL because routes are missing.
- [ ] Add protocol types to `packages/shared/src/protocol.ts`.
- [ ] Extend `buildServer()` to accept/create `ManualOverrideStore`, add override routes, and apply overrides before returning cached or completed results.
- [ ] Run `pnpm --filter @umt/shared test` and `pnpm --filter @umt/server test`; expected PASS.
- [ ] Commit: `git add packages/shared/src/protocol.ts apps/server/src/api/server.ts apps/server/src/api/server.test.ts && git commit -m "feat(server): apply manual overrides in submit results"`.

## Task 3: Extension Save Manual Edits

- [ ] Add backend-client test with fake fetch for `saveManualOverride()`.
- [ ] Add overlay test that editing a region invokes `onManualEdit` with `{ imageHash, targetLanguage, regionId, translatedText }`.
- [ ] Run `pnpm --filter @umt/extension test`; expected FAIL.
- [ ] Implement `BackendClient.saveManualOverride()`.
- [ ] Add `OverlayRenderer` constructor option `targetLanguage` and `onManualEdit` callback; preserve local immediate edit.
- [ ] Wire content `main.ts` to create `OverlayRenderer({ targetLanguage: settings.targetLanguage, onManualEdit: override => void client.saveManualOverride(override) })`.
- [ ] Run extension test/typecheck/build; expected PASS.
- [ ] Commit: `git add apps/extension/src/content && git commit -m "feat(extension): persist manual edits to backend"`.

## Task 4: Full Verification and Docs

- [ ] Run `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
- [ ] Update README with Phase 7 verification and note that manual edits persist through backend SQLite.
- [ ] Commit: `git add README.md docs/superpowers/plans/2026-07-01-universal-manga-translator-phase7.md && git commit -m "docs: record phase 7 manual override verification"`.