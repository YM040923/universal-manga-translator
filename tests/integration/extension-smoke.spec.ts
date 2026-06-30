import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

test("fixture page has mixed manga surfaces", async ({ page }) => {
  await page.goto(`file://${resolve(root, "tests/fixtures/simple-manga.html")}`);
  await expect(page.locator(".reader img.page-image")).toHaveCount(1);
  await expect(page.locator(".reader .background-page")).toHaveCount(1);
  await expect(page.locator(".reader canvas.canvas-page")).toHaveCount(1);
  const box = await page.locator(".reader img.page-image").boundingBox();
  expect(box?.width).toBe(800);
});

test("backend health is reachable during e2e", async ({ request }) => {
  const server = spawn("pnpm", ["--filter", "@umt/server", "dev"], { cwd: root, shell: true });
  try {
    await expect.poll(async () => {
      try {
        const response = await request.get("http://127.0.0.1:47831/health");
        return response.ok();
      } catch {
        return false;
      }
    }, { timeout: 15000 }).toBe(true);
  } finally {
    server.kill();
  }
});