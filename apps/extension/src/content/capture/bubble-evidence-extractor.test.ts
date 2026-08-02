import test from "node:test";
import assert from "node:assert/strict";
import type { GenericOcrRegion } from "@umt/core";
import {
  createBrowserBubbleEvidenceExtractor,
  type BubbleEvidencePixelDecoder,
} from "./bubble-evidence-extractor.js";

test("bubble evidence extractor assigns multiline text inside one white ellipse to one visual group", async () => {
  const fixture = grayscaleFixture(260, 220);
  drawEllipse(fixture, { x: 35, y: 25, width: 190, height: 170 });
  const observations = [
    region("line-1", 92, 72, 78, 20),
    region("line-2", 76, 105, 110, 20),
    region("line-3", 88, 138, 86, 20),
  ];
  drawTextBars(fixture, observations);
  let released = 0;
  const extractor = createBrowserBubbleEvidenceExtractor({
    decoder: decoderFor(fixture, () => { released += 1; }),
  });

  const evidence = await extractor({
    imageBytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
    width: fixture.width,
    height: fixture.height,
    observations,
  });

  assert.equal(evidence.length, 3);
  assert.equal(new Set(evidence.map((item) => item.visualGroupId)).size, 1);
  assert.equal(evidence.every((item) => item.confidence >= 0.72), true);
  assert.equal(evidence.every((item) => item.shape === "ellipse"), true);
  assert.equal(evidence.every((item) => item.touchesBoundary === false), true);
  assert.equal(released, 1);
});

test("bubble evidence extractor keeps two nearby white ellipses in different visual groups", async () => {
  const fixture = grayscaleFixture(360, 180);
  drawEllipse(fixture, { x: 20, y: 25, width: 145, height: 125 });
  drawEllipse(fixture, { x: 195, y: 25, width: 145, height: 125 });
  const observations = [
    region("left", 58, 75, 70, 22),
    region("right", 232, 75, 70, 22),
  ];
  drawTextBars(fixture, observations);
  const extractor = createBrowserBubbleEvidenceExtractor({ decoder: decoderFor(fixture) });

  const evidence = await extractor({
    imageBytes: new Uint8Array([4]),
    mimeType: "image/png",
    width: fixture.width,
    height: fixture.height,
    observations,
  });

  assert.equal(evidence.length, 2);
  assert.notEqual(evidence[0]?.visualGroupId, evidence[1]?.visualGroupId);
  assert.equal(evidence.every((item) => item.confidence >= 0.72), true);
});

test("bubble evidence extractor marks a component touching the tile boundary as low-confidence free text", async () => {
  const fixture = grayscaleFixture(220, 160);
  drawEllipse(fixture, { x: -35, y: 18, width: 150, height: 125 });
  const observations = [region("cut-off", 20, 70, 62, 22)];
  drawTextBars(fixture, observations);
  const extractor = createBrowserBubbleEvidenceExtractor({ decoder: decoderFor(fixture) });

  const evidence = await extractor({
    imageBytes: new Uint8Array([5]),
    mimeType: "image/png",
    width: fixture.width,
    height: fixture.height,
    observations,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.touchesBoundary, true);
  assert.equal((evidence[0]?.confidence ?? 1) < 0.72, true);
  assert.equal(evidence[0]?.shape, "free-text");
  assert.equal(evidence[0]?.visualGroupId, undefined);
});

interface GrayscaleFixture {
  width: number;
  height: number;
  grayscale: Uint8Array;
}

function grayscaleFixture(width: number, height: number): GrayscaleFixture {
  return { width, height, grayscale: new Uint8Array(width * height).fill(255) };
}

function drawEllipse(
  fixture: GrayscaleFixture,
  box: { x: number; y: number; width: number; height: number },
): void {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const outerX = box.width / 2;
  const outerY = box.height / 2;
  const innerX = Math.max(1, outerX - 4);
  const innerY = Math.max(1, outerY - 4);
  for (let y = 0; y < fixture.height; y += 1) {
    for (let x = 0; x < fixture.width; x += 1) {
      const outer = ((x - centerX) ** 2) / (outerX ** 2) + ((y - centerY) ** 2) / (outerY ** 2);
      const inner = ((x - centerX) ** 2) / (innerX ** 2) + ((y - centerY) ** 2) / (innerY ** 2);
      if (outer <= 1 && inner >= 1) fixture.grayscale[y * fixture.width + x] = 0;
    }
  }
}

function drawTextBars(fixture: GrayscaleFixture, observations: GenericOcrRegion[]): void {
  for (const observation of observations) {
    const y = Math.round(observation.box.y + observation.box.height / 2);
    const left = Math.max(0, Math.round(observation.box.x));
    const right = Math.min(fixture.width, Math.round(observation.box.x + observation.box.width));
    for (let row = Math.max(0, y - 2); row <= Math.min(fixture.height - 1, y + 2); row += 1) {
      for (let x = left; x < right; x += 1) fixture.grayscale[row * fixture.width + x] = 0;
    }
  }
}

function decoderFor(
  fixture: GrayscaleFixture,
  release: () => void = () => undefined,
): BubbleEvidencePixelDecoder {
  return async () => ({
    width: fixture.width,
    height: fixture.height,
    grayscale: fixture.grayscale.slice(),
    release,
  });
}

function region(id: string, x: number, y: number, width: number, height: number): GenericOcrRegion {
  return {
    id,
    box: { x, y, width, height },
    sourceText: id,
    confidence: 0.95,
    orientation: "horizontal",
    kind: "dialogue",
  };
}
