# Release checklist

Before publishing or packaging Universal Manga Translator:

1. Do not commit `.env`, `apps/server/data/`, build output, logs, or `node_modules/`.
2. Run the local validation suite:

   ```powershell
   pnpm install
   pnpm typecheck
   pnpm test
   pnpm build
   ```

3. Build the extension and load `apps/extension/dist` in Chrome developer mode.
4. For desktop packaging, build with `pnpm --filter @umt/desktop package` and upload installers as GitHub Release assets instead of committing them.
5. Verify API examples use placeholder keys only.

Recommended first-time setup for users is extension direct mode. Desktop/backend mode is optional for advanced local management.
