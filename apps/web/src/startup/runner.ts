import type {
  AdapterMark, AdapterMetadata, AdapterSession, CreateAdapter, EngineId,
  FailureCode, ProviderSample, StartupProfile, StartupTuning,
} from "./contract";

export type BrowserMark = AdapterMark | "sdkImportStart" | "sdkImportEnd"
  | "loadedData" | "nativePlaying" | "firstFrame" | "firstMovingFrame" | "advanced";
export type BrowserMarks = Partial<Record<BrowserMark, number>>;

export interface BrowserTrial {
  status: "success" | "failure" | "cancelled";
  failureCode: FailureCode | null;
  sdkCode: number | null;
  marks: BrowserMarks;
  metadata: AdapterMetadata | null;
  sample: ProviderSample | null;
  frameCallbackAvailable: boolean;
  video: { width: number; height: number; advancedSeconds: number; droppedFrames: number | null; totalFrames: number | null } | null;
  resources: { count: number; observedTransferBytes: number; zeroTransferSizeCount: number } | null;
  longTasks: { count: number; durationMs: number } | null;
  javascriptHeapDeltaBytes: number | null;
  cleanupMs: number | null;
}

/** Retain a failed document/protocol attempt without inventing observations. */
export function unavailableTrial(code: FailureCode): BrowserTrial {
  return { status: code === "aborted" ? "cancelled" : "failure", failureCode: code,
    sdkCode: null, marks: {}, metadata: null, sample: null, frameCallbackAvailable: false,
    video: null, resources: null, longTasks: null, javascriptHeapDeltaBytes: null, cleanupMs: null };
}

const epochNow = () => performance.timeOrigin + performance.now();
const engineImports: Record<EngineId, () => Promise<{ createAdapter: CreateAdapter }>> = {
  "web-x": () => import("./adapters/webx"),
  hls: () => import("./adapters/hls"),
  shaka: () => import("./adapters/shaka"),
};

/** Preload only the requested SDK in this fresh document, never a player or media. */
export async function preloadEngine(engine: EngineId): Promise<{ start: number; end: number }> {
  const start = epochNow();
  await engineImports[engine]();
  return { start, end: epochNow() };
}

function heapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  const value = memory?.usedJSHeapSize;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One visible, fresh-document trial. The parent owns final document teardown. */
export async function runBrowserTrial(options: {
  engine: EngineId; video: HTMLVideoElement; container: HTMLElement; url: string;
  licenseKey: string; profile: StartupProfile; tuning?: StartupTuning;
  selectedAt: number; signal: AbortSignal; preloaded?: { start: number; end: number };
}): Promise<BrowserTrial> {
  const { video, signal, selectedAt } = options;
  const marks: BrowserMarks = {};
  const controller = new AbortController();
  const heapBefore = heapBytes();
  let active = true;
  let finished = false;
  let session: AdapterSession | null = null;
  let sdkCode: number | null = null;
  let firstMediaTime: number | null = null;
  let frameHandle: number | null = null;
  const frameCallbackAvailable = typeof video.requestVideoFrameCallback === "function";
  const longTasks: { count: number; durationMs: number } = { count: 0, durationMs: 0 };
  let longTaskObserver: PerformanceObserver | null = null;
  const listeners: [string, EventListener][] = [];
  const record = (name: BrowserMark, epoch = epochNow()) => {
    if (active && marks[name] === undefined) marks[name] = epoch - selectedAt;
  };
  let complete!: (failure: FailureCode | null) => void;
  const terminal = new Promise<FailureCode | null>((resolve) => {
    complete = (failure) => { if (!finished) { finished = true; resolve(failure); } };
  });
  const abort = () => { controller.abort(); complete("aborted"); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const deadline = window.setTimeout(() => { controller.abort(); complete("deadline"); }, 30_000);
  const listen = (event: string, callback: () => void) => {
    const listener: EventListener = callback;
    listeners.push([event, listener]);
    video.addEventListener(event, listener);
  };
  listen("loadeddata", () => record("loadedData"));
  listen("playing", () => record("nativePlaying"));
  listen("error", () => complete("media-error"));
  const checkAdvancement = () => {
    if (finished || marks.nativePlaying === undefined || video.paused || video.ended
      || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    if (video.currentTime >= 0.1) {
      record("advanced");
      // A browser without rVFC can still prove playing and advancing. Its frame
      // timing remains absent; loadeddata is never used as a frame substitute.
      if (session && (!frameCallbackAvailable || marks.firstMovingFrame !== undefined)) complete(null);
    }
  };
  const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    if (!active || finished) return;
    const epoch = performance.timeOrigin + metadata.presentationTime;
    record("firstFrame", epoch);
    if (firstMediaTime === null) firstMediaTime = metadata.mediaTime;
    if (metadata.mediaTime > firstMediaTime + 0.01) record("firstMovingFrame", epoch);
    checkAdvancement();
    if (!finished) frameHandle = video.requestVideoFrameCallback(frame);
  };
  if (frameCallbackAvailable && !finished) frameHandle = video.requestVideoFrameCallback(frame);
  const advancement = window.setInterval(checkAdvancement, 50);
  if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (performance.timeOrigin + entry.startTime >= selectedAt) {
          longTasks.count += 1;
          longTasks.durationMs += entry.duration;
        }
      }
    });
    longTaskObserver.observe({ type: "longtask" });
  }
  const creation = (async () => {
    if (finished) return;
    if (options.preloaded) {
      record("sdkImportStart", options.preloaded.start);
      record("sdkImportEnd", options.preloaded.end);
    } else record("sdkImportStart");
    const { createAdapter } = await engineImports[options.engine]();
    if (!options.preloaded) record("sdkImportEnd");
    if (finished) return;
    const created = await createAdapter({
      ...options, signal: controller.signal,
      mark: (name) => record(name),
      fatal: (code, providerCode) => {
        if (!active || finished) return;
        sdkCode = typeof providerCode === "number" && Number.isFinite(providerCode) ? providerCode : null;
        complete(code);
      },
    });
    if (finished) { await created.dispose(); return; }
    session = created;
    void created.start().catch(() => { if (!finished) complete("load-failed"); });
  })().catch(() => { if (!finished) complete("initialization-failed"); });

  let failure = await terminal;
  active = false;
  window.clearTimeout(deadline);
  window.clearInterval(advancement);
  signal.removeEventListener("abort", abort);
  for (const [event, listener] of listeners) video.removeEventListener(event, listener);
  if (frameHandle !== null) video.cancelVideoFrameCallback(frameHandle);
  longTaskObserver?.disconnect();
  const captured = session as AdapterSession | null;
  let sample: ProviderSample | null = null;
  try { sample = captured?.sample() ?? null; } catch { if (!failure) failure = "invalid-playback"; }
  const quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
  const videoSnapshot = {
    width: video.videoWidth, height: video.videoHeight, advancedSeconds: video.currentTime,
    droppedFrames: quality?.droppedVideoFrames ?? null, totalFrames: quality?.totalVideoFrames ?? null,
  };
  const resources = performance.getEntriesByType("resource").filter((entry) =>
    performance.timeOrigin + entry.startTime >= selectedAt) as PerformanceResourceTiming[];
  const heapAfter = heapBytes();
  const cleanupStart = performance.now();
  controller.abort();
  let cleanupDeadline: number | undefined;
  try {
    await Promise.race([
      captured ? captured.dispose() : creation,
      new Promise<never>((_, reject) => {
        cleanupDeadline = window.setTimeout(() => reject(new Error("cleanup")), 5_000);
      }),
    ]);
  } catch { failure = "cleanup-failed"; }
  finally { window.clearTimeout(cleanupDeadline); }
  return {
    status: failure === "aborted" ? "cancelled" : failure ? "failure" : "success",
    failureCode: failure, sdkCode, marks, metadata: captured?.metadata ?? null, sample,
    frameCallbackAvailable, video: videoSnapshot,
    resources: {
      count: resources.length,
      observedTransferBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
      zeroTransferSizeCount: resources.filter((entry) => entry.transferSize === 0).length,
    },
    longTasks: longTaskObserver ? longTasks : null,
    javascriptHeapDeltaBytes: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
    cleanupMs: performance.now() - cleanupStart,
  };
}
