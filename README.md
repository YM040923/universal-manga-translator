# Universal Manga Translator

## Development

```powershell
pnpm install
pnpm dev:server
pnpm dev:extension
```

The backend listens on `http://127.0.0.1:47831` by default.

## MVP Verification

The MVP vertical slice is verified when `pnpm test`, `pnpm build`, and `pnpm test:e2e` pass, and the unpacked extension renders a mock translated overlay on `tests/fixtures/simple-manga.html` while connected to the local backend.

## Phase 2 Verification

Phase 2 adds persistent SQLite cache, backend image URL input, WebSocket job events, and extension-side submission dedupe. Verification includes `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.

## Phase 3 Verification

Phase 3 adds automatic scan-on-load, throttled scroll-triggered prefetch, pause/resume controls, and cache-hit regression coverage. The loaded-extension E2E now verifies that the mock translated overlay appears automatically without clicking the translate button.
## Phase 4 Verification

Phase 4 adds provider image normalization/compression, tolerant OpenAI JSON extraction, structured failed submit responses, `job.failed` WebSocket events, and extension-side failed translation counters. Verified on 2026-06-30 with `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
## Phase 5 Verification

Phase 5 adds mixed manga surface support: normal `<img>` pages, CSS `background-image` panels, exportable `<canvas>` readers, image-data fallback submission, and overlay refresh on scroll/resize/layout changes. Verified on 2026-06-30 with `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
