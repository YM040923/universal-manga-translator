import { BackendClient, SurfaceSubmitTracker } from "./client/backend-client";
import { DirectClient } from "./client/direct-client";
import { supportsEventStream, type TranslatorClient } from "./client/translator-client";
import { hasRelevantContentSettingChange } from "./settings-change";
import { ChapterResultCache, type ChapterResultCacheContext } from "./cache/chapter-result-cache";
import { ManualSelectionCache, type ManualSelectionCacheContext } from "./cache/manual-selection-cache";
import { ExtensionManualOverrideStore } from "./cache/manual-overrides";
import { createSurfaceTask, createSurfaceTaskWithImageData, createSurfaceTaskWithImageDataCapture } from "./capture/surface-capture";
import { createScreenshotSurfaceCapture, readImageSize } from "./capture/screenshot-crop";
import { requestVisibleTabScreenshot } from "./capture/screenshot-request";
import { captureWithRecognitionSummary } from "./capture/recognition-capture-log";
import { DebugOverlayRenderer } from "./debug-overlay-renderer";
import { createContentLogger } from "./content-logger";
import type { ServerEvent } from "@umt/shared/protocol";
import { EventResultRouter } from "./events/event-result-router";
import { isUmtContentCommand, type UmtContentCommandResponse, type UmtPageSampleSelfTestResponse } from "./messages";
import { OverlayRenderer } from "./overlay/overlay-renderer";
import { createDocumentRectOverlayAnchor, documentRectFromViewportRect } from "./overlay/rect-anchor";
import { ChapterProgress } from "./progress/chapter-progress";
import { FloatingPanel } from "./panel/floating-panel";
import { ManualSelectionController } from "./selection/manual-selection";
import { TranslationQueue } from "./queue/translation-queue";
import type { SurfaceStatus } from "./surface/surface-state";
import { SurfaceControl } from "./surface/surface-control";
import { toDetectedSurface } from "./surface/detected-surface";
import { selectVisibleSurfaces } from "./surface/visible-surfaces";
import { isLikelyReaderPage, SurfaceRegistry, type RegisteredSurface } from "./surface/surface-registry";
import { findOpenShadowRoots } from "./detector/surface-detector";
import { isRenderableSurfaceResult } from "./translation-result";
import { createJobSessionId, debounce, formatShortError, isUmtOwnedMutation, requestBackendHttp } from "./utils";
import { getEffectiveSiteSettings, isSiteEnabled, loadSettings, saveSettings, setSiteSettings, setTranslationOverlayVisible, type ExtensionSettings } from "../settings/settings";

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
  const manualSelectionCache = new ManualSelectionCache();
  const manualOverrides = new ExtensionManualOverrideStore();
  const logger = createContentLogger();
  let floatingPanel: FloatingPanel;

  let jobSessionId = createJobSessionId();
  let eventSocket: WebSocket | null = null;
  let eventsConnected = false;
  let registry: SurfaceRegistry = SurfaceRegistry.scan(document);
  let readerUiMounted = false;
  let controls = new Map<string, SurfaceControl>();
  const surfaceFailureDetails = new Map<string, string>();

  let queue = createQueue();
  let eventResultRouter = createEventResultRouter(renderer);
  eventResultRouter.setSession(jobSessionId);

  function createClient(current: ExtensionSettings): TranslatorClient {
    return current.runMode === "backend"
      ? new BackendClient(current.backendUrl, { timeoutMs: current.requestTimeoutMs, retryCount: current.retryCount, backendHttp: requestBackendHttp })
      : new DirectClient(current);
  }

  function createRenderer(current: ExtensionSettings, translator: TranslatorClient): OverlayRenderer {
    return new OverlayRenderer({
      targetLanguage: current.targetLanguage,
      appearance: current.overlayAppearance,
      replaceExistingRoot: true,
      onManualEdit: (override) => {
        void manualOverrides.save(override).catch((error) => logger.error("save local manual override failed", error));
        void translator.saveManualOverride(override).catch((error) => logger.error("save manual override failed", error));
      },
    });
  }

  function createEventResultRouter(currentRenderer: OverlayRenderer): EventResultRouter {
    return new EventResultRouter({
      render: (element, naturalSize, result) => {
        logger.info("render event result", `${result.surfaceId} | status=${result.status} | regions=${result.regions.length}`);
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
      maxAutoItems: settings.directOcr.maxAutoOcrPages,
      stopAfterConsecutiveFailures: settings.directOcr.stopAfterConsecutiveFailures,
      worker: translateRegisteredSurface,
      onStatusChange: (surfaceId, status) => {
        setSurfaceControlStatus(surfaceId, status);
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

  function ensureEventStream(): void {
    if (eventsConnected) return;
    if (!supportsEventStream(client)) return;
    try {
      eventSocket = client.connectEvents(handleServerEvent);
      eventsConnected = true;
    } catch (error) {
      logger.error("event stream unavailable", error);
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
    for (const surface of surfaces) {
      const imageUrl = surface.imageUrl;
      if (!imageUrl) continue;
      const entry = await chapterCache.get(cacheContext(), imageUrl);
      if (!entry) continue;
      const result = await manualOverrides.applyToResult({ ...entry.result, surfaceId: surface.surfaceId, status: "cached" as const }, settings.targetLanguage);
      renderer.render(surface.element, surface.naturalSize, result);
      renderer.setVisible(settings.translationOverlayVisible);
      eventResultRouter.track(surface.surfaceId, surface.element, surface.naturalSize);
      markSurface(surface.surfaceId, "cached");
    }
  }

  function pageRuntimeSnapshot(): UmtContentCommandResponse {
    return {
      ok: true,
      state: {
        readerActive: readerUiMounted,
        overlayVisible: settings.translationOverlayVisible,
        autoTranslate: shouldAutoTranslate(),
        queue: queue.snapshot(),
      },
    };
  }

  async function restoreCachedResults(surfaces: RegisteredSurface[]): Promise<void> {
    // Manual selections establish protected overlay regions before ordinary cache restores.
    await restoreCachedManualSelections();
    await restoreCachedChapterResults(surfaces);
  }

  function cacheContext(): ChapterResultCacheContext {
    return { pageUrl: window.location.href, targetLanguage: settings.targetLanguage, providerProfile: currentProviderProfile() };
  }

  function manualSelectionCacheContext(): ManualSelectionCacheContext {
    return { pageUrl: window.location.href, targetLanguage: settings.targetLanguage, providerProfile: currentProviderProfile() };
  }

  async function restoreCachedManualSelections(): Promise<void> {
    const doc = await manualSelectionCache.read(manualSelectionCacheContext());
    for (const entry of doc.entries) {
      const result = await manualOverrides.applyToResult({ ...entry.result, surfaceId: entry.id, status: "cached" as const }, settings.targetLanguage);
      renderer.render(createDocumentRectOverlayAnchor(entry.documentRect), entry.naturalSize, result);
      renderer.setVisible(settings.translationOverlayVisible);
    }
  }

  function currentProviderProfile(): string {
    if (typeof client.providerProfile === "function") return client.providerProfile();
    return settings.providerProfile;
  }

  function scanAndMountControls(reason: string): RegisteredSurface[] {
    registry = SurfaceRegistry.scan(document);
    const surfaces = registry.surfaces.slice(0, settings.maxFullPageSurfaces);
    if (!isLikelyReaderPage(document, surfaces)) {
      queue.setSurfaces([]);
      updateProgress();
      logger.info("reader page inactive", `${reason} | found=${surfaces.length}`);
      return [];
    }
    mountReaderUi();
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
    renderer.refreshAll();
    updateProgress();
    logger.info("surface registry scan", `${reason} | found=${surfaces.length}`);
    void restoreCachedResults(surfaces).catch((error) => logger.error("restore cached results failed", error));
    return surfaces;
  }

  function markSurface(surfaceId: string, status: SurfaceStatus, detail?: string): void {
    if (status === "failed" && detail) surfaceFailureDetails.set(surfaceId, detail);
    if (status !== "failed") surfaceFailureDetails.delete(surfaceId);
    if (!queue.mark(surfaceId, status)) return;
    setSurfaceControlStatus(surfaceId, status);
    updateProgress();
  }

  function setSurfaceControlStatus(surfaceId: string, status: SurfaceStatus): void {
    const detail = status === "failed" ? surfaceFailureDetails.get(surfaceId) : undefined;
    controls.get(surfaceId)?.setStatus(status, detail ? { detail } : {});
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
      const { task } = await captureWithRecognitionSummary(
        () => createSurfaceTaskWithImageDataCapture(detected, "p2", settings.targetLanguage, { allowImageUrlFallback: settings.runMode !== "direct" }),
        logger,
      );
      logger.info("submit surface", `${surface.surfaceId} | #${surface.index} | ${task.imageData ? "imageData" : "imageUrl"}`);
      markSurface(surface.surfaceId, "ocr");
      const response = force ? await client.retranslate(task, jobSessionId) : await client.submit(task, jobSessionId);
      if (response.ok && isRenderableSurfaceResult(response.result)) {
        const result = await manualOverrides.applyToResult(response.result, settings.targetLanguage);
        renderer.render(surface.element, surface.naturalSize, result);
        renderer.setVisible(settings.translationOverlayVisible);
        debugRenderer.markResult(surface.element, surface.naturalSize, result);
        if (surface.imageUrl) void chapterCache.save(cacheContext(), surface.imageUrl, result).catch((error) => logger.error("save chapter cache failed", error));
        return result.status === "cached" ? "cached" : "completed";
      }
      if (response.ok && response.result?.status === "empty") return "empty";
      if (response.ok && response.status === "cancelled") return "cancelled";
      const detail = response.ok ? response.status : response.error;
      logger.warn("submit not renderable", `${surface.surfaceId} | ${detail}`);
      markSurface(surface.surfaceId, "failed", detail);
      return "failed";
    } catch (error) {
      const detail = formatShortError(error);
      logger.error("submit failed", error);
      surfaceFailureDetails.set(surface.surfaceId, detail);
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

  async function retranslateVisibleSurfaces(): Promise<void> {
    const surfaces = selectVisibleSurfaces(scanAndMountControls("retranslate-visible")).slice(0, Math.max(1, settings.maxConcurrentSubmissions + 2));
    if (!surfaces.length) return;
    ensureEventStream();
    let cursor = 0;
    const concurrency = Math.max(1, Math.min(settings.maxConcurrentSubmissions, 2));
    const runNext = async (): Promise<void> => {
      while (cursor < surfaces.length) {
        const surface = surfaces[cursor++];
        if (!surface) continue;
        submitTracker.release(surface.surfaceId);
        queue.mark(surface.surfaceId, "idle");
        const status = await translateRegisteredSurface(surface, true);
        markSurface(surface.surfaceId, status);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, surfaces.length) }, () => runNext()));
    updateProgress();
  }

  async function sampleOcrSelfTest(): Promise<UmtPageSampleSelfTestResponse> {
    const startedAt = Date.now();
    try {
      const surfaces = scanAndMountControls("self-test");
      if (!surfaces.length) {
        return { ok: false, status: isLikelyReaderPage(document, []) ? "no-surface" : "no-reader-page", detail: "当前页没有可用于 OCR 自检的漫画图片", elapsedMs: Date.now() - startedAt, providerProfile: currentProviderProfile() };
      }
      const surface = surfaces[0];
      if (!surface) return { ok: false, status: "no-surface", detail: "当前页没有可用于 OCR 自检的漫画图片", elapsedMs: Date.now() - startedAt, providerProfile: currentProviderProfile() };
      const task = await createSurfaceTaskWithImageData(toDetectedSurface(surface), "p2", settings.targetLanguage, { allowImageUrlFallback: settings.runMode !== "direct" });
      const response = await client.submit({ ...task, surfaceId: `selftest:${surface.surfaceId}:${Date.now()}` }, jobSessionId);
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) return { ok: false, status: "failed", detail: response.error, surfaceId: surface.surfaceId, surfaceIndex: surface.index, elapsedMs, providerProfile: currentProviderProfile() };
      const regionCount = response.result?.regions.length ?? 0;
      if (regionCount <= 0) return { ok: false, status: "empty", detail: "页面样本未返回文字区域", surfaceId: surface.surfaceId, surfaceIndex: surface.index, elapsedMs, providerProfile: currentProviderProfile() };
      return { ok: true, status: "ok", surfaceId: surface.surfaceId, surfaceIndex: surface.index, regionCount, elapsedMs, providerProfile: currentProviderProfile() };
    } catch (error) {
      return { ok: false, status: "failed", detail: formatShortError(error), elapsedMs: Date.now() - startedAt, providerProfile: currentProviderProfile() };
    }
  }

  function startManualSelection(): void {
    if (!isLikelyReaderPage(document, registry.surfaces.slice(0, settings.maxFullPageSurfaces))) {
      logger.info("manual selection ignored outside reader page");
      return;
    }
    mountReaderUi();
    const controller = new ManualSelectionController({
      onSelect: (rect) => void translateManualRect(rect),
      onCancel: () => logger.info("manual selection cancelled"),
    });
    controller.start();
  }

  async function translateManualRect(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    ensureEventStream();
    // Preserve where the selection was made before OCR yields to the event loop.
    // The reader may be scrolled by the time the translated result returns.
    const documentRect = documentRectFromViewportRect(rect);
    try {
      const screenshotDataUrl = await requestVisibleTabScreenshot();
      const screenshotSize = await readImageSize(screenshotDataUrl);
      const { surface } = await captureWithRecognitionSummary(
        () => createScreenshotSurfaceCapture({
          screenshotDataUrl,
          viewportRect: rect,
          viewportSize: { width: window.innerWidth, height: window.innerHeight },
          screenshotSize,
          devicePixelRatio: window.devicePixelRatio,
          surfaceId: `manual:${Date.now()}:${Math.round(rect.x)}:${Math.round(rect.y)}`,
          element: document.body,
        }),
        logger,
      );
      const response = await client.submit(createSurfaceTask(surface, "p0", settings.targetLanguage), jobSessionId);
      if (response.ok && isRenderableSurfaceResult(response.result)) {
        const result = await manualOverrides.applyToResult(response.result, settings.targetLanguage);
        renderer.render(createDocumentRectOverlayAnchor(documentRect), surface.naturalSize, result);
        renderer.setVisible(settings.translationOverlayVisible);
        void manualSelectionCache.save(manualSelectionCacheContext(), { id: surface.surfaceId, documentRect, naturalSize: surface.naturalSize, result }).catch((error) => logger.error("save manual selection cache failed", error));
        logger.info("render manual region", `regions=${result.regions.length}`);
      } else {
        logger.warn("manual region not renderable", response.ok ? response.status : response.error);
      }
    } catch (error) {
      logger.error("manual region failed", error);
    }
  }

  async function setOverlayVisibility(visible: boolean): Promise<void> {
    settings = setTranslationOverlayVisible(settings, visible);
    renderer.setVisible(visible);
    floatingPanel?.setOverlayVisible(visible);
    await saveSettings(settings).catch((error) => logger.error("save overlay visibility failed", error));
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
    await client.cancelJobSession(previousSession).catch((error) => logger.error("cancel session failed", error));
    queue.resume();
    updateProgress();
    logger.info("queue cancelled", reason);
  }

  async function resetPageState(reason: string, clearOverlay = true): Promise<void> {
    await cancelCurrentQueue(reason);
    submitTracker.clear();
    surfaceFailureDetails.clear();
    eventResultRouter.clear();
    queue.clear(reason);
    resetProgress("等待开始");
    if (clearOverlay) {
      renderer.clearAll();
      await chapterCache.clear(cacheContext()).catch((error) => logger.error("clear chapter cache failed", error));
      await manualSelectionCache.clear(manualSelectionCacheContext()).catch((error) => logger.error("clear manual selection cache failed", error));
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

  function mountReaderUi(): void {
    if (readerUiMounted) return;
    floatingPanel.mount();
    floatingPanel.setOverlayVisible(settings.translationOverlayVisible);
    floatingPanel.setEnabled(settings.floatingButtonEnabled);
    if (settings.progressWidgetEnabled) void progress.mount();
    renderer.setVisible(settings.translationOverlayVisible);
    readerUiMounted = true;
  }

  floatingPanel = new FloatingPanel({
    onRetranslatePage: () => void retranslateVisibleSurfaces(),
    onSelectRegion: () => startManualSelection(),
    onToggleOverlayVisibility: (visible) => void setOverlayVisibility(visible),
  });

  logger.info("content script started", `${location.hostname} | mode=${settings.runMode} | target=${settings.targetLanguage}`);
  scanAndMountControls("load");
  if (shouldAutoTranslate()) void translatePage(false);

  const rescan = debounce((reason: string) => {
    scanAndMountControls(reason);
    if (shouldAutoTranslate()) void translatePage(false);
  }, 600);

  const observerOptions: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-src", "data-original", "style"] };
  const observedShadowRoots = new WeakSet<ShadowRoot>();
  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isUmtOwnedMutation)) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if ("querySelectorAll" in node) observeOpenShadowRoots(node as ParentNode);
      }
    }
    rescan("mutation");
  });
  const observeOpenShadowRoots = (root: ParentNode): void => {
    for (const shadowRoot of findOpenShadowRoots(root)) {
      if (observedShadowRoots.has(shadowRoot)) continue;
      observedShadowRoots.add(shadowRoot);
      observer.observe(shadowRoot, observerOptions);
    }
  };
  observer.observe(document.documentElement, observerOptions);
  observeOpenShadowRoots(document);

  window.addEventListener("scroll", () => refreshControls(), { passive: true });
  window.addEventListener("resize", () => refreshLayout());

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (hasRelevantContentSettingChange(changes)) void reloadSettings();
  });

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!isUmtContentCommand(message)) return false;
    if (message.command === "sampleOcrSelfTest") {
      void sampleOcrSelfTest().then(sendResponse);
      return true;
    }
    if (message.command === "getPageState") {
      sendResponse(pageRuntimeSnapshot());
      return false;
    }
    void (async () => {
      if (message.command === "translate") void translatePage(false);
      if (message.command === "refresh") await resetPageState("popup-refresh", false);
      if (message.command === "togglePause") {
        if (queue.snapshot().paused) { queue.resume(); void translatePage(false); }
        else queue.pause();
        updateProgress();
      }
      if (message.command === "clearPage") await resetPageState("popup-clear", true);
      if (message.command === "selectRegion") startManualSelection();
      if (message.command === "retranslate") void translatePage(true);
      if (message.command === "retranslateVisible") void retranslateVisibleSurfaces();
      if (message.command === "cancelQueue") await cancelCurrentQueue("popup-cancel");
      if (message.command === "setOverlayVisibility") await setOverlayVisibility(message.visible !== false);
      if (message.command === "toggleOverlayVisibility") await toggleOverlayVisibility();
      if (message.command === "applySiteSettings") {
        settings = setSiteSettings(settings, window.location.href, { autoTranslate: message.autoTranslate === true });
        if (message.autoTranslate === true) void translatePage(false);
        else await cancelCurrentQueue("auto-off");
      }
      if (message.command === "applyOverlayAppearance") {
        settings = { ...settings, overlayAppearance: message.appearance ? { ...settings.overlayAppearance, ...message.appearance } : settings.overlayAppearance };
        renderer.setAppearance(settings.overlayAppearance);
      }
      if (message.command === "applyWidgetSettings") {
        if (typeof message.floatingButtonEnabled === "boolean") setFloatingButtonEnabled(message.floatingButtonEnabled);
        if (typeof message.progressWidgetEnabled === "boolean") await setProgressWidgetEnabled(message.progressWidgetEnabled);
      }
      await Promise.resolve();
      sendResponse(pageRuntimeSnapshot());
    })().catch((error) => {
      logger.error("content command failed", error);
      sendResponse({ ok: false, error: "页面操作未完成，请重试或查看运行日志。", state: pageRuntimeSnapshot().state });
    });
    return true;
  });
  return true;
}
