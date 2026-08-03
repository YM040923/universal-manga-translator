import test from "node:test";
import assert from "node:assert/strict";
import type { OcrObservation } from "@umt/shared";
import type { GenericOcrRegion } from "./generic-ocr.js";
import {
  reconstructBubbles,
  type BubbleOwnershipEvidence,
} from "./bubble-reconstruction.js";

test("reconstructBubbles merges three OCR lines owned by one high-confidence ellipse", () => {
  const observations = [
    region("line-1", "I knew", 120, 90, 90, 24),
    region("line-2", "you would", 105, 122, 120, 24),
    region("line-3", "come back", 112, 154, 108, 24),
  ];
  const evidence = observations.map((observation) => visualEvidence(
    observation.id,
    "ellipse-1",
    { x: 72, y: 48, width: 190, height: 180 },
    "ellipse",
  ));

  const bubbles = reconstructBubbles(observations, evidence);

  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0]?.sourceText, "I knew\nyou would\ncome back");
  assert.deepEqual(bubbles[0]?.observationIds, ["line-1", "line-2", "line-3"]);
  assert.deepEqual(bubbles[0]?.box, { x: 72, y: 48, width: 190, height: 180 });
  assert.equal(bubbles[0]?.shape, "ellipse");
  assert.equal(bubbles[0]?.evidence.ownership, "visual");
});

test("reconstructBubbles keeps adjacent dialogue bubbles with different visual groups separate", () => {
  const observations = [
    region("left", "LEFT", 90, 90, 80, 26),
    region("right", "RIGHT", 176, 92, 84, 26),
  ];

  const bubbles = reconstructBubbles(observations, [
    visualEvidence("left", "bubble-left", { x: 60, y: 55, width: 125, height: 100 }, "ellipse"),
    visualEvidence("right", "bubble-right", { x: 165, y: 55, width: 125, height: 100 }, "ellipse"),
  ]);

  assert.equal(bubbles.length, 2);
  assert.deepEqual(bubbles.map((bubble) => bubble.observationIds), [["left"], ["right"]]);
});

test("reconstructBubbles never merges overlapping components with different visual groups", () => {
  const observations = [
    region("upper", "UPPER", 120, 100, 110, 30),
    region("lower", "LOWER", 128, 126, 110, 30),
  ];

  const bubbles = reconstructBubbles(observations, [
    visualEvidence("upper", "overlap-a", { x: 70, y: 50, width: 210, height: 130 }, "ellipse"),
    visualEvidence("lower", "overlap-b", { x: 90, y: 105, width: 210, height: 130 }, "ellipse"),
  ]);

  assert.equal(bubbles.length, 2);
});

test("reconstructBubbles does not dedupe identical overlapping text owned by different high-confidence visual groups", () => {
  const observations = [
    region("group-a-text", "SAME", 100, 100, 100, 40),
    region("group-b-text", "SAME", 101, 100, 100, 40),
  ];

  const bubbles = reconstructBubbles(observations, [
    visualEvidence("group-a-text", "group-a", { x: 70, y: 70, width: 160, height: 100 }, "ellipse"),
    visualEvidence("group-b-text", "group-b", { x: 71, y: 70, width: 160, height: 100 }, "ellipse"),
  ]);

  assert.equal(bubbles.length, 2);
  assert.deepEqual(bubbles.map((bubble) => bubble.evidence.groupId).sort(), ["group-a", "group-b"]);
});

test("reconstructBubbles gives distinct ids to quantized-identical boxes with different canonical visual groups", () => {
  const observations = [
    region("group-c-text", "SAME", 100, 100, 100, 40),
    region("group-d-text", "SAME", 101, 100, 100, 40),
  ];

  const bubbles = reconstructBubbles(observations, [
    visualEvidence("group-c-text", "group-c", { x: 50, y: 30, width: 180, height: 100 }, "ellipse"),
    visualEvidence("group-d-text", "group-d", { x: 51, y: 30, width: 180, height: 100 }, "ellipse"),
  ]);

  assert.equal(bubbles.length, 2);
  assert.equal(new Set(bubbles.map((bubble) => bubble.id)).size, 2);
});

test("reconstructBubbles preserves a rectangular narration component", () => {
  const observation = region("caption", "Meanwhile...", 40, 30, 180, 28, "horizontal", "narration");

  const bubbles = reconstructBubbles([observation], [
    visualEvidence("caption", "caption-box", { x: 24, y: 16, width: 215, height: 62 }, "rect"),
  ]);

  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0]?.kind, "narration");
  assert.equal(bubbles[0]?.shape, "rect");
  assert.deepEqual(bubbles[0]?.box, { x: 24, y: 16, width: 215, height: 62 });
});

test("reconstructBubbles does not merge SFX beside dialogue", () => {
  const dialogue = region("dialogue", "Watch out!", 90, 100, 130, 30);
  const sfx = region("sfx", "BAM", 225, 92, 70, 70, "horizontal", "sfx");

  const bubbles = reconstructBubbles([dialogue, sfx]);

  assert.equal(bubbles.length, 2);
  assert.deepEqual(bubbles.map((bubble) => bubble.kind), ["dialogue", "sfx"]);
});

