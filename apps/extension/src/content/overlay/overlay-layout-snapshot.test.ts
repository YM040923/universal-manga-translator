import test from "node:test";
import assert from "node:assert/strict";
import type { SurfaceResult } from "@umt/shared/types";
import type { OverlayAppearance } from "../../settings/settings.js";
import { buildImmutableOverlayLayoutSnapshot, overlayLayoutSnapshotHash } from "./overlay-layout-snapshot.js";

test("immutable overlay layout snapshots use a stable result and settings hash", () => {
  const appearance: OverlayAppearance = {
    maskShape: "auto",
    fontScale: 1,
    maskScale: 1,
    ellipseX: 50,
    ellipseY: 50,
    opacity: 1,
  };
  const result = fixtureResult();
  const reorderedResult: SurfaceResult = {
    elapsedMs: result.elapsedMs,
    layoutVersion: result.layoutVersion,
    providerProfile: result.providerProfile,
    regions: result.regions.map((region) => ({
      style: {
        color: region.style.color,
        background: region.style.background,
        align: region.style.align,
        writingMode: region.style.writingMode,
        fontSize: region.style.fontSize,
      },
      kind: region.kind,
      orientation: region.orientation,
      confidence: region.confidence,
      translatedText: region.translatedText,
      sourceText: region.sourceText,
      box: { height: region.box.height, width: region.box.width, y: region.box.y, x: region.box.x },
      id: region.id,
    })),
    status: result.status,
    imageHash: result.imageHash,
    surfaceId: result.surfaceId,
  };

  const stableHash = overlayLayoutSnapshotHash(result, appearance);
  assert.equal(overlayLayoutSnapshotHash(reorderedResult, appearance), stableHash);
  assert.equal(overlayLayoutSnapshotHash({ ...result, providerProfile: "another-provider", elapsedMs: 999 }, appearance), stableHash);
  assert.notEqual(overlayLayoutSnapshotHash(result, { ...appearance, fontScale: 1.1 }), stableHash);

  const snapshot = buildImmutableOverlayLayoutSnapshot(result, appearance);
  assert.equal(snapshot.hash, stableHash);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.regions), true);
  assert.equal(snapshot.regions[0]?.id, "r1");
});

function fixtureResult(): SurfaceResult {
  return {
    surfaceId: "snapshot-surface",
    imageHash: "snapshot-hash",
    status: "completed",
    providerProfile: "mock",
    layoutVersion: 1,
    elapsedMs: 1,
    regions: [{
      id: "r1",
      box: { x: 100, y: 100, width: 200, height: 100 },
      sourceText: "Hello",
      translatedText: "hello translated",
      confidence: 1,
      orientation: "horizontal",
      kind: "dialogue",
      style: { fontSize: 20, writingMode: "horizontal-tb", align: "center", background: "white", color: "black" },
    }],
  };
}
