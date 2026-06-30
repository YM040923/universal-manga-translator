import type { Rect, Size } from "./types.js";
export declare function mapNaturalBoxToRenderedBox(box: Rect, naturalSize: Size, renderedRect: Rect): Rect;
export declare function intersectRect(a: Rect, b: Rect): Rect | null;
export declare function area(rect: Rect): number;
export declare function visibleRatio(subject: Rect, viewport: Rect): number;
