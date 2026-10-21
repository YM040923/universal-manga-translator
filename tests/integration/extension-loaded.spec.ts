import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(__dirname, "../fixtures");
const extensionPath = resolve(__dirname, "../../apps/extension/dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};

/**
 * The fixture site is served in-process on a free port: a spawned http-server on a fixed
 * port both collided with local OCR (47832) and left orphaned Windows child processes
 * behind when a test failed before teardown.
 */
async function startFixtureServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://manga.test").pathname;
    const file = resolve(fixtureRoot, `.${pathname}`);
    if (!file.startsWith(fixtureRoot + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, origin: `http://manga.test:${port}` };
}

async function stopFixtureServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
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

/** The subset of the extension service-worker API the fixture harness drives. */
interface FixtureChrome {
  tabs: { query: (criteria: { url: string }) => Promise<Array<{ id?: number; url?: string }>> };
  storage: { sync: { set: (value: Record<string, unknown>) => Promise<void> } };
  scripting: {
    executeScript: (details: { target: { tabId: number; allFrames?: boolean }; files: string[] }) => Promise<unknown[]>;
  };
}

async function activateCurrentPage(context: BrowserContext, page: Page): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10000 });
  const result = await worker.evaluate(async (url) => {
    const chrome = (globalThis as unknown as { chrome: FixtureChrome }).chrome;
    const tabs = await chrome.tabs.query({ url: `${new URL(url).origin}/*` });
    const tab = tabs.find((item) => item.url === url) ?? tabs[0];
    if (!tab?.id) return { ok: false, error: "fixture tab not found" };
    await chrome.storage.sync.set({ enabledSites: { "manga.test": true } });
    // Mirrors the product's injection: an enabled tab is injected as a whole, frames included.
    const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    return { ok: true, injectedLength: injected.length, tabUrl: tab.url };
  }, page.url());
  expect(result.ok).toBe(true);
}

async function runWithFixtures(run: (page: Page, context: BrowserContext, origin: string) => Promise<void>): Promise<void> {
  const { server, origin } = await startFixtureServer();
  let context: BrowserContext | undefined;
  try {
    context = await launchContext();
    const page = await context.newPage();
    await run(page, context, origin);
  } finally {
    await context?.close();
    await stopFixtureServer(server);
  }
}

test("loaded extension stays inactive until the manga site is explicitly enabled", async () => {
  await runWithFixtures(async (page, context, origin) => {
    await page.goto(`${origin}/simple-manga.html`);
    await page.evaluate(() => history.replaceState(null, "", "/chapter/60"));
    await expect(page.locator("[data-umt-panel]")).toHaveCount(0);
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(0);

    await activateCurrentPage(context, page);

    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-umt-chapter-progress='true']")).toBeVisible();
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(1);
  });
});

test("enabled extension mounts controls for dynamically appended manga images", async () => {
  await runWithFixtures(async (page, context, origin) => {
    await page.goto(`${origin}/dynamic-manga.html`);
    await page.evaluate(() => history.replaceState(null, "", "/chapter/61"));
    await expect(page.locator("[data-umt-panel]")).toHaveCount(0);

    await activateCurrentPage(context, page);

    await expect(page.locator(".reader img.page-image")).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(1);
  });
});

test("enabled extension mounts per-page controls inside an embedded reader frame", async () => {
  await runWithFixtures(async (page, context, origin) => {
    await page.goto(`${origin}/embedded-manga.html`);
    const reader = page.frameLocator("iframe.reader-frame");
    await expect(page.locator("[data-umt-panel]")).toHaveCount(0);
    await expect(reader.locator("[data-umt-surface-button]")).toHaveCount(0);

    await activateCurrentPage(context, page);

    await expect(reader.locator("[data-umt-surface-button]")).toHaveCount(2, { timeout: 15000 });
    // The shell page owns no pages, so the tab-level widget can only appear from the frame's
    // report travelling through the service worker.
    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-umt-surface-button]")).toHaveCount(0);
  });
});

test("reader frame added after activation is injected without a reload", async () => {
  await runWithFixtures(async (page, context, origin) => {
    await page.goto(`${origin}/lazy-embedded-manga.html`);
    await activateCurrentPage(context, page);
    await expect(page.locator("[data-umt-panel]")).toHaveCount(0);

    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.className = "reader-frame";
      frame.title = "Manga reader frame";
      frame.src = "./frame-reader.html";
      document.querySelector("#shell")?.append(frame);
    });

    const reader = page.frameLocator("iframe.reader-frame");
    await expect(reader.locator("[data-umt-surface-button]")).toHaveCount(2, { timeout: 20000 });
    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 20000 });
  });
});
