import { BackendClient, SurfaceSubmitTracker } from "./client/backend-client";
import { createSurfaceTask } from "./capture/surface-capture";
import { createScreenshotSurface, readImageSize } from "./capture/screenshot-crop";
import { requestVisibleTabScreenshot } from "./capture/screenshot-request";
import { DebugOverlayRenderer } from "./debug-overlay-renderer";
import { detectImageSurfaces } from "./detector/surface-detector";
import { isUmtContentCommand } from "./messages";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { createRectOverlayAnchor } from "./overlay/rect-anchor";
import { FloatingPanel, type FloatingPanelState } from "./panel/floating-panel";
import { AutoScheduler } from "./scheduler/auto-scheduler";
import { ManualSelectionController } from "./selection/manual-selection";
import { PageChangeObserver } from "./scheduler/page-change-observer";
import { prioritizeSurfaces, selectSurfacesForMode, type PrioritizedSurface } from "./scheduler/viewport-scheduler";
import { TranslationStatusCounter } from "./status/job-status-counter";
import { isRenderableSurfaceResult } from "./translation-result";
import { getEffectiveSiteSettings, loadSettings, type ExtensionSettings } from "../settings/settings";
import { appendRuntimeLog } from "../settings/runtime-log";

void bootstrap();

async function bootstrap(): Promise<void> {
  let settings = await loadSettings();
  let client = createClient(settings);
  let renderer = createRenderer(settings, client);
  const submitTracker = new SurfaceSubmitTracker();
  const statusCounter = new TranslationStatusCounter();
  const debugRenderer = new DebugOverlayRenderer();
  let overlaysVisible = true;
  debugRenderer.setEnabled(settings.debugOverlayEnabled);

  function createClient(current: ExtensionSettings): BackendClient {
    return new BackendClient(current.backendUrl, { timeoutMs: current.requestTimeoutMs, retryCount: current.retryCount });
  }

  function createRenderer(current: ExtensionSettings, backend: BackendClient): OverlayRenderer {
    return new OverlayRenderer({ targetLanguage: current.targetLanguage, onManualEdit: (override) => void backend.saveManualOverride(override) });
  }

  function setPanelStatus(text: string, state: FloatingPanelState = "idle"): void {
    panel.setStatus(text, state);
  }

  function logInfo(message: string, detail?: string): void {
    void appendRuntimeLog({ level: "info", source: "content", message, ...(detail ? { detail } : {}) });
  }

  function logWarn(message: string, detail?: string): void {
    void appendRuntimeLog({ level: "warn", source: "content", message, ...(detail ? { detail } : {}) });
  }

  function logError(message: string, error: unknown): void {
    void appendRuntimeLog({ level: "error", source: "content", message, detail: formatShortError(error) });
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
    const selected = selectSurfacesForMode(prioritized, { imageRange: settings.imageRange, maxFullPageSurfaces: settings.maxFullPageSurfaces, pretranslateNextPage: settings.pretranslateNextPage });
    logInfo("surfaces selected", `detected=${prioritized.length}, selected=${selected.length}, range=${settings.imageRange}, pretranslate=${settings.pretranslateNextPage}`);
    for (const item of selected) debugRenderer.markSurface(item.surface.surfaceId, item.surface.element, "detected", `${item.priority} ${item.surface.kind}`);
    return selected;
  }

  async function translateSelectedSurfaces(): Promise<void> {
    const fresh = selectedSurfaces().filter((item) => submitTracker.shouldSubmit(item.surface.surfaceId));
    if (!fresh.length) {
      setPanelStatus("UMT: no new surfaces", "done");
      logWarn("no new surfaces to submit");
      return;
    }
    setPanelStatus(`UMT: submitting ${fresh.length}`, "busy");
    await runWithConcurrency(fresh, settings.maxConcurrentSubmissions, async (item) => {
      submitTracker.markSubmitted(item.surface.surfaceId);
      logInfo("submit surface", `${item.surface.surfaceId} | ${item.surface.kind} | ${Math.round(item.surface.naturalSize.width)}x${Math.round(item.surface.naturalSize.height)} | ${item.priority}`);
      debugRenderer.markSurface(item.surface.surfaceId, item.surface.element, "submitting", `${item.priority} ${item.surface.kind}`);
      try {
        const response = await client.submit(createSurfaceTask(item.surface, item.priority, settings.targetLanguage));
        if (response.ok && isRenderableSurfaceResult(response.result)) {
          logInfo("render result", `${item.surface.surfaceId} | status=${response.result.status} | regions=${response.result.regions.length}`);
          renderer.render(item.surface.element, item.surface.naturalSize, response.result);
          debugRenderer.markResult(item.surface.element, item.surface.naturalSize, response.result);
        } else {
          logWarn("direct submit not renderable", `${item.surface.surfaceId} | ok=${response.ok} | status=${response.ok ? response.result?.status : response.error}`);
          debugRenderer.markSurface(item.surface.surfaceId, item.surface.element, response.ok ? "empty" : "failed", "trying screenshot fallback");
          const fallbackRendered = await submitScreenshotFallback(item);
          if (!fallbackRendered && item.screenshotFallbackEligible) {
            statusCounter.recordFailedResponse(item.surface.surfaceId);
            setCountersStatus();
          }
        }
      } catch (error) {
        logError("direct submit failed", error);
        const fallbackRendered = await submitScreenshotFallback(item);
        if (!fallbackRendered && item.screenshotFallbackEligible) {
          statusCounter.recordFailedResponse(item.surface.surfaceId);
          setCountersStatus();
        }
      }
    });
  }

  async function retranslateSelectedSurfaces(): Promise<void> {
    submitTracker.clear();
    const fresh = selectedSurfaces();
    if (!fresh.length) {
      setPanelStatus("UMT: no surfaces to retranslate", "done");
      return;
    }
    setPanelStatus(`UMT: retranslating ${fresh.length}`, "busy");
    await runWithConcurrency(fresh, settings.maxConcurrentSubmissions, async (item) => {
      try {
        const response = await client.retranslate(createSurfaceTask(item.surface, item.priority, settings.targetLanguage));
        if (response.ok && response.result) renderer.render(item.surface.element, item.surface.naturalSize, response.result);
      } catch {
        statusCounter.recordFailedResponse(item.surface.surfaceId);
        setCountersStatus();
      }
    });
  }


  async function submitScreenshotFallback(item: PrioritizedSurface): Promise<boolean> {
    if (!item.screenshotFallbackEligible) {
      submitTracker.release(item.surface.surfaceId);
      logWarn("screenshot fallback deferred until visible", `${item.surface.surfaceId} | priority=${item.priority}`);
      return false;
    }
    try {
      const screenshotDataUrl = await requestVisibleTabScreenshot();
      const screenshotSize = await readImageSize(screenshotDataUrl);
      return await submitScreenshotFallbackAttempt(item, screenshotDataUrl, screenshotSize, 1)
        || await submitScreenshotFallbackAttempt(item, screenshotDataUrl, screenshotSize, 2);
    } catch (error) {
      logError("screenshot fallback failed", error);
      return false;
    }
  }

  async function submitScreenshotFallbackAttempt(item: PrioritizedSurface, screenshotDataUrl: string, screenshotSize: { width: number; height: number }, upscale: 1 | 2): Promise<boolean> {
    const screenshotSurface = await createScreenshotSurface({
      screenshotDataUrl,
      viewportRect: item.surface.rect,
      viewportSize: { width: window.innerWidth, height: window.innerHeight },
      screenshotSize,
      surfaceId: `${upscale === 1 ? "screenshot" : "screenshot2x"}:${item.surface.surfaceId}`,
      element: item.surface.element,
      upscale,
    });
    debugRenderer.markSurface(item.surface.surfaceId, item.surface.element, "fallback", `${upscale}x screenshot`);
    logInfo("submit screenshot fallback", `${item.surface.surfaceId} | upscale=${upscale} | crop=${Math.round(screenshotSurface.naturalSize.width)}x${Math.round(screenshotSurface.naturalSize.height)}`);
    const retry = await client.submit(createSurfaceTask(screenshotSurface, item.priority, settings.targetLanguage));
    if (retry.ok && isRenderableSurfaceResult(retry.result)) {
      logInfo("render screenshot fallback", `${item.surface.surfaceId} | regions=${retry.result.regions.length}`);
      const anchor = createRectOverlayAnchor(screenshotSurface.rect);
      renderer.render(anchor, screenshotSurface.naturalSize, retry.result);
      debugRenderer.markResult(anchor, screenshotSurface.naturalSize, retry.result);
      return true;
    }
    if (retry.ok && retry.result?.status === "empty") {
      logWarn("screenshot fallback empty", `${item.surface.surfaceId} | upscale=${upscale}`);
      debugRenderer.markSurface(item.surface.surfaceId, item.surface.element, "empty", `${upscale}x fallback empty`);
    }
    return false;
  }
  function scan(): void {
    const prioritized = prioritizeSurfaces(detectImageSurfaces(document), viewportRect());
    setPanelStatus(`UMT: found ${prioritized.length} manga surfaces`);
    logInfo("scan page", `found=${prioritized.length}`);
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
    debugRenderer.clear();
    scan();
    autoScheduler.requestRun("popup-refresh");
  }

  function clearCurrentPage(): void {
    submitTracker.clear();
    overlaysVisible = false;
    renderer.setVisible(false);
    debugRenderer.clear();
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
      logInfo("submit manual region", `${Math.round(rect.width)}x${Math.round(rect.height)}`);
      const response = await client.submit(createSurfaceTask(surface, "p0", settings.targetLanguage));
      if (response.ok && isRenderableSurfaceResult(response.result)) {
        renderer.render(createRectOverlayAnchor(rect), surface.naturalSize, response.result);
        logInfo("render manual region", `regions=${response.result.regions.length}`);
        setPanelStatus("UMT: manual region translated", "done");
      } else if (response.ok && response.result?.status === "empty") {
        logWarn("manual region empty");
        setPanelStatus("UMT: manual region has no readable text", "done");
      } else {
        setPanelStatus("UMT: manual region failed", "error");
      }
    } catch (error) {
      logError("manual region failed", error);
      setPanelStatus(`UMT: screenshot failed: ${formatShortError(error)}`, "error");
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
    const previousTimeoutMs = settings.requestTimeoutMs;
    const previousRetryCount = settings.retryCount;
    settings = await loadSettings();
    logInfo("settings reloaded", `backend=${settings.backendUrl}, target=${settings.targetLanguage}, debug=${settings.debugOverlayEnabled}`);
    debugRenderer.setEnabled(settings.debugOverlayEnabled);
    if (settings.backendUrl !== previousBackendUrl || settings.requestTimeoutMs !== previousTimeoutMs || settings.retryCount !== previousRetryCount) client = createClient(settings);
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
  logInfo("content script started", `${location.hostname} | backend=${settings.backendUrl} | target=${settings.targetLanguage}`);
  updatePanelForSettings();

  const pageChangeObserver = new PageChangeObserver(document, {
    onChange: (reason) => {
      renderer.refreshAll();
      if (settings.debugOverlayEnabled) scan();
      if (shouldAutoTranslate()) autoScheduler.requestRun(reason);
    },
  });
  pageChangeObserver.start();

  try {
    client.connectEvents((event) => {
      statusCounter.recordEvent(event);
      setCountersStatus();
    });
  } catch (error) {
    logError("event stream unavailable", error);
    setPanelStatus("UMT: event stream unavailable", "error");
  }

  void client.health().then((ok) => {
    setPanelStatus(ok ? settingsStatus(settings, shouldAutoTranslate()) : "UMT: backend offline", ok ? "idle" : "offline");
    logInfo("backend health", ok ? "connected" : "offline");
    if (ok && shouldAutoTranslate()) autoScheduler.requestRun("load");
  });

  window.addEventListener("scroll", () => {
    renderer.refreshAll();
    if (settings.debugOverlayEnabled) scan();
    if (shouldAutoTranslate()) autoScheduler.requestRun("scroll");
  }, { passive: true });

  window.addEventListener("resize", () => {
    renderer.refreshAll();
    if (settings.debugOverlayEnabled) scan();
    if (shouldAutoTranslate()) autoScheduler.requestRun("resize");
  });

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const relevant = ["backendUrl", "targetLanguage", "translationModel", "autoTranslateDefault", "imageRange", "pretranslateNextPage", "floatingButtonEnabled", "siteSettings", "providerProfile", "openAICompatibleBaseUrl", "requestTimeoutMs", "maxConcurrentSubmissions", "maxFullPageSurfaces", "retryCount", "autoTranslate", "debugOverlayEnabled"];
    if (relevant.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) void reloadSettings();
  });

  chrome.runtime?.onMessage?.addListener((message) => {
    if (!isUmtContentCommand(message)) return false;
    if (message.command === "translate") void translateSelectedSurfaces();
    if (message.command === "refresh") refreshPage();
    if (message.command === "togglePause") togglePause();
    if (message.command === "clearPage") clearCurrentPage();
    if (message.command === "selectRegion") startManualSelection();
    if (message.command === "retranslate") void retranslateSelectedSurfaces();
    return false;
  });
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




function formatShortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 96 ? `${message.slice(0, 93)}...` : message;
}
