# Site Compatibility Matrix

Date: 2026-07-01

## Scanner

Run from the repo root:

```powershell
pnpm scan:sites <url1> <url2> --out=docs/compat/report.json
```

The scanner opens each URL with Playwright, waits for lazy content, collects image/canvas/background candidates, scores likely manga surfaces, and writes JSON evidence.

## Fixture Evidence

Command used:

```powershell
pnpm scan:sites http://127.0.0.1:47832/simple-manga.html http://127.0.0.1:47832/dynamic-manga.html --out=docs/compat/fixture-scan.json
```

Results:

| URL | Candidate count | Likely surfaces | Kinds |
| --- | ---: | ---: | --- |
| `simple-manga.html` | 4 | 3 | image, canvas, background |
| `dynamic-manga.html` | 1 | 1 | image |

## Real URL Probe

Command used:

```powershell
pnpm scan:sites https://xkcd.com/1/ https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95 https://mangaplus.shueisha.co.jp/titles/100020 --out=docs/compat/real-scan.json
```

Results as of 2026-07-01:

| URL | Candidate count | Likely surfaces | Notes |
| --- | ---: | ---: | --- |
| `https://xkcd.com/1/` | 4 | 1 | Simple image comic page detected. |
| `https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95` | 69 | 1 | Landing/list page detects one large background hero image; not an episode reader page. Sprite false positives were reduced. |
| `https://mangaplus.shueisha.co.jp/titles/100020` | 17 | 0 | Title/list page has no readable chapter surfaces in initial DOM; reader pages likely require app-specific navigation/canvas handling. |

## Next Compatibility Targets

- Add scan URLs for actual episode/chapter reader pages rather than title/list pages.
- Capture screenshots in scanner output for visual inspection.
- Add per-site include/exclude overrides once real false positives are confirmed.
## Capture Capability Notes

As of Phase 15, scanner summaries include `captureHints`:

- `directImageCandidates`: likely surfaces that can usually be submitted by URL.
- `screenshotFallbackCandidates`: likely surfaces that may need visible-tab screenshot crop fallback, including canvas, blob, or non-http background sources.
- `canvasCandidates`: likely canvas readers.
- `backgroundCandidates`: likely CSS background readers.

This matches the extension's current fallback model: try normal surface submission first, then use visible-tab screenshot crops when direct input fails or when the user manually selects a region.
