import type { OverlayRegion, SurfaceResult } from "@umt/shared/types";
import type { OverlayAppearance } from "../../settings/settings.js";

export interface ImmutableOverlayLayoutSnapshot {
  readonly hash: string;
  readonly result: ImmutableSurfaceResult;
  readonly regions: readonly Readonly<OverlayRegion>[];
}

type ImmutableSurfaceResult = Readonly<Omit<SurfaceResult, "regions">> & {
  readonly regions: readonly Readonly<OverlayRegion>[];
};

export function overlayLayoutSnapshotHash(result: SurfaceResult, appearance: OverlayAppearance): string {
  return `layout-v1-${fnv1a(stableSerialize({
    result: {
      surfaceId: result.surfaceId,
      imageHash: result.imageHash,
      layoutVersion: result.layoutVersion,
      regions: result.regions,
    },
    appearance,
  }))}`;
}

export function buildImmutableOverlayLayoutSnapshot(result: SurfaceResult, appearance: OverlayAppearance): ImmutableOverlayLayoutSnapshot {
  const regions = Object.freeze(result.regions.map((region) => Object.freeze({
    ...region,
    box: Object.freeze({ ...region.box }),
    style: Object.freeze({ ...region.style }),
  })));
  const immutableResult: ImmutableSurfaceResult = Object.freeze({ ...result, regions });
  return Object.freeze({
    hash: overlayLayoutSnapshotHash(result, appearance),
    result: immutableResult,
    regions,
  });
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
