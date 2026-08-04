import test from "node:test";
import assert from "node:assert/strict";
import { reconstructBubbles } from "../bubble-reconstruction.js";
import { FONT_BUBBLE_FIXTURES } from "./generated-bubbles.js";

test("generated font and bubble fixtures retain their expected ownership and region counts", () => {
  for (const fixture of FONT_BUBBLE_FIXTURES) {
    const bubbles = reconstructBubbles(fixture.observations, fixture.evidence);
    assert.equal(bubbles.length, fixture.expected.bubbleCount, fixture.id);
    assert.deepEqual(bubbles.map((bubble) => bubble.kind), fixture.expected.kinds, fixture.id);
    assert.equal(new Set(bubbles.map((bubble) => bubble.id)).size, bubbles.length, fixture.id);
  }
});
