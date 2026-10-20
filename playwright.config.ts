import { defineConfig } from "@playwright/test";

/**
 * The specs launch their own persistent Chromium because MV3 extensions only load in a
 * headed browser, so this suite needs a desktop session and must not share workers.
 */
export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
});
