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
## Extension Settings

Open the extension options page from the floating panel `Settings` button or from Chrome's extension details page. Current settings are stored in `chrome.storage.sync`:

- Backend URL, default `http://127.0.0.1:47831`.
- Target language, default `zh-CN`.
- Auto translate current and nearby pages, enabled by default.

## Phase 6 Verification

Phase 6 adds persistent extension settings, an options page, configured backend URL/target language, an auto-translate toggle, a floating-panel Settings button, and a build regression check that prevents Chrome content scripts from containing static module imports. Verified on 2026-07-01 with `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
## Phase 7 Verification

Phase 7 adds backend-persistent manual translation overrides in SQLite. Clicking an overlay still updates text immediately in the page, and the edit is also saved through `POST /v1/overrides`; future submit/cache responses for the same image hash, target language, and region id apply the saved text. Verified on 2026-07-01 with `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`.
## Daily Use

From **PowerShell** in `F:\meihua\universal-manga-translator`:

```powershell
pnpm install
pnpm doctor
.\scripts\build-extension.ps1
.\scripts\start-backend.ps1
```

Then open Chrome `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select:

```text
F:\meihua\universal-manga-translator\apps\extension\dist
```

For a full local confidence check run:

```powershell
.\scripts\check.ps1
```

Use the floating panel `Settings` button to change backend URL, target language, or auto-translate behavior.
If you are using **cmd.exe** instead of PowerShell, switch drives with `/d` first:

```cmd
cd /d F:\meihua\universal-manga-translator
pnpm install
pnpm doctor
powershell -ExecutionPolicy Bypass -File .\scripts\build-extension.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```

In cmd, plain `cd F:\...` does not change the active drive from `C:` to `F:`.

## Phase 8 Verification

Phase 8 adds `pnpm doctor`, root script tests, and Windows helper scripts for building the unpacked extension, starting the backend, and running a full local check. Verified on 2026-07-01 with `pnpm doctor`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`, `scripts/build-extension.ps1`, and `scripts/check.ps1`.
## Phase 9 Verification

Phase 9 adds page-change observation for lazy-loaded and dynamically appended manga pages. The content script now reacts to DOM mutations, captured image load events, and resize observation by refreshing overlays and scheduling translation when auto-translate is enabled. Verified on 2026-07-01 with `pnpm doctor`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm exec playwright test tests/integration/extension-loaded.spec.ts`; loaded-extension E2E includes a dynamically appended manga image fixture.
