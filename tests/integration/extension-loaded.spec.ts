import { test, expect, chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const extensionPath = resolve(root, "apps/extension/dist");

function spawnProcess(command: string, args: string[]) {
  return spawn(command, args, { cwd: root, shell: true, stdio: "ignore" });
}

async function waitForBackend(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>) {
  await expect.poll(async () => {
    try {
      const response = await context.request.get("http://127.0.0.1:47831/health");
      return response.ok();
    } catch {
      return false;
    }
  }, { timeout: 15000 }).toBe(true);
}

test("loaded extension automatically renders mock overlay on mixed fixture page", async () => {
  const backend = spawnProcess("pnpm", ["--filter", "@umt/server", "dev"]);
  const staticServer = spawnProcess("pnpm", ["exec", "http-server", "tests/fixtures", "-p", "47832", "-a", "127.0.0.1", "--silent"]);
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    await waitForBackend(context);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:47832/simple-manga.html");
    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".reader .background-page")).toHaveCount(1);
    await expect(page.locator(".reader canvas.canvas-page")).toHaveCount(1);
    await expect(page.locator("[data-umt-region-id='r1']").first()).toHaveText(/\S+/, { timeout: 10000 });
  } finally {
    await context.close();
    backend.kill();
    staticServer.kill();
  }
});

test("loaded extension automatically translates dynamically appended manga image", async () => {
  const backend = spawnProcess("pnpm", ["--filter", "@umt/server", "dev"]);
  const staticServer = spawnProcess("pnpm", ["exec", "http-server", "tests/fixtures", "-p", "47832", "-a", "127.0.0.1", "--silent"]);
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    await waitForBackend(context);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:47832/dynamic-manga.html");
    await expect(page.locator(".reader img.page-image")).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator("[data-umt-panel]")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-umt-region-id='r1']").first()).toHaveText(/\S+/, { timeout: 15000 });
  } finally {
    await context.close();
    backend.kill();
    staticServer.kill();
  }
});