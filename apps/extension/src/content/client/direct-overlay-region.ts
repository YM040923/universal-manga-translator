import type { OverlayRegion, TextRegion } from "@umt/shared/types";

export function toOverlayRegion(region: TextRegion): OverlayRegion {
  return {
    ...region,
    style: {
      fontSize: Math.max(14, Math.min(28, Math.round(region.box.height * 0.52))),
      writingMode: region.orientation === "vertical" ? "vertical-rl" : "horizontal-tb",
      align: "center",
      background: "rgba(255,255,255,0.96)",
      color: "#111",
    },
  };
}
