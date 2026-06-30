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
