import { BackendClient, SurfaceSubmitTracker } from "./client/backend-client";
import { DirectClient } from "./client/direct-client";
import { supportsEventStream, type TranslatorClient } from "./client/translator-client";
import { ChapterResultCache, type ChapterResultCacheContext } from "./cache/chapter-result-cache";
import { createSurfaceTask, createSurfaceTaskWithImageData } from "./capture/surface-capture";
import { createScreenshotSurface, readImageSize } from "./capture/screenshot-crop";
import { requestVisibleTabScreenshot } from "./capture/screenshot-request";
import { DebugOverlayRenderer } from "./debug-overlay-renderer";
import type { ServerEvent } from "@umt/shared/protocol";
import type { DetectedSurface } from "./detector/surface-detector";
import { EventResultRouter } from "./events/event-result-router";
import { isUmtContentCommand } from "./messages";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { createRectOverlayAnchor } from "./overlay/rect-anchor";
import { ChapterProgress } from "./progress/chapter-progress";
import { FloatingPanel } from "./panel/floating-panel";
import { ManualSelectionController } from "./selection/manual-selection";
import { TranslationQueue } from "./queue/translation-queue";
import type { SurfaceStatus } from "./surface/surface-state";
import { SurfaceControl } from "./surface/surface-control";
import { SurfaceRegistry, type RegisteredSurface } from "./surface/surface-registry";
import { isRenderableSurfaceResult } from "./translation-result";
import { getEffectiveSiteSettings, isSiteEnabled, loadSettings, saveSettings, setSiteSettings, setTranslationOverlayVisible, type ExtensionSettings } from "../settings/settings";
import { appendRuntimeLog } from "../settings/runtime-log";

const bootstrapWindow = window as Window & { __umtContentBootstrapState?: "starting" | "running" | undefined };
if (bootstrapWindow.__umtContentBootstrapState !== "starting" && bootstrapWindow.__umtContentBootstrapState !== "running") {
  bootstrapWindow.__umtContentBootstrapState = "starting";
  void bootstrap().then((started) => { bootstrapWindow.__umtContentBootstrapState = started ? "running" : undefined; }).catch((error) => {
    console.error("Universal Manga Translator bootstrap failed", error);
    bootstrapWindow.__umtContentBootstrapState = undefined;
  });
}

