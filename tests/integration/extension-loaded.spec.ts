import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const extensionPath = resolve(root, "apps/extension/dist");
const fixtureOrigin = "http://manga.test:47832";

function spawnFixtureServer(): ChildProcess {
  const httpServer = resolve(root, "node_modules/http-server/bin/http-server");
  return spawn(process.execPath, [httpServer, "tests/fixtures", "-p", "47832", "-a", "127.0.0.1", "--silent"], { cwd: root, stdio: "ignore" });
}

async function launchContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--host-resolver-rules=MAP manga.test 127.0.0.1",
    ],
  });
}

async function activateCurrentPage(context: BrowserContext, page: Page): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10000 });
  const result = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    const tab = tabs.find((item) => item.url === url) ?? tabs[0];
    if (!tab?.id) return { ok: false, error: "fixture tab not found" };
    await chrome.storage.sync.set({ enabledSites: { "manga.test": true } });
    const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return { ok: true, injectedLength: injected.length, tabUrl: tab.url };
  }, page.url());
  expect(result.ok).toBe(true);
}

test("loaded extension stays inactive until the manga site is explicitly enabled", async () => {
  const staticServer = spawnFixtureServer();
  const context = await launchContext();
  try {
    const page = await context.newPage();
    await page.goto(`${fixtureOrigin}/simple-manga.html`);
    await page.evaluate(() => history.replaceState(null, "", "/chapter/60"));
    await expect(page.locator("[data-umt-panel]")).toHaveCount(0);
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(0);

    await activateCurrentPage(context, page);

    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-umt-chapter-progress='true']")).toBeVisible();
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(1);
  } finally {
    await context.close();
    staticServer.kill();
  }
});

test("enabled extension mounts controls for dynamically appended manga images", async () => {
  const staticServer = spawnFixtureServer();
  const context = await launchContext();
  try {
    const page = await context.newPage();
    await page.goto(`${fixtureOrigin}/dynamic-manga.html`);
    await page.evaluate(() => history.replaceState(null, "", "/chapter/61"));
    await expect(page.locator("[data-umt-panel]")).toHaveCount(0);

    await activateCurrentPage(context, page);

    await expect(page.locator(".reader img.page-image")).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(1);
  } finally {
    await context.close();
    staticServer.kill();
  }
});
