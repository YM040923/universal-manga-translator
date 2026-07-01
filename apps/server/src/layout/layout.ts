import type { OverlayRegion, TextRegion } from "@umt/shared";

export const LAYOUT_VERSION = 4;

export function layoutRegions(regions: TextRegion[]): OverlayRegion[] {
  return regions.map((region) => ({
    ...region,
    style: {
      fontSize: fontSizeForRegion(region),
      writingMode: region.orientation === "vertical" ? "vertical-rl" : "horizontal-tb",
      align: "center",
      background: "rgba(255,255,255,0.86)",
      color: "#111827",
    },
  }));
}

function fontSizeForRegion(region: TextRegion): number {
  const base = Math.max(14, Math.min(28, Math.floor(region.box.height / 4)));
  const textLength = Array.from(region.translatedText).length;
  const capacity = Math.max(1, Math.floor((region.box.width * region.box.height) / 420));
  if (textLength <= capacity) return base;
  const shrink = Math.ceil((textLength - capacity) / 6);
  return Math.max(11, base - shrink);
}
