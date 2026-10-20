import test from "node:test";
import assert from "node:assert/strict";
import { renderableSurfaceResult, sanitizeSurfaceResult } from "./translation-result.js";
import type { OverlayRegion, SurfaceResult } from "@umt/shared/types";

test("renderableSurfaceResult rejects empty results so screenshot fallback can run", () => {
  assert.equal(renderableSurfaceResult(undefined), undefined);
  assert.equal(renderableSurfaceResult({
    surfaceId: "s1",
    imageHash: "hash",
    status: "empty",
    regions: [],
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
  }), undefined);
});

test("renderableSurfaceResult accepts completed results with overlay regions", () => {
  const result = renderableSurfaceResult({
    surfaceId: "s1",
    imageHash: "hash",
    status: "completed",
    providerProfile: "test",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 1, y: 2, width: 30, height: 40 },
      sourceText: "hi",
      translatedText: "你好",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 14, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  });
  assert.equal(result?.regions.length, 1);
});

test("renderableSurfaceResult rejects results whose regions are all unusable", () => {
  assert.equal(renderableSurfaceResult(baseResult([hostileRegion({ box: { x: 1, y: 2, width: 0, height: 10 } })])), undefined);
});

test("sanitizeSurfaceResult keeps only whitelisted CSS tokens so cssText cannot be escaped", () => {
  const sanitized = sanitizeSurfaceResult(baseResult([
    hostileRegion({
      style: {
        fontSize: 999,
        writingMode: 'horizontal-tb; position: fixed; inset: 0} body { display:none',
        align: 'center; background: url("https://evil.test/x.png")',
        background: 'rgba(0,0,0,0.9); outline: 3px solid red',
        color: "evilsink\"{}",
      },
    }),
  ]))!;
  const style = (sanitized.regions[0] as OverlayRegion).style;

  assert.equal(style.writingMode, "horizontal-tb");
  assert.equal(style.align, "center");
  assert.equal(style.background, "rgba(255,255,255,0.86)");
  assert.equal(style.color, "#111827");
  assert.equal(style.fontSize, 200);
});

test("sanitizeSurfaceResult passes through valid styles", () => {
  const style = { fontSize: 24, writingMode: "vertical-rl" as const, align: "right" as const, background: "rgba(0, 0, 0, 0.5)", color: "#fff" };
  const sanitized = sanitizeSurfaceResult(baseResult([hostileRegion({ style })]))!;

  assert.deepEqual((sanitized.regions[0] as OverlayRegion).style, style);
});

test("sanitizeSurfaceResult drops regions with missing or non-finite geometry", () => {
  const sanitized = sanitizeSurfaceResult(baseResult([
    hostileRegion({ id: "ok", box: { x: 10, y: 20, width: 30, height: 40 } }),
    hostileRegion({ id: "nan", box: { x: Number.NaN, y: 0, width: 30, height: 40 } }),
    hostileRegion({ id: "negative-area", box: { x: 0, y: 0, width: -30, height: 40 } }),
    hostileRegion({ id: "no-box", box: undefined }),
    hostileRegion({ id: "string-box", box: "10,20,30,40" }),
  ]))!;

  assert.deepEqual(sanitized.regions.map((region) => region.id), ["ok"]);
});

test("sanitizeSurfaceResult clamps oversized coordinates and truncates unbounded text", () => {
  const sanitized = sanitizeSurfaceResult(baseResult([
    hostileRegion({
      box: { x: -9e15, y: 1e9, width: 1e12, height: 40 },
      sourceText: "x".repeat(20_000),
      translatedText: "y".repeat(20_000),
      confidence: Number.POSITIVE_INFINITY,
    }),
  ]))!;
  const region = sanitized.regions[0] as OverlayRegion;

  assert.deepEqual(region.box, { x: -1_000_000, y: 1_000_000, width: 1_000_000, height: 40 });
  assert.equal(region.sourceText.length, 4000);
  assert.equal(region.translatedText.length, 4000);
  assert.equal(region.confidence, 1);
});

test("sanitizeSurfaceResult bounds the region count and identifier fields", () => {
  const sanitized = sanitizeSurfaceResult(baseResult(
    Array.from({ length: 1200 }, (_unused, index) => hostileRegion({ id: `r${index}` })),
    { surfaceId: "s".repeat(5000), imageHash: "h".repeat(5000), providerProfile: "p".repeat(5000) },
  ))!;

  assert.equal(sanitized.regions.length, 500);
  assert.equal(sanitized.surfaceId.length, 200);
  assert.equal(sanitized.imageHash.length, 200);
  assert.equal(sanitized.providerProfile.length, 200);
});

test("sanitizeSurfaceResult rejects payloads that are not results at all", () => {
  assert.equal(sanitizeSurfaceResult(undefined), undefined);
  assert.equal(sanitizeSurfaceResult(null as unknown as SurfaceResult), undefined);
  assert.equal(sanitizeSurfaceResult("runnable string" as unknown as SurfaceResult), undefined);
  assert.equal(sanitizeSurfaceResult({ ...baseResult([]), status: "failed" as SurfaceResult["status"] }), undefined);
  assert.equal(sanitizeSurfaceResult({ ...baseResult([]), regions: "not an array" } as unknown as SurfaceResult), undefined);
});

function baseResult(regions: unknown, extra: Partial<SurfaceResult> = {}): SurfaceResult {
  return {
    surfaceId: "s1",
    imageHash: "hash",
    status: "completed",
    providerProfile: "test",
    layoutVersion: 4,
    elapsedMs: 1,
    regions: regions as SurfaceResult["regions"],
    ...extra,
  };
}

function hostileRegion(overrides: Record<string, unknown>): unknown {
  return {
    id: "r1",
    box: { x: 1, y: 2, width: 30, height: 40 },
    sourceText: "hi",
    translatedText: "你好",
    confidence: 1,
    orientation: "horizontal",
    kind: "dialogue",
    style: { fontSize: 14, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    ...overrides,
  };
}
