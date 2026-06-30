import type { OverlayRegion, TextRegion } from "@umt/shared";

export const LAYOUT_VERSION = 1;

export function layoutRegions(regions: TextRegion[]): OverlayRegion[] {
  return regions.map((region) => ({
    ...region,
    style: {
      fontSize: Math.max(14, Math.min(28, Math.floor(region.box.height / 4))),
      writingMode: "horizontal-tb",
      align: "center",
      background: "rgba(255,255,255,0.86)",
      color: "#111827",
    },
  }));
}

