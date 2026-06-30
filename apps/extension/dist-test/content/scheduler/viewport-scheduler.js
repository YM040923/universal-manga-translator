import { visibleRatio } from "@umt/shared/geometry";
export function prioritizeSurfaces(surfaces, viewport) {
    return surfaces.map((surface) => {
        const ratio = visibleRatio(surface.rect, viewport);
        const distance = surface.rect.y - (viewport.y + viewport.height);
        const priority = ratio > 0.05 ? "p0" : distance >= -viewport.height && distance <= viewport.height * 2 ? "p1" : "p2";
        return { surface, priority };
    });
}
//# sourceMappingURL=viewport-scheduler.js.map