test("reconstructBubbles does not merge free text into a nearby visually owned dialogue bubble", () => {
  const freeText = region("free-text", "aside", 40, 90, 80, 24);
  const dialogue = region("dialogue", "hello", 126, 90, 80, 24);

  const bubbles = reconstructBubbles([freeText, dialogue], [
    {
      observationId: "free-text",
      shape: "free-text",
      confidence: 0.3,
      touchesBoundary: true,
    },
    visualEvidence("dialogue", "dialogue-bubble", { x: 116, y: 60, width: 110, height: 80 }, "ellipse"),
  ]);

  assert.equal(bubbles.length, 2);
  assert.deepEqual(
    bubbles.flatMap((bubble) => bubble.observationIds).sort(),
    ["dialogue", "free-text"],
  );
});

test("reconstructBubbles uses an independent conservative rule for vertical columns", () => {
  const observations = [
    region("right-column", "右", 160, 80, 24, 120, "vertical"),
    region("left-column", "左", 128, 82, 24, 118, "vertical"),
    region("other-bubble", "別", 82, 86, 24, 112, "vertical"),
  ];

  const bubbles = reconstructBubbles(observations, [
    visualEvidence("right-column", "vertical-1", { x: 112, y: 48, width: 92, height: 190 }, "ellipse"),
    visualEvidence("left-column", "vertical-1", { x: 112, y: 48, width: 92, height: 190 }, "ellipse"),
    visualEvidence("other-bubble", "vertical-2", { x: 54, y: 54, width: 62, height: 180 }, "ellipse"),
  ]);

  assert.equal(bubbles.length, 2);
  assert.equal(bubbles[0]?.sourceText, "右\n左");
  assert.deepEqual(bubbles[0]?.observationIds, ["right-column", "left-column"]);
});

test("reconstructBubbles never geometrically merges vertical text without visual ownership", () => {
  const observations = [
    region("vertical-a", "A", 160, 80, 24, 120, "vertical"),
    region("vertical-b", "B", 132, 82, 24, 118, "vertical"),
  ];

  const bubbles = reconstructBubbles(observations);

  assert.equal(bubbles.length, 2);
});

test("reconstructBubbles leaves borderless nearby text separate without strong fallback geometry", () => {
  const observations = [
    region("borderless-a", "First", 40, 50, 130, 28),
    region("borderless-b", "Second", 112, 91, 130, 28),
  ];

  const bubbles = reconstructBubbles(observations);

  assert.equal(bubbles.length, 2);
  assert.deepEqual(bubbles.map((bubble) => bubble.shape), ["free-text", "free-text"]);
});

test("reconstructBubbles derives the same deterministic id when OCR observation ids change", () => {
  const first = reconstructBubbles([
    region("provider-a-1", "Same words", 80, 60, 120, 28),
  ], [
    visualEvidence("provider-a-1", "canonical-same", { x: 50, y: 30, width: 180, height: 100 }, "ellipse"),
  ]);
  const second = reconstructBubbles([
    region("provider-b-99", " Same   words ", 80, 60, 120, 28),
  ], [
    visualEvidence("provider-b-99", "canonical-same", { x: 51, y: 31, width: 179, height: 101 }, "ellipse"),
  ]);

  assert.equal(first[0]?.id, second[0]?.id);
  assert.match(first[0]?.id ?? "", /^bubble-[a-f0-9]{8}$/);
});

test("reconstructBubbles accepts shared OcrObservation inputs and manual ownership wins over visual ownership", () => {
  const observations: OcrObservation[] = [
    observation("manual-1", "One", 20, 20),
    observation("manual-2", "Two", 220, 220),
  ];

  const bubbles = reconstructBubbles(observations, [
    {
      observationId: "manual-1",
      manualGroupId: "manual-selection-1",
      visualGroupId: "visual-a",
      componentBox: { x: 10, y: 10, width: 80, height: 50 },
      shape: "ellipse",
      confidence: 0.95,
      touchesBoundary: false,
    },
    {
      observationId: "manual-2",
      manualGroupId: "manual-selection-1",
      visualGroupId: "visual-b",
      componentBox: { x: 200, y: 200, width: 80, height: 50 },
      shape: "ellipse",
      confidence: 0.95,
      touchesBoundary: false,
    },
  ]);

  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0]?.evidence.ownership, "manual");
});

function region(
  id: string,
  sourceText: string,
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: GenericOcrRegion["orientation"] = "horizontal",
  kind: GenericOcrRegion["kind"] = "dialogue",
): GenericOcrRegion {
  return { id, sourceText, box: { x, y, width, height }, confidence: 0.92, orientation, kind };
}

function observation(id: string, sourceText: string, x: number, y: number): OcrObservation {
  return {
    id,
    unitId: "manual-unit",
    sourceText,
    box: { x, y, width: 70, height: 24 },
    confidence: 0.9,
    orientation: "horizontal",
    kind: "dialogue",
    variant: "original",
    suspicious: false,
  };
}

function visualEvidence(
  observationId: string,
  visualGroupId: string,
  componentBox: NonNullable<BubbleOwnershipEvidence["componentBox"]>,
  shape: NonNullable<BubbleOwnershipEvidence["shape"]>,
): BubbleOwnershipEvidence {
  return {
    observationId,
    visualGroupId,
    componentBox,
    shape,
    confidence: 0.94,
    touchesBoundary: false,
  };
}
