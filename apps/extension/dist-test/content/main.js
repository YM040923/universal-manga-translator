import { BackendClient } from "./client/backend-client";
import { detectImageSurfaces } from "./detector/surface-detector";
import { FloatingPanel } from "./panel/floating-panel";
import { prioritizeSurfaces } from "./scheduler/viewport-scheduler";
const client = new BackendClient();
function viewportRect() {
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}
function scan() {
    const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
    panel.setStatus(`UMT: found ${prioritized.length} manga surfaces`);
}
const panel = new FloatingPanel({
    onTranslateCurrent: scan,
    onRescan: scan,
    onToggleOverlays: () => panel.setStatus("UMT: toggled overlays"),
});
panel.mount();
void client.health().then((ok) => panel.setStatus(ok ? "UMT: backend connected" : "UMT: backend offline"));
//# sourceMappingURL=main.js.map