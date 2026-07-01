import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

export function scoreCandidate(candidate) {
  let score = 0;
  const width = Number(candidate.width) || 0;
  const height = Number(candidate.height) || 0;
  const url = String(candidate.url || "");
  if (width >= 300 && height >= 300) score += 4;
  if (height / Math.max(width, 1) >= 1.1) score += 3;
  if (width >= 600) score += 1;
  if (/manga|comic|chapter|page|webtoon|reader/i.test(url)) score += 2;
  if (candidate.kind === "canvas" || candidate.kind === "background") score += 1;
  return score;
}

export function summarizeCandidates(candidates) {
  const likely = candidates.filter((candidate) => scoreCandidate(candidate) >= 6);
  const byKind = {};
  for (const candidate of likely) byKind[candidate.kind] = (byKind[candidate.kind] || 0) + 1;
  return { candidateCount: candidates.length, likelySurfaceCount: likely.length, byKind, likely };
}

export async function scanUrl(url, options = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 30000 });
    await page.waitForTimeout(options.waitMs ?? 1500);
    const candidates = await page.evaluate(() => {
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) };
      };
      const out = [];
      document.querySelectorAll("img").forEach((img, index) => out.push({ kind: "image", index, url: img.currentSrc || img.src || "", ...rectOf(img) }));
      document.querySelectorAll("canvas").forEach((canvas, index) => out.push({ kind: "canvas", index, url: "", ...rectOf(canvas) }));
      document.querySelectorAll("body *").forEach((element, index) => {
        const bg = getComputedStyle(element).backgroundImage;
        if (bg && bg !== "none") out.push({ kind: "background", index, url: bg, ...rectOf(element) });
      });
      return out;
    });
    return { url, ...summarizeCandidates(candidates) };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("scan-sites.mjs")) {
  const urls = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  if (!urls.length) {
    console.error("Usage: pnpm scan:sites <url...> [--out=docs/compat/report.json]");
    process.exit(2);
  }
  const reports = [];
  for (const url of urls) reports.push(await scanUrl(url));
  const payload = { generatedAt: new Date().toISOString(), reports };
  if (outArg) {
    const outPath = resolve(outArg.slice("--out=".length));
    mkdirSync(resolve(outPath, ".."), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }
  console.log(JSON.stringify(payload, null, 2));
}