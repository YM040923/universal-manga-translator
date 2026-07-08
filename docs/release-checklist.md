# Release checklist

Universal Manga Translator 的普通用户交付物优先是 Chrome 插件包。Desktop/backend are advanced or experimental and should not be presented as the default installation path.

Before publishing a release:

1. Do not commit `.env`, `apps/server/data/`, build output, logs, `release/`, or `node_modules/`.
2. Verify API examples use placeholder keys only.
3. Run the local validation suite:

   ```powershell
   pnpm install
   pnpm typecheck
   pnpm test
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

   This runs `scripts/verify-extension-package.ps1`, confirms the zip contains `manifest.json` and required runtime files at the archive root, blocks source files, `.env`, logs, cache/data, and workspace folders from the release asset, and verifies `extension-release.zip.sha256` matches the zip bytes.

6. Load `apps/extension/dist` in Chrome developer mode and verify the popup opens, self-test reports API failures clearly, and a manga chapter page can be translated.
7. Upload `release/extension-release.zip` as the primary GitHub Release asset, and upload `release/extension-release.zip.sha256` beside it.
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
