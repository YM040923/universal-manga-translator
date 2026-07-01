import { BackendClient, SurfaceSubmitTracker } from "./client/backend-client";
import { createSurfaceTask } from "./capture/surface-capture";
import { createScreenshotSurface, readImageSize } from "./capture/screenshot-crop";
import { requestVisibleTabScreenshot } from "./capture/screenshot-request";
import { detectImageSurfaces } from "./detector/surface-detector";
import { isUmtContentCommand } from "./messages";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { FloatingPanel, type FloatingPanelState } from "./panel/floating-panel";
import { AutoScheduler } from "./scheduler/auto-scheduler";
import { ManualSelectionController } from "./selection/manual-selection";
import { PageChangeObserver } from "./scheduler/page-change-observer";
import { prioritizeSurfaces, type PrioritizedSurface } from "./scheduler/viewport-scheduler";
import { TranslationStatusCounter } from "./status/job-status-counter";
import { getEffectiveSiteSettings, loadSettings, type ExtensionSettings } from "../settings/settings";

void bootstrap();

async function bootstrap(): Promise<void> {
  let settings = await loadSettings();
  let client = new BackendClient(settings.backendUrl);
  let renderer = createRenderer(settings, client);
  const submitTracker = new SurfaceSubmitTracker();
  const statusCounter = new TranslationStatusCounter();
  let overlaysVisible = true;

  function createRenderer(current: ExtensionSettings, backend: BackendClient): OverlayRenderer {
    return new OverlayRenderer({ targetLanguage: current.targetLanguage, onManualEdit: (override) => void backend.saveManualOverride(override) });
  }

  function setPanelStatus(text: string, state: FloatingPanelState = "idle"): void {
    panel.setStatus(text, state);
  }

  function setCountersStatus(): void {
    panel.setStatus(statusCounter.format(), "done");
  }

  function viewportRect() {
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function site() {
    return getEffectiveSiteSettings(settings, window.location.href);
  }

  function shouldAutoTranslate(): boolean {
    const effective = site();
    return !effective.unsupported && effective.autoTranslate;
  }

  function selectedSurfaces(): PrioritizedSurface[] {
    const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
    if (settings.imageRange === "fullPage") return prioritized.slice(0, settings.maxFullPageSurfaces);
    return prioritized.filter((item) => item.priority === "p0" || item.priority === "p1");
  }

  async function translateSelectedSurfaces(): Promise<void> {
    const fresh = selectedSurfaces().filter((item) => submitTracker.shouldSubmit(item.surface.surfaceId));
    if (!fresh.length) {
      setPanelStatus("UMT: no new surfaces", "done");
      return;
    }
    setPanelStatus(`UMT: submitting ${fresh.length}`, "busy");
    await runWithConcurrency(fresh, settings.maxConcurrentSubmissions, async (item) => {
      submitTracker.markSubmitted(item.surface.surfaceId);
      try {
        const response = await client.submit(createSurfaceTask(item.surface, item.priority, settings.targetLanguage));
        if (response.ok && response.result) {
          renderer.render(item.surface.element, item.surface.naturalSize, response.result);
        } else {
          const fallbackRendered = await submitScreenshotFallback(item);
          if (!fallbackRendered) {
            statusCounter.recordFailedResponse(item.surface.surfaceId);
            setCountersStatus();
          }
        }
      } catch {
        const fallbackRendered = await submitScreenshotFallback(item);
        if (!fallbackRendered) {
          statusCounter.recordFailedResponse(item.surface.surfaceId);
          setCountersStatus();
        }
      }
    });
  }


  async function submitScreenshotFallback(item: PrioritizedSurface): Promise<boolean> {
    try {
      const screenshotDataUrl = await requestVisibleTabScreenshot();
      const screenshotSize = await readImageSize(screenshotDataUrl);
      const screenshotSurface = await createScreenshotSurface({
        screenshotDataUrl,
        viewportRect: item.surface.rect,
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
        screenshotSize,
        surfaceId: `screenshot:${item.surface.surfaceId}`,
        element: item.surface.element,
      });
      const retry = await client.submit(createSurfaceTask(screenshotSurface, item.priority, settings.targetLanguage));
      if (retry.ok && retry.result) {
        renderer.render(item.surface.element, screenshotSurface.naturalSize, retry.result);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
  function scan(): void {
    const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
    setPanelStatus(`UMT: found ${prioritized.length} manga surfaces`);
  }

  function togglePause(): void {
    if (autoScheduler.isPaused()) {
      autoScheduler.resume();
      setPanelStatus("UMT: resumed");
      autoScheduler.requestRun("resume");
    } else {
      autoScheduler.pause();
      setPanelStatus("UMT: paused", "paused");
    }
  }

  function refreshPage(): void {
    submitTracker.clear();
    renderer.refreshAll();
    scan();
    autoScheduler.requestRun("popup-refresh");
  }

  function clearCurrentPage(): void {
    submitTracker.clear();
    overlaysVisible = false;
    renderer.setVisible(false);
    setPanelStatus("UMT: page cleared", "idle");
  }

  function startManualSelection(): void {
    setPanelStatus("UMT: select region", "busy");
    const controller = new ManualSelectionController({
      onSelect: (rect) => void translateManualRect(rect),
      onCancel: () => setPanelStatus("UMT: selection cancelled", "idle"),
    });
    controller.start();
  }

  async function translateManualRect(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    try {
      const screenshotDataUrl = await requestVisibleTabScreenshot();
      const screenshotSize = await readImageSize(screenshotDataUrl);
      const surface = await createScreenshotSurface({
        screenshotDataUrl,
        viewportRect: rect,
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
        screenshotSize,
        surfaceId: `manual:${Date.now()}:${Math.round(rect.x)}:${Math.round(rect.y)}`,
        element: document.body,
      });
      const response = await client.submit(createSurfaceTask(surface, "p0", settings.targetLanguage));
      if (response.ok && response.result) {
        renderer.render(createManualOverlayAnchor(rect), surface.naturalSize, response.result);
        setPanelStatus("UMT: manual region translated", "done");
      } else {
        setPanelStatus("UMT: manual region failed", "error");
      }
    } catch {
      setPanelStatus("UMT: screenshot unavailable", "error");
    }
  }

  function updatePanelForSettings(): void {
    panel.setEnabled(settings.floatingButtonEnabled);
    const effective = site();
    if (effective.unsupported) {
      setPanelStatus("UMT: unsupported page", "offline");
    } else if (!effective.autoTranslate) {
      setPanelStatus(`UMT: auto off | ${settings.targetLanguage}`);
    } else {
      setPanelStatus(`UMT: ready | ${settings.targetLanguage}`);
    }
  }

  async function reloadSettings(): Promise<void> {
    const previousBackendUrl = settings.backendUrl;
    const previousTargetLanguage = settings.targetLanguage;
    settings = await loadSettings();
    if (settings.backendUrl !== previousBackendUrl) client = new BackendClient(settings.backendUrl);
    if (settings.targetLanguage !== previousTargetLanguage || settings.backendUrl !== previousBackendUrl) renderer = createRenderer(settings, client);
    updatePanelForSettings();
    if (shouldAutoTranslate()) autoScheduler.requestRun("settings");
  }

  const autoScheduler = new AutoScheduler(() => translateSelectedSurfaces(), 350);

  const panel = new FloatingPanel({
    onTranslateCurrent: () => void translateSelectedSurfaces(),
    onSelectRegion: startManualSelection,
  });

  panel.mount();
  updatePanelForSettings();

  const pageChangeObserver = new PageChangeObserver(document, {
    onChange: (reason) => {
      renderer.refreshAll();
      if (shouldAutoTranslate()) autoScheduler.requestRun(reason);
    },
  });
  pageChangeObserver.start();

  try {
    client.connectEvents((event) => {
      statusCounter.recordEvent(event);
      setCountersStatus();
    });
  } catch {
    setPanelStatus("UMT: event stream unavailable", "error");
  }

  void client.health().then((ok) => {
    setPanelStatus(ok ? settingsStatus(settings, shouldAutoTranslate()) : "UMT: backend offline", ok ? "idle" : "offline");
    if (ok && shouldAutoTranslate()) autoScheduler.requestRun("load");
  });

  window.addEventListener("scroll", () => {
    renderer.refreshAll();
    if (shouldAutoTranslate()) autoScheduler.requestRun("scroll");
  }, { passive: true });

  window.addEventListener("resize", () => {
    renderer.refreshAll();
    if (shouldAutoTranslate()) autoScheduler.requestRun("resize");
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const relevant = ["backendUrl", "targetLanguage", "translationModel", "autoTranslateDefault", "imageRange", "pretranslateNextPage", "floatingButtonEnabled", "siteSettings", "providerProfile", "openAICompatibleBaseUrl", "requestTimeoutMs", "maxConcurrentSubmissions", "maxFullPageSurfaces", "retryCount", "autoTranslate"];
    if (relevant.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) void reloadSettings();
  });

  chrome.runtime?.onMessage?.addListener((message) => {
    if (!isUmtContentCommand(message)) return false;
    if (message.command === "translate") void translateSelectedSurfaces();
    if (message.command === "refresh") refreshPage();
    if (message.command === "togglePause") togglePause();
    if (message.command === "clearPage") clearCurrentPage();
    if (message.command === "selectRegion") startManualSelection();
    return false;
  });
}

function createManualOverlayAnchor(rect: { x: number; y: number; width: number; height: number }): HTMLElement {
  const anchor = document.createElement("div");
  anchor.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  } as DOMRect);
  return anchor;
}

function settingsStatus(settings: ExtensionSettings, autoTranslate: boolean): string {
  return autoTranslate ? `UMT: backend connected | ${settings.targetLanguage}` : `UMT: backend connected | auto off | ${settings.targetLanguage}`;
}
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const limit = Math.max(1, Math.min(Math.trunc(concurrency), 8));
  let index = 0;
  async function runNext(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      if (item !== undefined) await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
}



