import { BackendClient, SurfaceSubmitTracker } from "./client/backend-client";
import { createSurfaceTask } from "./capture/surface-capture";
import { detectImageSurfaces } from "./detector/surface-detector";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { FloatingPanel } from "./panel/floating-panel";
import { prioritizeSurfaces } from "./scheduler/viewport-scheduler";

const client = new BackendClient();
const renderer = new OverlayRenderer();
const submitTracker = new SurfaceSubmitTracker();
let overlaysVisible = true;
let queued = 0;
let processing = 0;
let completed = 0;

function setCountersStatus(): void {
  panel.setStatus(`UMT: queued ${queued} | processing ${processing} | done ${completed}`);
}

function viewportRect() {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

async function translateCurrent(): Promise<void> {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect()).filter((item) => item.priority === "p0" || item.priority === "p1");
  const fresh = prioritized.filter((item) => submitTracker.shouldSubmit(item.surface.surfaceId));
  panel.setStatus(`UMT: submitting ${fresh.length} new surfaces`);
  for (const item of fresh) {
    submitTracker.markSubmitted(item.surface.surfaceId);
    const response = await client.submit(createSurfaceTask(item.surface, item.priority));
    if (response.ok && response.result) renderer.render(item.surface.element, item.surface.naturalSize, response.result);
  }
}

function scan(): void {
  const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
  panel.setStatus(`UMT: found ${prioritized.length} manga surfaces`);
}

const panel = new FloatingPanel({
  onTranslateCurrent: () => void translateCurrent(),
  onRescan: () => {
    submitTracker.clear();
    scan();
  },
  onToggleOverlays: () => {
    overlaysVisible = !overlaysVisible;
    renderer.setVisible(overlaysVisible);
    panel.setStatus(overlaysVisible ? "UMT: overlays visible" : "UMT: overlays hidden");
  },
});

panel.mount();
try {
  client.connectEvents((event) => {
    if (event.type === "job.queued") queued += 1;
    if (event.type === "job.processing") processing += 1;
    if (event.type === "job.completed" || event.type === "job.cached") completed += 1;
    setCountersStatus();
  });
} catch {
  panel.setStatus("UMT: event stream unavailable");
}
void client.health().then((ok) => panel.setStatus(ok ? "UMT: backend connected" : "UMT: backend offline"));
