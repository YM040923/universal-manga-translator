import { chromium } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_URL = "https://asurascans.com/comics/the-heavenly-demon-wants-a-quiet-life-30e93729/chapter/60";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const url = args.get("url") || DEFAULT_URL;
const translateCount = Math.max(0, Math.min(10, Number(args.get("translate") || "0") || 0));
const timeoutMs = Math.max(10_000, Number(args.get("timeout") || "180000") || 180_000);
const projectRoot = resolve(import.meta.dirname, "..");
const extensionDir = resolve(projectRoot, "apps/extension/dist");
const outputDir = resolve(projectRoot, "qa-output");
const profileDir = resolve(projectRoot, ".qa-chromium-profile");

await rm(profileDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
  ],
  viewport: { width: 1280, height: 900 },
});

const report = {
  ok: false,
  url,
  translateCount,
  extensionDir,
  checks: [],
  serviceWorkers: [],
  console: [],
  pageState: null,
  backend: null,
  diagnostics: null,
  screenshot: resolve(outputDir, "extension-qa.png"),
};

function check(name, ok, detail = "") {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return ok;
}

try {
  await context.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => null);
  report.serviceWorkers = context.serviceWorkers().map((worker) => worker.url());
  check("extension-service-worker", report.serviceWorkers.some((item) => item.startsWith("chrome-extension://")), report.serviceWorkers.join(", "));

  const page = await context.newPage();
  page.on("console", (msg) => report.console.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => report.console.push({ type: "pageerror", text: String(err.stack || err) }));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(8_000);

  report.backend = await fetchJsonFromNode("http://127.0.0.1:47831/health");

  report.pageState = await readPageState(page);
  check("content-script-injected", report.pageState.overlayRoots >= 1 || report.pageState.progress.length >= 1, JSON.stringify({ overlayRoots: report.pageState.overlayRoots, progress: report.pageState.progress.length }));
  check("manga-images-detected", report.pageState.mangaImages >= 5, `${report.pageState.mangaImages} manga-like images`);
  check("surface-buttons-mounted", report.pageState.buttons.length >= Math.min(5, Math.max(1, report.pageState.mangaImages)), `${report.pageState.buttons.length} buttons`);
  check("progress-mounted", report.pageState.progress.length >= 1, `${report.pageState.progress.length} progress panels`);
  check("backend-reachable", Boolean(report.backend?.ok), JSON.stringify(report.backend));

  if (translateCount > 0) {
    for (let index = 0; index < translateCount; index += 1) {
      const selector = `[data-umt-surface-index="${index + 1}"]`;
      const button = page.locator(selector).first();
      if (await button.count()) await button.click({ timeout: 5_000 }).catch((error) => report.console.push({ type: "qa-click-error", text: `${selector}: ${error.message}` }));
      await page.waitForTimeout(700);
    }
    await waitForTranslationSettled(page, translateCount, timeoutMs);
    report.pageState = await readPageState(page);
    const firstStatuses = report.pageState.buttons.slice(0, translateCount).map((button) => button.status);
    const firstFailed = firstStatuses.filter((status) => status === "failed" || status === "cancelled");
    const firstCompleted = firstStatuses.filter((status) => status === "completed" || status === "cached");
    check("translation-terminal-status", report.pageState.terminalButtons >= Math.min(1, translateCount), `${report.pageState.terminalButtons}/${translateCount} terminal`);
    check("translation-no-failed-buttons", firstFailed.length === 0, JSON.stringify(firstStatuses));
    check("translation-completed-or-cached-target", firstCompleted.length >= translateCount, `${firstCompleted.length}/${translateCount} completed-or-cached`);
    check("translation-rendered-overlay", report.pageState.renderedRegions >= 1 || report.pageState.cachedOrCompletedButtons >= 1, `${report.pageState.renderedRegions} rendered regions, ${report.pageState.cachedOrCompletedButtons} completed/cached buttons`);
    report.diagnostics = await fetchJsonFromNode("http://127.0.0.1:47831/v1/diagnostics/recent?limit=20");
  }

  await page.screenshot({ path: report.screenshot, fullPage: false });
  report.ok = report.checks.every((item) => item.ok);
} finally {
  await writeFile(resolve(outputDir, "extension-qa-report.json"), JSON.stringify(report, null, 2), "utf8");
  await context.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

async function readPageState(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("[data-umt-surface-button]")].map((el) => ({
      text: el.textContent,
      status: el.getAttribute("data-umt-surface-status"),
      index: Number(el.getAttribute("data-umt-surface-index") || "0"),
      rect: rect(el),
    })).sort((a, b) => a.index - b.index || a.rect.y - b.rect.y);
    const terminal = new Set(["completed", "cached", "empty", "failed", "cancelled"]);
    return {
      title: document.title,
      readyState: document.readyState,
      mangaImages: [...document.images].filter((img) => {
        const r = img.getBoundingClientRect();
        const width = r.width >= 1 && r.height >= 1 ? r.width : img.naturalWidth;
        const height = r.width >= 1 && r.height >= 1 ? r.height : img.naturalHeight;
        return width >= 500 && height >= 600 && height / Math.max(1, width) >= 0.7;
      }).length,
      buttons,
      progress: [...document.querySelectorAll("[data-umt-chapter-progress]")].map((el) => el.textContent),
      overlayRoots: document.querySelectorAll("[data-umt-overlay-root]").length,
      renderedRegions: document.querySelectorAll("[data-umt-overlay-root] [data-umt-region-id]").length,
      terminalButtons: buttons.filter((button) => terminal.has(button.status)).length,
      cachedOrCompletedButtons: buttons.filter((button) => button.status === "cached" || button.status === "completed").length,
    };

    function rect(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    }
  });
}

async function fetchJsonFromNode(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForTranslationSettled(page, count, timeout) {
  const start = Date.now();
  const terminal = new Set(["completed", "cached", "empty", "failed", "cancelled"]);
  while (Date.now() - start < timeout) {
    const statuses = await page.evaluate((limit) => [...document.querySelectorAll("[data-umt-surface-button]")]
      .slice(0, limit)
      .map((el) => el.getAttribute("data-umt-surface-status")), count);
    if (statuses.length && statuses.every((status) => terminal.has(status))) return;
    await page.waitForTimeout(1000);
  }
}
