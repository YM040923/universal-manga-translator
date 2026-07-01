import type { SurfaceResult } from "@umt/shared/types";

export function isRenderableSurfaceResult(result: SurfaceResult | undefined): result is SurfaceResult {
  return Boolean(result && result.status !== "empty" && result.regions.length > 0);
}
