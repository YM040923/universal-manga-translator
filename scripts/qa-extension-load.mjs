import { chromium } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const DEFAULT_URL = "https://asurascans.com/comics/the-heavenly-demon-wants-a-quiet-life-30e93729/chapter/60";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

if (args.has("help") || args.has("h")) {
  printHelp();
  process.exit(0);
}

const url = args.get("url") || DEFAULT_URL;
const runMode = args.get("run-mode") === "backend" ? "backend" : "direct";
const qaDomain = primaryDomainFromUrl(url);
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
  qaDomain,
  runMode,
  translateCount,
  extensionDir,
  checks: [],
  serviceWorkers: [],
  console: [],
  pageState: null,
  backend: null,
  diagnostics: null,
  runtimeLogs: [],
  screenshot: resolve(outputDir, "extension-qa.png"),
};

const env = readDotEnv(resolve(projectRoot, ".env"));

function check(name, ok, detail = "") {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return ok;
}

try {
  await context.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => null);
  report.serviceWorkers = context.serviceWorkers().map((worker) => worker.url());
  check("extension-service-worker", report.serviceWorkers.some((item) => item.startsWith("chrome-extension://")), report.serviceWorkers.join(", "));
  const worker = context.serviceWorkers()[0];
  if (worker) {
    const ocrKeys = splitKeys(env.OCR_API_KEYS || env.OCR_API_KEY);
    await worker.evaluate(async ({ domain, mode }) => {
      await chrome.storage.sync.set({ enabledSites: domain ? { [domain]: true } : {}, runMode: mode });
    }, { domain: qaDomain, mode: runMode });
    if (args.get("configure-direct") === "true") {
      await worker.evaluate(async (config) => {
        await chrome.storage.sync.set(config);
      }, {
        runMode,
        directOcr: {
          apiUrl: env.OCR_API_URL || "",
          apiKeys: ocrKeys,
          inputMode: env.OCR_INPUT_MODE || "image_base64",
          imageField: env.OCR_IMAGE_FIELD || "image_base64",
          staticFieldsText: env.OCR_STATIC_FIELDS_JSON || "{}",
          regionsPaths: splitList(env.OCR_REGIONS_PATHS || "words_result,data.words_result,data.result,data.regions,result,regions"),
          textPaths: splitList(env.OCR_TEXT_PATHS || "words,text,content"),
          boxPaths: splitList(env.OCR_BOX_PATHS || "location,box,bbox,vertexes_location"),
          confidencePaths: splitList(env.OCR_CONFIDENCE_PATHS || "score,confidence"),
        },
        directTranslator: {
          baseUrl: env.OPENAI_BASE_URL || "",
          apiKey: env.OPENAI_API_KEY || "",
          model: env.OPENAI_MODEL || "gpt-4.1-mini",
        },
      });
    }
  }

  const page = await context.newPage();
  page.on("console", (msg) => report.console.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => report.console.push({ type: "pageerror", text: String(err.stack || err) }));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(8_000);

  report.pageState = await readPageState(page);
  check("content-script-injected", report.pageState.overlayRoots >= 1 || report.pageState.progress.length >= 1, JSON.stringify({ overlayRoots: report.pageState.overlayRoots, progress: report.pageState.progress.length }));
  check("manga-images-detected", report.pageState.mangaImages >= 5, `${report.pageState.mangaImages} manga-like images`);
  check("surface-buttons-mounted", report.pageState.buttons.length >= Math.min(5, Math.max(1, report.pageState.mangaImages)), `${report.pageState.buttons.length} buttons`);
  check("progress-mounted", report.pageState.progress.length >= 1, `${report.pageState.progress.length} progress panels`);
  if (runMode === "backend") {
    report.backend = await fetchJsonFromNode("http://127.0.0.1:47831/health");
    check("backend-reachable", Boolean(report.backend?.ok), JSON.stringify(report.backend));
  }

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
    if (runMode === "backend") report.diagnostics = await fetchJsonFromNode("http://127.0.0.1:47831/v1/diagnostics/recent?limit=20");
    if (worker) report.runtimeLogs = await readRuntimeLogs(worker);
  }

  if (worker && !report.runtimeLogs.length) report.runtimeLogs = await readRuntimeLogs(worker);
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
      title: el.getAttribute("title"),
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


async function readRuntimeLogs(worker) {
  try {
    return await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("runtimeLogs");
      const logs = Array.isArray(stored.runtimeLogs) ? stored.runtimeLogs : [];
      return logs.slice(-30).map((entry) => ({
        ...entry,
        detail: sanitizeLogText(entry?.detail),
        message: sanitizeLogText(entry?.message),
      }));

      function sanitizeLogText(value) {
        return String(value ?? "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
      }
    });
  } catch (error) {
    return [{ level: "error", source: "qa", message: "read runtime logs failed", detail: error instanceof Error ? error.message : String(error) }];
  }
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

function readDotEnv(path) {
  try {
    return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return [];
      const index = trimmed.indexOf("=");
      if (index < 0) return [];
      return [[trimmed.slice(0, index), trimmed.slice(index + 1)]];
    }));
  } catch {
    return {};
  }
}

function splitList(value) {
  return String(value || "").split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean);
}

function splitKeys(value) {
  return splitList(value);
}

function primaryDomainFromUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return host;
    const secondLevel = parts.at(-2) ?? "";
    const knownSecondLevel = new Set(["co", "com", "net", "org", "ac", "gov"]);
    if (knownSecondLevel.has(secondLevel) && (parts.at(-1)?.length ?? 0) === 2) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

function printHelp() {
  console.log(`Universal Manga Translator extension QA

Usage:
  pnpm qa:extension -- [options]

Default mode:
  Builds and loads the pure Chrome extension, enables the domain from --url,
  then verifies the page controls mount without requiring the desktop/backend.

Options:
  --url=<chapter-url>          Manga chapter URL to open.
                              Default: ${DEFAULT_URL}
  --translate=<0-10>           Click the first N image translation buttons and wait.
                              Default: 0
  --configure-direct=true      Preload direct OCR/translator config from .env.
                              Reads OCR_API_URL, OCR_API_KEYS/OCR_API_KEY,
                              OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL.
  --run-mode=backend           Advanced mode: require local backend health too.
                              Default: direct
  --timeout=<ms>               Translation wait timeout. Default: 180000
  --help, -h                   Show this help and do not launch Chrome.

Examples:
  pnpm qa:extension -- --url=https://example.com/chapter/1
  pnpm qa:extension -- --configure-direct=true --translate=2
  pnpm qa:extension -- --run-mode=backend

Output:
  qa-output/extension-qa-report.json
  qa-output/extension-qa.png
`);
}
