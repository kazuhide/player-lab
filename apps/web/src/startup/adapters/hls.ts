import Hls, { type ErrorData, type HlsConfig, type MediaAttachedData } from "hls.js";
import workerURL from "hls.js/dist/hls.worker.js?url";
import {
  SDK_VERSIONS, type AdapterMark, type AdapterMetadata, type CreateAdapter,
  type FailureCode, type ProviderSample,
} from "../contract";

const cancelledError = () => new DOMException("The startup trial was cancelled.", "AbortError");
const finite = (value: number): number | null => Number.isFinite(value) && value >= 0 ? value : null;
function language(value: string | undefined): string | null {
  return value && value.length <= 35 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null;
}

export const createAdapter: CreateAdapter = async (context) => {
  if (context.signal.aborted) throw cancelledError();
  const { video } = context;
  if (video.currentSrc || video.hasAttribute("src") || video.srcObject || video.mediaKeys || video.querySelector("source")) {
    context.fatal("unsupported");
    throw new Error("A fresh clear media element is required.");
  }
  if (!Hls.isSupported()) {
    context.fatal("unsupported");
    throw new Error("hls.js MediaSource playback is unavailable.");
  }
  if ((context.profile !== "default" && context.profile !== "startup")
      || (context.tuning?.hlsWorker !== undefined && typeof context.tuning.hlsWorker !== "boolean")) {
    context.fatal("configuration-rejected");
    throw new Error("The startup configuration is unsupported.");
  }

  const configuration = {
    debug: false, autoStartLoad: true, startPosition: 0,
    audioPreference: { lang: "en" }, preferManagedMediaSource: false,
    enableWorker: context.tuning?.hlsWorker ?? true, workerPath: workerURL,
    lowLatencyMode: false, enableInterstitialPlayback: false,
    ...(context.profile === "startup" ? {
      maxBufferLength: 12, maxMaxBufferLength: 12, backBufferLength: 6,
      frontBufferFlushThreshold: 12,
    } : {}),
  } satisfies Partial<HlsConfig>;
  // The worker's generated URL belongs to the build, not exported trial data.
  const { workerPath: _workerPath, ...publicConfiguration } = configuration;
  const metadata: AdapterMetadata = {
    engine: "hls", name: "hls.js (full ESM)", version: SDK_VERSIONS.hls,
    readyEvent: Hls.Events.MANIFEST_PARSED, playingEvent: null,
    attachCompletion: "synchronous-return", loadCompletion: "unavailable",
    configuration: { ...publicConfiguration, audioPreference: { ...publicConfiguration.audioPreference } },
    sampleLimitations: {
      mediaEngine: "The actual MediaSource is known only after the owned hlsMediaAttached event.",
      audioLanguage: "Null until an active audio track exposes a valid language tag.",
      workerActive: "No public per-instance signal proves worker activation; enableWorker is only configuration.",
      loadLatencySeconds: "hls.js has no equivalent public loadLatency statistic.",
      timeToFirstFrameSeconds: "hls.js has no equivalent public timeToFirstFrame statistic; common video-frame observation is separate.",
      bandwidthEstimateBps: "The SDK estimate can begin with a prior; non-finite or negative values are unavailable.",
    },
    unavailable: {
      loadComplete: "hls.js has no load-completion promise; manifest parsing is a separate event.",
      sdkPlaying: "hls.js has no ordinary SDK Playing event; native video playing is observed separately.",
    },
  };

  let player: Hls | undefined;
  let disposed = false;
  let failure: Error | undefined;
  let mediaEngine: ProviderSample["mediaEngine"] = "unknown";
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  const marks = new Set<AdapterMark>();
  let rejectCancellation!: (reason: Error) => void;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  // A session may be disposed before start(), without creating an unhandled rejection.
  void cancellation.catch(() => {});
  const stoppedError = () => failure ?? cancelledError();
  function mark(name: AdapterMark) {
    if (!disposed && !context.signal.aborted && !marks.has(name)) {
      marks.add(name); context.mark(name);
    }
  }
  function ensureActive() {
    if (disposed || context.signal.aborted) throw stoppedError();
  }
  function fail(code: FailureCode) {
    if (disposed || failure || context.signal.aborted) return;
    failure = new Error(`The startup adapter failed (${code}).`);
    context.fatal(code);
    void dispose().catch(() => {});
  }
  const onReady = () => { mark("sdkReady"); };
  const onError = (_event: unknown, data: ErrorData) => {
    if (data.fatal) fail("sdk-error");
  };
  const onAttached = (_event: unknown, data: MediaAttachedData) => {
    if (disposed || context.signal.aborted) return;
    const source = data.mediaSource;
    const managed: unknown = Reflect.get(globalThis, "ManagedMediaSource");
    if (data.media !== video || !source) { fail("unsupported"); return; }
    if (typeof managed === "function" && source instanceof managed) {
      mediaEngine = "managed-media-source";
    } else if (typeof MediaSource !== "undefined" && source instanceof MediaSource) {
      mediaEngine = "media-source";
    } else {
      const webkit: unknown = Reflect.get(globalThis, "WebKitMediaSource");
      if (typeof webkit === "function" && source instanceof webkit) mediaEngine = "media-source";
      else fail("unsupported");
    }
  };
  const onAbort = () => { void dispose().catch(() => {}); };

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    context.signal.removeEventListener("abort", onAbort);
    rejectCancellation(stoppedError());
    disposePromise = (async () => {
      if (!player) return;
      try {
        try {
          player.off(Hls.Events.MEDIA_ATTACHED, onAttached);
          player.off(Hls.Events.MANIFEST_PARSED, onReady);
          player.off(Hls.Events.ERROR, onError);
        } finally {
          player.destroy();
        }
      } catch {
        throw new Error("The startup adapter cleanup failed.");
      }
    })();
    return disposePromise;
  }

  async function runStart(): Promise<void> {
    let stage: FailureCode = "initialization-failed";
    try {
      ensureActive();
      const active = player;
      if (!active) throw new Error("The startup player is unavailable.");
      video.muted = true; video.defaultMuted = true; video.autoplay = false;
      video.playsInline = true; video.playbackRate = 1; video.defaultPlaybackRate = 1; video.currentTime = 0;
      mark("attachStart"); active.attachMedia(video); ensureActive(); mark("attachComplete");
      stage = "load-failed";
      mark("loadStart"); active.loadSource(context.url); ensureActive();
      // A fresh clear MSE attachment assigns its source synchronously. Neither
      // MEDIA_ATTACHED nor MANIFEST_PARSED is an extra gate before native play.
      stage = "play-rejected";
      mark("playRequest");
      const playing = video.play().then(() => { ensureActive(); mark("playResolved"); });
      await Promise.race([playing, cancellation]);
    } catch {
      if (!disposed && !context.signal.aborted) fail(stage);
      throw stoppedError();
    }
  }

  try {
    mark("constructorStart"); player = new Hls(configuration); mark("constructorEnd");
    player.on(Hls.Events.MEDIA_ATTACHED, onAttached);
    player.on(Hls.Events.MANIFEST_PARSED, onReady);
    player.on(Hls.Events.ERROR, onError);
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) { await dispose(); throw cancelledError(); }
  } catch {
    if (!disposed && !context.signal.aborted) fail("initialization-failed");
    await dispose(); throw stoppedError();
  }

  return {
    metadata,
    start() { return startPromise ??= runStart(); },
    sample(): ProviderSample {
      if (disposed || !player) return {
        mediaEngine: "unknown", audioLanguage: null, workerActive: null,
        loadLatencySeconds: null, timeToFirstFrameSeconds: null, bandwidthEstimateBps: null,
      };
      return {
        mediaEngine, audioLanguage: language(player.audioTracks[player.audioTrack]?.lang),
        // enableWorker describes intent; it does not prove successful worker activation.
        workerActive: null, loadLatencySeconds: null, timeToFirstFrameSeconds: null,
        bandwidthEstimateBps: finite(player.bandwidthEstimate),
      };
    },
    dispose,
  };
};
