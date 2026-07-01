# Universal Manga Translator Completion Design

> **For agentic workers:** This spec continues the existing Universal Manga Translator project after Phase 10. It focuses on converting the current MVP+ into a daily-use personal translator with robust AI configuration, screenshot fallback, manual selection, task controls, cache management, and later OCR/translation pipeline upgrades.

## Goal

Finish the remaining high-impact features needed for a smooth personal-use universal manga translator:

1. polish the popup/options UI and make provider status understandable;
2. make real AI configuration observable from the extension;
3. add screenshot fallback for blocked/tainted/unsupported image sources;
4. add manual region selection translation;
5. add task controls, cache management, and retranslation;
6. prepare a future OCR + translation pipeline while retaining vision-model fallback;
7. improve overlay layout and real-site compatibility evidence.

## Current Baseline

The project already has a TypeScript monorepo with `@umt/shared`, `@umt/server`, and `@umt/extension`. The extension supports toolbar popup, options page, content overlay, image/background/canvas detection, auto scheduling, page-change observation, WebSocket events, manual overrides, and SQLite result cache. The server supports `/health`, `/v1/surfaces/submit`, `/v1/events`, `/v1/overrides`, image normalization, mock provider, and OpenAI-compatible provider.

## Approach

Implement the remaining work in incremental phases that are independently testable.

### Phase 11: Runtime AI configuration and product polish

Expose backend provider/config status without leaking secrets. The options page should show whether the backend is using mock or a real OpenAI-compatible provider, which model/base URL is active, and whether the API key is configured. The extension may store UI preferences, but API secrets remain in the backend `.env`.

### Phase 12: Screenshot fallback and manual selection

Add a background-script capture bridge using `chrome.tabs.captureVisibleTab`. The content script requests visible-tab screenshots, crops them by DOM/client coordinates, and submits cropped `imageData` when direct image URL/canvas extraction fails or when the user manually draws a region.

### Phase 13: Task control and cache management

Add server endpoints for cache stats/clear, result retranslation, and cancellation. The extension popup/options should expose refresh/retranslate/clear-cache actions. The backend should avoid wasted provider calls where possible and return structured statuses.

### Phase 14: Provider pipeline upgrade

Introduce provider modes: `vision-all-in-one`, `ocr-then-translate`, and `mock`. Keep OpenAI-compatible vision as the default real route. Add interfaces for future OCR and translation providers without forcing a specific paid vendor immediately.

### Phase 15: Overlay and compatibility hardening

Improve text fitting, vertical text, style modes, and real-site reports. Continue using fixture and scanner tests to avoid guessing.

## Data Flow Additions

### Backend config status

`GET /v1/config/status` returns sanitized provider information:

```json
{
  "ok": true,
  "provider": "openai",
  "targetLanguage": "zh-CN",
  "providerProfile": "openai-compatible:gpt-4.1-mini",
  "openAICompatible": {
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4.1-mini",
    "apiKeyConfigured": true
  }
}
```

No plaintext API key is returned.

### Screenshot capture

Content script sends `captureVisibleTab` command to background. Background captures the active tab image. Content crops with canvas using the target rectangle and sends data URL as `imageData` in `SurfaceTask`.

### Manual selection

Content script enables a fixed-position selection layer. User drags a rectangle. The rectangle is converted into viewport coordinates, cropped from screenshot, submitted with a synthetic surface id, then rendered over the selected rectangle.

## Error Handling

- If backend is offline, popup/options show backend offline and direct user to start the local service.
- If provider is mock, UI clearly labels results as test mode.
- If API key is missing, UI says backend is online but real AI is not configured.
- If direct image read fails, content attempts screenshot fallback.
- If screenshot capture fails, the floating button reports the error and keeps the page usable.
- Cache clear endpoints return counts so the UI can show what changed.

## Testing Strategy

- Server unit tests for config status, cache stats/clear, retranslate/cancel behavior.
- Extension unit tests for background message handling, screenshot crop math, manual selection state, popup/options status rendering.
- Existing Playwright loaded-extension tests continue to validate fixture behavior.
- Real-site scanner remains evidence-gathering only; tests should not depend on external websites.

## Scope Rules

- API keys never go into extension storage.
- The screenshot fallback is local-only; no screenshots are sent anywhere except the configured local backend.
- Inpainting and full original-text erasure are not required before manual selection, cache management, and provider status are done.
- OCR + translation provider implementations can be added after the interfaces are in place.