async function bootstrap(): Promise<boolean> {
  let settings = await loadSettings();
  if (!isSiteEnabled(settings, window.location.href)) return false;
  let client = createClient(settings);
  let renderer = createRenderer(settings, client);
  const debugRenderer = new DebugOverlayRenderer();
  debugRenderer.setEnabled(settings.debugOverlayEnabled);
  const submitTracker = new SurfaceSubmitTracker();
  const progress = new ChapterProgress();
  const chapterCache = new ChapterResultCache();
  let floatingPanel: FloatingPanel;
  if (settings.progressWidgetEnabled) await progress.mount();

  let jobSessionId = createJobSessionId();
  let eventSocket: WebSocket | null = null;
  let eventsConnected = false;
  let registry: SurfaceRegistry = SurfaceRegistry.scan(document);
  let controls = new Map<string, SurfaceControl>();

  let queue = createQueue();
  let eventResultRouter = createEventResultRouter(renderer);
  eventResultRouter.setSession(jobSessionId);

  function createClient(current: ExtensionSettings): TranslatorClient {
    return current.runMode === "backend"
      ? new BackendClient(current.backendUrl, { timeoutMs: current.requestTimeoutMs, retryCount: current.retryCount, backendHttp: requestBackendHttp })
      : new DirectClient(current);
  }

  function createRenderer(current: ExtensionSettings, translator: TranslatorClient): OverlayRenderer {
    return new OverlayRenderer({ targetLanguage: current.targetLanguage, appearance: current.overlayAppearance, onManualEdit: (override) => void translator.saveManualOverride(override) });
  }

  function createEventResultRouter(currentRenderer: OverlayRenderer): EventResultRouter {
    return new EventResultRouter({
      render: (element, naturalSize, result) => {
        logInfo("render event result", `${result.surfaceId} | status=${result.status} | regions=${result.regions.length}`);
        currentRenderer.render(element, naturalSize, result);
        currentRenderer.setVisible(settings.translationOverlayVisible);
        debugRenderer.markResult(element, naturalSize, result);
        markSurface(result.surfaceId, result.status === "cached" ? "cached" : result.status === "empty" ? "empty" : "completed");
      },
    });
  }

  function createQueue(): TranslationQueue {
    return new TranslationQueue({
      concurrency: Math.max(1, Math.min(settings.maxConcurrentSubmissions, 2)),
      worker: translateRegisteredSurface,
      onStatusChange: (surfaceId, status) => {
        controls.get(surfaceId)?.setStatus(status);
        updateProgress();
      },
    });
  }

  function site() {
    return getEffectiveSiteSettings(settings, window.location.href);
  }

  function shouldAutoTranslate(): boolean {
    const effective = site();
    return !effective.unsupported && effective.autoTranslate;
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

  function ensureEventStream(): void {
    if (eventsConnected) return;
    if (!supportsEventStream(client)) return;
    try {
      eventSocket = client.connectEvents(handleServerEvent);
      eventsConnected = true;
    } catch (error) {
      logError("event stream unavailable", error);
    }
  }

  function handleServerEvent(event: ServerEvent): void {
    const eventSessionId = "jobSessionId" in event ? event.jobSessionId : undefined;
    if (eventSessionId && eventSessionId !== jobSessionId) return;
    if (event.type === "job.queued") markSurface(event.surfaceId, "queued");
    if (event.type === "job.processing") markSurface(event.surfaceId, "translating");
    if (event.type === "job.failed") markSurface(event.surfaceId, "failed");
    if (event.type === "job.cancelled") markSurface(event.surfaceId, "cancelled");
    eventResultRouter.handle(event);
  }

  async function restoreCachedChapterResults(surfaces: RegisteredSurface[]): Promise<void> {
    const doc = await chapterCache.read(cacheContext());
    for (const surface of surfaces) {
      const entry = doc.entries[surface.imageUrl];
      if (!entry) continue;
      const result = { ...entry.result, surfaceId: surface.surfaceId, status: "cached" as const };
      renderer.render(surface.element, surface.naturalSize, result);
      renderer.setVisible(settings.translationOverlayVisible);
      eventResultRouter.track(surface.surfaceId, surface.element, surface.naturalSize);
      markSurface(surface.surfaceId, "cached");
    }
  }

  function cacheContext(): ChapterResultCacheContext {
    return { pageUrl: window.location.href, targetLanguage: settings.targetLanguage, providerProfile: currentProviderProfile() };
  }

  function currentProviderProfile(): string {
    if (typeof client.providerProfile === "function") return client.providerProfile();
    return settings.providerProfile;
  }

  function scanAndMountControls(reason: string): RegisteredSurface[] {
    registry = SurfaceRegistry.scan(document);
    const surfaces = registry.surfaces.slice(0, settings.maxFullPageSurfaces);
    const activeIds = new Set(surfaces.map((surface) => surface.surfaceId));
    for (const [surfaceId, control] of controls) {
      if (!activeIds.has(surfaceId)) {
        control.remove();
        controls.delete(surfaceId);
      }
    }
    for (const surface of surfaces) {
      let control = controls.get(surface.surfaceId);
      if (!control) {
        control = new SurfaceControl({
          surfaceId: surface.surfaceId,
          image: surface.element,
          index: surface.index,
          onAction: (surfaceId) => void translateSingleSurface(surfaceId, true),
        });
        controls.set(surface.surfaceId, control);
        control.mount();
        control.setStatus(queue.getStatus(surface.surfaceId));
      } else {
        control.updateIndex(surface.index);
        control.refreshPosition();
        control.setStatus(queue.getStatus(surface.surfaceId));
      }
      debugRenderer.markSurface(surface.surfaceId, surface.element, "detected", `#${surface.index}`);
    }
    queue.setSurfaces(surfaces);
    updateProgress();
    logInfo("surface registry scan", `${reason} | found=${surfaces.length}`);
    void restoreCachedChapterResults(surfaces).catch((error) => logError("restore chapter cache failed", error));
    return surfaces;
  }

  function markSurface(surfaceId: string, status: SurfaceStatus): void {
    if (!queue.mark(surfaceId, status)) return;
    controls.get(surfaceId)?.setStatus(status);
    updateProgress();
  }

  function updateProgress(): void {
    if (settings.progressWidgetEnabled) progress.update(queue.snapshot());
  }

  function resetProgress(message = "等待开始"): void {
    if (settings.progressWidgetEnabled) progress.reset(message);
  }

  async function setProgressWidgetEnabled(enabled: boolean): Promise<void> {
    settings = { ...settings, progressWidgetEnabled: enabled };
    if (enabled) {
      await progress.mount();
      progress.update(queue.snapshot());
    } else {
      progress.remove();
    }
  }

  function setFloatingButtonEnabled(enabled: boolean): void {
    settings = { ...settings, floatingButtonEnabled: enabled };
    floatingPanel?.setEnabled(enabled);
  }

  async function translateRegisteredSurface(surface: RegisteredSurface, force = false): Promise<SurfaceStatus> {
    ensureEventStream();
    if (!force && !submitTracker.shouldSubmit(surface.surfaceId)) return queue.getStatus(surface.surfaceId);
    submitTracker.markSubmitted(surface.surfaceId);
    markSurface(surface.surfaceId, "fetching");
    try {
      const detected = toDetectedSurface(surface);
      eventResultRouter.track(surface.surfaceId, surface.element, surface.naturalSize);
      const task = await createSurfaceTaskWithImageData(detected, "p2", settings.targetLanguage, { allowImageUrlFallback: settings.runMode !== "direct" });
      logInfo("submit surface", `${surface.surfaceId} | #${surface.index} | ${task.imageData ? "imageData" : "imageUrl"}`);
      markSurface(surface.surfaceId, "ocr");
      const response = force ? await client.retranslate(task, jobSessionId) : await client.submit(task, jobSessionId);
      if (response.ok && isRenderableSurfaceResult(response.result)) {
        renderer.render(surface.element, surface.naturalSize, response.result);
        renderer.setVisible(settings.translationOverlayVisible);
        debugRenderer.markResult(surface.element, surface.naturalSize, response.result);
        void chapterCache.save(cacheContext(), surface.imageUrl, response.result).catch((error) => logError("save chapter cache failed", error));
        return response.result.status === "cached" ? "cached" : "completed";
      }
      if (response.ok && response.result?.status === "empty") return "empty";
      if (response.ok && response.status === "cancelled") return "cancelled";
      logWarn("submit not renderable", `${surface.surfaceId} | ${response.ok ? response.status : response.error}`);
      return "failed";
    } catch (error) {
      logError("submit failed", error);
      submitTracker.release(surface.surfaceId);
      return "failed";
    }
  }

  async function translateSingleSurface(surfaceId: string, force = false): Promise<void> {
    const surface = registry.surfaces.find((item) => item.surfaceId === surfaceId) ?? scanAndMountControls("single-click").find((item) => item.surfaceId === surfaceId);
    if (!surface) return;
    const status = await translateRegisteredSurface(surface, force || queue.getStatus(surfaceId) === "failed");
    markSurface(surfaceId, status);
  }

  async function translatePage(force = false): Promise<void> {
    scanAndMountControls(force ? "retranslate" : "translate");
    ensureEventStream();
    if (force) {
      submitTracker.clear();
      for (const surface of registry.surfaces.slice(0, settings.maxFullPageSurfaces)) queue.mark(surface.surfaceId, "idle");
    }
    await queue.startAuto();
    updateProgress();
  }

  function startManualSelection(): void {
    const controller = new ManualSelectionController({
      onSelect: (rect) => void translateManualRect(rect),
      onCancel: () => logInfo("manual selection cancelled"),
    });
    controller.start();
  }

  async function translateManualRect(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    ensureEventStream();
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
      const response = await client.submit(createSurfaceTask(surface, "p0", settings.targetLanguage), jobSessionId);
      if (response.ok && isRenderableSurfaceResult(response.result)) {
        renderer.render(createRectOverlayAnchor(rect), surface.naturalSize, response.result);
        renderer.setVisible(settings.translationOverlayVisible);
        logInfo("render manual region", `regions=${response.result.regions.length}`);
      } else {
        logWarn("manual region not renderable", response.ok ? response.status : response.error);
      }
    } catch (error) {
      logError("manual region failed", error);
    }
  }

  async function setOverlayVisibility(visible: boolean): Promise<void> {
    settings = setTranslationOverlayVisible(settings, visible);
    renderer.setVisible(visible);
    floatingPanel?.setOverlayVisible(visible);
    await saveSettings(settings).catch((error) => logError("save overlay visibility failed", error));
  }

  async function toggleOverlayVisibility(): Promise<void> {
    await setOverlayVisibility(!settings.translationOverlayVisible);
  }

  async function cancelCurrentQueue(reason: string): Promise<void> {
    const previousSession = jobSessionId;
    queue.pause();
    for (const surface of registry.surfaces) {
      const status = queue.getStatus(surface.surfaceId);
      if (status === "queued" || status === "fetching" || status === "ocr" || status === "translating" || status === "rendering") markSurface(surface.surfaceId, "cancelled");
    }
    jobSessionId = createJobSessionId();
    eventResultRouter.setSession(jobSessionId);
    submitTracker.clear();
    await client.cancelJobSession(previousSession).catch((error) => logError("cancel session failed", error));
    queue.resume();
    updateProgress();
    logInfo("queue cancelled", reason);
  }

  async function resetPageState(reason: string, clearOverlay = true): Promise<void> {
    await cancelCurrentQueue(reason);
    submitTracker.clear();
    eventResultRouter.clear();
    queue.clear(reason);
    resetProgress("等待开始");
    if (clearOverlay) {
      renderer.clearAll();
      await chapterCache.clear(cacheContext()).catch((error) => logError("clear chapter cache failed", error));
    }
    debugRenderer.clear();
    for (const control of controls.values()) control.remove();
    controls.clear();
    scanAndMountControls(reason);
  }

  async function reloadSettings(): Promise<void> {
    const previousBackendUrl = settings.backendUrl;
    const previousRunMode = settings.runMode;
    const previousDirectOcr = JSON.stringify(settings.directOcr);
    const previousDirectTranslator = JSON.stringify(settings.directTranslator);
    const previousTargetLanguage = settings.targetLanguage;
    settings = await loadSettings();
    if (!isSiteEnabled(settings, window.location.href)) return;
    debugRenderer.setEnabled(settings.debugOverlayEnabled);
    renderer.setVisible(settings.translationOverlayVisible);
    floatingPanel?.setOverlayVisible(settings.translationOverlayVisible);
    setFloatingButtonEnabled(settings.floatingButtonEnabled);
    await setProgressWidgetEnabled(settings.progressWidgetEnabled);
    renderer.setAppearance(settings.overlayAppearance);
    const directChanged = previousDirectOcr !== JSON.stringify(settings.directOcr) || previousDirectTranslator !== JSON.stringify(settings.directTranslator);
    if (settings.backendUrl !== previousBackendUrl || settings.runMode !== previousRunMode || directChanged) {
      eventSocket?.close();
      eventSocket = null;
      eventsConnected = false;
      client = createClient(settings);
    }
    if (settings.targetLanguage !== previousTargetLanguage || settings.backendUrl !== previousBackendUrl || settings.runMode !== previousRunMode || directChanged) {
      renderer = createRenderer(settings, client);
      eventResultRouter = createEventResultRouter(renderer);
      eventResultRouter.setSession(jobSessionId);
    }
    queue = createQueue();
    scanAndMountControls("settings");
    if (shouldAutoTranslate()) void translatePage(false);
  }

  function refreshControls(): void {
    for (const control of controls.values()) control.refreshPosition();
  }

  function refreshLayout(): void {
    refreshControls();
    renderer.refreshAll();
  }

  function toDetectedSurface(surface: RegisteredSurface): DetectedSurface {
    const rect = surface.element.getBoundingClientRect();
    return {
      surfaceId: surface.surfaceId,
      kind: "image",
      element: surface.element,
      imageUrl: surface.imageUrl,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      naturalSize: surface.naturalSize,
      score: 10,
    };
  }

  floatingPanel = new FloatingPanel({
    onRetranslatePage: () => void translatePage(true),
    onSelectRegion: () => startManualSelection(),
    onToggleOverlayVisibility: (visible) => void setOverlayVisibility(visible),
  });
  floatingPanel.mount();
  floatingPanel.setOverlayVisible(settings.translationOverlayVisible);
  floatingPanel.setEnabled(settings.floatingButtonEnabled);
  renderer.setVisible(settings.translationOverlayVisible);

  logInfo("content script started", `${location.hostname} | mode=${settings.runMode} | target=${settings.targetLanguage}`);
  scanAndMountControls("load");
  if (shouldAutoTranslate()) void translatePage(false);

  const rescan = debounce((reason: string) => {
    scanAndMountControls(reason);
    if (shouldAutoTranslate()) void translatePage(false);
  }, 600);

  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isUmtOwnedMutation)) return;
    rescan("mutation");
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-src", "data-original", "style"] });

  window.addEventListener("scroll", () => refreshControls(), { passive: true });
  window.addEventListener("resize", () => refreshLayout());

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const relevant = ["runMode", "backendUrl", "directOcr", "directTranslator", "targetLanguage", "maxConcurrentSubmissions", "maxFullPageSurfaces", "siteSettings", "enabledSites", "translationOverlayVisible", "overlayAppearance", "autoTranslateDefault", "debugOverlayEnabled", "requestTimeoutMs", "retryCount", "floatingButtonEnabled", "progressWidgetEnabled"];
    if (relevant.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) void reloadSettings();
  });

  chrome.runtime?.onMessage?.addListener((message) => {
    if (!isUmtContentCommand(message)) return false;
    if (message.command === "translate") void translatePage(false);
    if (message.command === "refresh") void resetPageState("popup-refresh", false);
    if (message.command === "togglePause") {
      if (queue.snapshot().paused) { queue.resume(); void translatePage(false); }
      else queue.pause();
      updateProgress();
    }
    if (message.command === "clearPage") void resetPageState("popup-clear", true);
    if (message.command === "selectRegion") startManualSelection();
    if (message.command === "retranslate") void translatePage(true);
    if (message.command === "cancelQueue") void cancelCurrentQueue("popup-cancel");
    if (message.command === "setOverlayVisibility") void setOverlayVisibility(message.visible !== false);
    if (message.command === "toggleOverlayVisibility") void toggleOverlayVisibility();
    if (message.command === "applySiteSettings") {
      settings = setSiteSettings(settings, window.location.href, { autoTranslate: message.autoTranslate === true });
      if (message.autoTranslate === true) void translatePage(false);
      else void cancelCurrentQueue("auto-off");
    }
    if (message.command === "applyOverlayAppearance") {
      settings = { ...settings, overlayAppearance: message.appearance ? { ...settings.overlayAppearance, ...message.appearance } : settings.overlayAppearance };
      renderer.setAppearance(settings.overlayAppearance);
    }
    if (message.command === "applyWidgetSettings") {
      if (typeof message.floatingButtonEnabled === "boolean") setFloatingButtonEnabled(message.floatingButtonEnabled);
      if (typeof message.progressWidgetEnabled === "boolean") void setProgressWidgetEnabled(message.progressWidgetEnabled);
    }
    return false;
  });
  return true;
}

function isUmtOwnedMutation(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
  if (target?.closest("[data-umt-overlay-root], [data-umt-chapter-progress], [data-umt-surface-button], [data-umt-panel], [data-umt-debug-root], [data-umt-selection-layer]")) return true;
  for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
    if (node instanceof HTMLElement && node.matches("[data-umt-overlay-root], [data-umt-chapter-progress], [data-umt-surface-button], [data-umt-panel], [data-umt-debug-root], [data-umt-selection-layer]")) return true;
  }
  return false;
}

function createJobSessionId(): string {
  return `session:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}

function formatShortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

async function requestBackendHttp(request: { url: string; init?: import("./messages.js").UmtBackendHttpRequest["init"] }): Promise<import("./messages.js").UmtBackendHttpResponse> {
  return await chrome.runtime.sendMessage({ source: "umt-content", command: "backendHttp", ...request });
}





