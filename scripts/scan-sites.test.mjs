import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, summarizeCandidates } from "./scan-sites.mjs";

test("scoreCandidate gives high score to large vertical manga-like images", () => {
  const candidate = { kind: "image", width: 800, height: 1200, url: "https://example.test/chapter/page-001.jpg" };
  assert.equal(scoreCandidate(candidate) >= 6, true);
});

test("scoreCandidate gives low score to tiny icons", () => {
  const candidate = { kind: "image", width: 32, height: 32, url: "https://example.test/icon.png" };
  assert.equal(scoreCandidate(candidate) < 6, true);
});

test("summarizeCandidates counts likely surfaces by kind", () => {
  const summary = summarizeCandidates([
    { kind: "image", width: 800, height: 1200, url: "/page.jpg" },
    { kind: "background", width: 760, height: 1180, url: "/bg-page.jpg" },
    { kind: "image", width: 32, height: 32, url: "/icon.png" },
  ]);
  assert.deepEqual(summary.byKind, { image: 1, background: 1 });
  assert.equal(summary.likelySurfaceCount, 2);
});
test("scoreCandidate rejects tiny webtoon sprite backgrounds", () => {
  const candidate = { kind: "background", width: 6, height: 10, url: "https://webtoons-static.pstatic.net/image/static/pc/sprite/sp_webtoon.png" };
  assert.equal(scoreCandidate(candidate) < 6, true);
});

test("summarizeCandidates includes capture capability hints", () => {
  const summary = summarizeCandidates([
    { kind: "image", width: 800, height: 1200, url: "https://cdn.example.test/page.jpg" },
    { kind: "canvas", width: 800, height: 1200, url: "" },
    { kind: "background", width: 800, height: 1200, url: "blob:https://reader.example/1" },
  ]);
  assert.deepEqual(summary.captureHints, {
    directImageCandidates: 1,
    screenshotFallbackCandidates: 2,
    canvasCandidates: 1,
    backgroundCandidates: 1,
  });
});
