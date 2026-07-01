import { BackendClient, SurfaceSubmitTracker } from "./client/backend-client";
import { createSurfaceTask } from "./capture/surface-capture";
import { detectImageSurfaces } from "./detector/surface-detector";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { FloatingPanel } from "./panel/floating-panel";
import { AutoScheduler } from "./scheduler/auto-scheduler";
import { prioritizeSurfaces } from "./scheduler/viewport-scheduler";
import { TranslationStatusCounter } from "./status/job-status-counter";
import { loadSettings, type ExtensionSettings } from "../settings/settings";

void bootstrap();

async function bootstrap(): Promise<void> {
  const settings = await loadSettings();
  const client = new BackendClient(settings.backendUrl);
  const renderer = new OverlayRenderer({ targetLanguage: settings.targetLanguage, onManualEdit: (override) => void client.saveManualOverride(override) });
  const submitTracker = new SurfaceSubmitTracker();
  const statusCounter = new TranslationStatusCounter();
  let overlaysVisible = true;

  function setCountersStatus(): void {
    panel.setStatus(statusCounter.format());
  }

  function viewportRect() {
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  }

  async function translateVisibleAndNearby(): Promise<void> {
    const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect()).filter((item) => item.priority === "p0" || item.priority === "p1");
    const fresh = prioritized.filter((item) => submitTracker.shouldSubmit(item.surface.surfaceId));
    if (!fresh.length) return;
    panel.setStatus(`UMT: submitting ${fresh.length} new surfaces`);
    for (const item of fresh) {
      submitTracker.markSubmitted(item.surface.surfaceId);
      try {
        const response = await client.submit(createSurfaceTask(item.surface, item.priority, settings.targetLanguage));
        if (response.ok && response.result) {
          renderer.render(item.surface.element, item.surface.naturalSize, response.result);
        } else {
          statusCounter.recordFailedResponse(item.surface.surfaceId);
          setCountersStatus();
        }
      } catch {
        statusCounter.recordFailedResponse(item.surface.surfaceId);
        setCountersStatus();
      }
    }
  }

  function scan(): void {
    const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
    panel.setStatus(`UMT: found ${prioritized.length} manga surfaces`);
  }

  const autoScheduler = new AutoScheduler(() => translateVisibleAndNearby(), 350);

  const panel = new FloatingPanel({
    onTranslateCurrent: () => void translateVisibleAndNearby(),
    onRescan: () => {
      submitTracker.clear();
      scan();
      autoScheduler.requestRun("rescan");
    },
    onTogglePause: () => {
      if (autoScheduler.isPaused()) {
        autoScheduler.resume();
        panel.setStatus("UMT: resumed");
        autoScheduler.requestRun("resume");
      } else {
        autoScheduler.pause();
        panel.setStatus("UMT: paused");
      }
    },
    onToggleOverlays: () => {
      overlaysVisible = !overlaysVisible;
      renderer.setVisible(overlaysVisible);
      panel.setStatus(overlaysVisible ? "UMT: overlays visible" : "UMT: overlays hidden");
    },
    onOpenSettings: () => chrome.runtime?.openOptionsPage?.(),
  });

  panel.mount();
  try {
    client.connectEvents((event) => {
      statusCounter.recordEvent(event);
      setCountersStatus();
    });
  } catch {
    panel.setStatus("UMT: event stream unavailable");
  }
  void client.health().then((ok) => {
    panel.setStatus(ok ? settingsStatus(settings) : "UMT: backend offline");
    if (ok && settings.autoTranslate) autoScheduler.requestRun("load");
  });
  window.addEventListener("scroll", () => {
    renderer.refreshAll();
    if (settings.autoTranslate) autoScheduler.requestRun("scroll");
  }, { passive: true });
  window.addEventListener("resize", () => {
    renderer.refreshAll();
    if (settings.autoTranslate) autoScheduler.requestRun("resize");
  });
}

function settingsStatus(settings: ExtensionSettings): string {
  return settings.autoTranslate ? `UMT: backend connected | ${settings.targetLanguage}` : `UMT: backend connected | auto off | ${settings.targetLanguage}`;
}