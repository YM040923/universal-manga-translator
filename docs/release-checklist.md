# Release checklist

Universal Manga Translator 的普通用户交付物优先是 Chrome 插件包。Desktop/backend are advanced or experimental and should not be presented as the default installation path.

Before publishing a release:

1. Do not commit `.env`, `apps/server/data/`, build output, logs, `release/`, or `node_modules/`.
2. Verify API examples use placeholder keys only.
3. Run the local validation suite. The recommended one-command gate is:

   ```powershell
   pnpm release:check
   ```

   If you need to run the checks manually, use:

   ```powershell
   pnpm install
   pnpm typecheck
   pnpm test
   pnpm test:e2e
   pnpm build
   ```

4. Build the extension release zip:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
   ```

5. Confirm the final release assets pass the combined release verifier:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\verify-release-assets.ps1
   ```

   This runs `scripts/verify-extension-package.ps1`, confirms the zip contains `manifest.json` and required runtime files at the archive root, blocks source files, `.env`, logs, cache/data, and workspace folders from the release asset, verifies `extension-release.zip.sha256` matches the zip bytes, and validates `build-info.json` against the package version, extension version, commit, dirty flag, zip filename, checksum, and build timestamp.

6. Load `apps/extension/dist` in Chrome developer mode and verify the popup opens, self-test reports API failures clearly, and a manga chapter page can be translated.

   The automated suite includes generated font/bubble SVG fixtures and a Windows visual screenshot baseline. Do not replace those fixtures with copyrighted manga pages.

   Manual smoke test:

   - Install from `apps/extension/dist`, open the popup, and confirm it renders immediately.
   - On a never-enabled manga domain, confirm no page UI appears before clicking `enable the site` in the popup.
   - After enabling, open a real chapter reader page and confirm the progress widget, the show/hide floating button, and the top-left image buttons appear on manga images.
   - Open directory/detail pages on the same site and confirm they are not treated as reader pages.
   - Run `API self-test` once with intentionally missing or invalid credentials and confirm the popup reports the OCR/AI error clearly without leaking API keys.
   - Run `API self-test` once with valid credentials and confirm OCR parsing plus translator connectivity are reported.
   - Trigger auto translation and confirm the first chapter image finishes before later concurrent pages.
   - Click a top-left image retry button and confirm `single-page retranslate` only queues that image.
   - Use `manual selection` on a small region, refresh the page, and confirm the cached manual bubble remains and is not overwritten by normal translation.
   - Edit one translated bubble, refresh, and confirm the manual edit persists; delete the text and confirm the bubble stays removed.

### Optional automated extension QA

For a repeatable local browser smoke test, run:

```powershell
pnpm qa:extension -- --url=https://example.com/chapter/1
```

Useful variants:

```powershell
pnpm qa:extension -- --help
pnpm qa:extension -- --configure-direct=true --translate=2
pnpm qa:extension -- --run-mode=backend
```

Default QA mode is the pure plugin path. It enables the primary domain from `--url`, verifies the content script, progress widget, and image buttons mount, and writes:

```text
qa-output/extension-qa-report.json
qa-output/extension-qa.png
```

Use `--run-mode=backend` only for advanced backend validation.

For live reader acceptance without consuming OCR/translation quota, run the QA command with `--translate=0` on `asurascans.com`, `comix.to`, and one additional lazy-loading reader. When valid credentials are available, manually translate no more than one image per site to verify OCR mapping and returned overlay placement.

7. Upload `release/extension-release.zip` as the primary GitHub Release asset, and upload `release/extension-release.zip.sha256` plus `release/build-info.json` beside it.
8. Copy `docs/release-notes-template.md` into the GitHub Release body and fill in the version-specific changes.
9. Mention in release notes that users should unzip the package and load the extracted directory through `chrome://extensions`.
10. Confirm the GitHub Actions CI run passed for the commit being released.
11. If CI did not run, run the same checks locally before publishing:

   ```powershell
   pnpm typecheck
   pnpm test
   powershell -ExecutionPolicy Bypass -File .\scripts\package-extension.ps1
   powershell -ExecutionPolicy Bypass -File .\scripts\verify-release-assets.ps1
   ```

Advanced assets:

- Desktop/backend packages are optional advanced assets only.
- If packaged, build with `pnpm --filter @umt/desktop package` and upload installers as separate GitHub Release assets.
- Do not make desktop/backend setup part of the default user instructions.
