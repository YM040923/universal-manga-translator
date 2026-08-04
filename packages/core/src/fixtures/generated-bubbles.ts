import type { OcrObservation, Rect } from "@umt/shared";
import type { BubbleOwnershipEvidence } from "../bubble-reconstruction.js";

export interface GeneratedBubbleFixture {
  id: "latin-serif-dialogue" | "display-adjacent-dialogue" | "narration-panel" | "vertical-dialogue";
  observations: readonly OcrObservation[];
  evidence: readonly BubbleOwnershipEvidence[];
  expected: {
    bubbleCount: number;
    kinds: readonly ("dialogue" | "narration" | "sfx" | "unknown")[];
  };
}

export const FONT_BUBBLE_FIXTURES: readonly GeneratedBubbleFixture[] = [
  {
    id: "latin-serif-dialogue",
    observations: [
      observation("serif-1", "I knew", { x: 118, y: 84, width: 104, height: 28 }),
      observation("serif-2", "you would", { x: 100, y: 120, width: 140, height: 28 }),
      observation("serif-3", "come back", { x: 108, y: 156, width: 126, height: 28 }),
    ],
    evidence: [
      evidence("serif-1", "serif-dialogue", { x: 64, y: 42, width: 218, height: 182 }, "ellipse"),
      evidence("serif-2", "serif-dialogue", { x: 64, y: 42, width: 218, height: 182 }, "ellipse"),
      evidence("serif-3", "serif-dialogue", { x: 64, y: 42, width: 218, height: 182 }, "ellipse"),
    ],
    expected: { bubbleCount: 1, kinds: ["dialogue"] },
  },
  {
    id: "display-adjacent-dialogue",
    observations: [
      observation("display-left", "WAIT!", { x: 54, y: 94, width: 116, height: 34 }),
      observation("display-right", "RUN!", { x: 220, y: 98, width: 98, height: 34 }),
    ],
    evidence: [
      evidence("display-left", "display-left", { x: 28, y: 56, width: 164, height: 112 }, "ellipse"),
      evidence("display-right", "display-right", { x: 202, y: 56, width: 142, height: 112 }, "ellipse"),
    ],
    expected: { bubbleCount: 2, kinds: ["dialogue", "dialogue"] },
  },
  {
    id: "narration-panel",
    observations: [observation("caption", "Meanwhile, above the city…", { x: 36, y: 36, width: 266, height: 28 }, "horizontal", "narration")],
    evidence: [evidence("caption", "caption-panel", { x: 20, y: 18, width: 300, height: 66 }, "rect")],
    expected: { bubbleCount: 1, kinds: ["narration"] },
  },
  {
    id: "vertical-dialogue",
    observations: [
      observation("vertical-right", "右列", { x: 176, y: 70, width: 26, height: 124 }, "vertical"),
      observation("vertical-left", "左列", { x: 142, y: 72, width: 26, height: 122 }, "vertical"),
      observation("vertical-other", "旁白", { x: 70, y: 74, width: 26, height: 118 }, "vertical"),
    ],
    evidence: [
      evidence("vertical-right", "vertical-dialogue", { x: 126, y: 40, width: 96, height: 184 }, "ellipse"),
      evidence("vertical-left", "vertical-dialogue", { x: 126, y: 40, width: 96, height: 184 }, "ellipse"),
      evidence("vertical-other", "vertical-other", { x: 52, y: 42, width: 64, height: 180 }, "ellipse"),
    ],
    expected: { bubbleCount: 2, kinds: ["dialogue", "dialogue"] },
  },
];

function observation(
  id: string,
  sourceText: string,
  box: Rect,
  orientation: OcrObservation["orientation"] = "horizontal",
  kind: OcrObservation["kind"] = "dialogue",
): OcrObservation {
  return { id, unitId: "font-fixture", sourceText, box, confidence: 0.95, orientation, kind, variant: "original", suspicious: false };
}

function evidence(
  observationId: string,
  visualGroupId: string,
  componentBox: Rect,
  shape: NonNullable<BubbleOwnershipEvidence["shape"]>,
): BubbleOwnershipEvidence {
  return { observationId, visualGroupId, componentBox, shape, confidence: 0.96, touchesBoundary: false };
}
