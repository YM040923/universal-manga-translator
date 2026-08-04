import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, "../fixtures/font-compatibility/index.html");

test("generated font and bubble fixture sheet remains visually stable", async ({ page }) => {
  test.skip(process.platform !== "win32", "This generated typography baseline is intentionally pinned to the supported Windows rendering stack.");
  await page.setViewportSize({ width: 980, height: 860 });
  await page.goto(`file://${fixture}`);
  await expect(page.locator(".case img")).toHaveCount(4);
  await expect(page).toHaveScreenshot("font-bubble-fixtures.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.002 });
});
