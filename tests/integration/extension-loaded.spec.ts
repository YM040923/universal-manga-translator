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

test("loaded extension renders mock overlay on fixture page", async () => {
  const backend = spawnProcess("pnpm", ["--filter", "@umt/server", "dev"]);
  const staticServer = spawnProcess("pnpm", ["exec", "http-server", "tests/fixtures", "-p", "47832", "-a", "127.0.0.1", "--silent"]);
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    await expect.poll(async () => {
      try {
        const response = await context.request.get("http://127.0.0.1:47831/health");
        return response.ok();
      } catch {
        return false;
      }
    }, { timeout: 15000 }).toBe(true);
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:47832/simple-manga.html");
    await expect(page.locator("[data-umt-panel]")).toContainText("backend connected", { timeout: 10000 });
    await page.getByText("翻译当前屏").click();
    await expect(page.locator("[data-umt-region-id='r1']")).toContainText("测试译文", { timeout: 10000 });
  } finally {
    await context.close();
    backend.kill();
    staticServer.kill();
  }
});
