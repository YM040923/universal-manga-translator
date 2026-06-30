import { BackendClient } from "./client/backend-client";
import { createSurfaceTask } from "./capture/surface-capture";
import { detectImageSurfaces } from "./detector/surface-detector";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { FloatingPanel } from "./panel/floating-panel";
import { prioritizeSurfaces } from "./scheduler/viewport-scheduler";

const client = new BackendClient();
const renderer = new OverlayRenderer();
let overlaysVisible = true;

function viewportRect() {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

async function translateCurrent(): Promise<void> {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect()).filter((item) => item.priority === "p0" || item.priority === "p1");
  panel.setStatus(`UMT: submitting ${prioritized.length} surfaces`);
  for (const item of prioritized) {
    const response = await client.submit(createSurfaceTask(item.surface, item.priority));
    if (response.ok && response.result) renderer.render(item.surface.element, item.surface.naturalSize, response.result);
  }
  panel.setStatus(`UMT: rendered ${prioritized.length} surfaces`);
}

function scan(): void {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
  panel.setStatus(`UMT: found ${prioritized.length} manga surfaces`);
}

const panel = new FloatingPanel({
  onTranslateCurrent: () => void translateCurrent(),
  onRescan: scan,
  onToggleOverlays: () => {
    overlaysVisible = !overlaysVisible;
    renderer.setVisible(overlaysVisible);
    panel.setStatus(overlaysVisible ? "UMT: overlays visible" : "UMT: overlays hidden");
  },
});

panel.mount();
void client.health().then((ok) => panel.setStatus(ok ? "UMT: backend connected" : "UMT: backend offline"));
