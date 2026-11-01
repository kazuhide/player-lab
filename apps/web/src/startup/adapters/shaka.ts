import shaka from "shaka-player/dist/shaka-player.hls-es2021.js";
import {
  SDK_VERSIONS, type AdapterMark, type AdapterMetadata, type CreateAdapter,
  type FailureCode, type ProviderSample,
} from "../contract";

const cancelledError = () => new DOMException("The startup trial was cancelled.", "AbortError");
const finite = (value: number): number | null => Number.isFinite(value) && value >= 0 ? value : null;
function language(value: string | null | undefined): string | null {
  return value && value.length <= 35 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null;
}
function errorCode(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("code" in value)) return undefined;
  return typeof value.code === "number" && Number.isSafeInteger(value.code) && value.code >= 0 ? value.code : undefined;
}

export const createAdapter: CreateAdapter = async (context) => {
  if (context.signal.aborted) throw cancelledError();
  const { video } = context;
  if (video.currentSrc || video.hasAttribute("src") || video.srcObject || video.mediaKeys || video.querySelector("source")) {
    context.fatal("unsupported");
    throw new Error("A fresh clear media element is required.");
  }
  shaka.polyfill.installAll();
  const managed: unknown = Reflect.get(globalThis, "ManagedMediaSource");
  if (!shaka.Player.isBrowserSupported()
      || (typeof MediaSource === "undefined" && typeof managed !== "function")) {
    context.fatal("unsupported");
    throw new Error("Shaka MediaSource playback is unavailable.");
  }
  const prefetch = context.tuning?.shakaPrefetchLimit;
  if ((context.profile !== "default" && context.profile !== "startup")
      || (prefetch !== undefined && prefetch !== 0 && prefetch !== 1 && prefetch !== 2)) {
    context.fatal("configuration-rejected");
    throw new Error("The startup configuration is unsupported.");
  }
  const configuration = {
    preferredAudio: [{ language: "en", role: "", label: "", channelCount: 2, codec: "", spatialAudio: false }],
    streaming: {
      preferNativeHls: false, fallbackToNativeHlsOnMseError: false,
      useNativeHlsForFairPlay: false, lowLatencyMode: false,
      ...(context.profile === "startup" ? { bufferingGoal: 12, bufferBehind: 6, rebufferingGoal: 0 } : {}),
      ...(prefetch === undefined ? {} : { segmentPrefetchLimit: prefetch }),
    },
    cmcd: { enabled: false }, cmsd: { enabled: false },
    ads: { disableHLSInterstitial: true, disableDASHInterstitial: true, disableSVTA: true },
  } satisfies {
    preferredAudio: shaka.extern.PlayerConfiguration["preferredAudio"];
    streaming: Partial<shaka.extern.StreamingConfiguration>;
    cmcd: Partial<shaka.extern.CmcdConfiguration>;
    cmsd: Partial<shaka.extern.CmsdConfiguration>;
    ads: Partial<shaka.extern.AdsConfiguration>;
  };
  const metadata: AdapterMetadata = {
    engine: "shaka", name: "Shaka Player (HLS ES2021)", version: SDK_VERSIONS.shaka,
    readyEvent: "loaded", playingEvent: null,
    attachCompletion: "promise-resolution", loadCompletion: "promise",
    // Snapshot only these primitive settings before passing a separate object
    // to the SDK; runtime mutation cannot turn exported settings into SDK data.
    configuration: {
      preferredAudio: configuration.preferredAudio.map((preference) => ({ ...preference })),
      streaming: { ...configuration.streaming }, cmcd: { ...configuration.cmcd },
      cmsd: { ...configuration.cmsd }, ads: { ...configuration.ads },
    },
    sampleLimitations: {
      mediaEngine: "The public load mode proves the MediaSource family. If ManagedMediaSource is available, its per-instance subtype is not publicly observable.",
      audioLanguage: "Null until an active variant exposes a valid audio language tag.",
      workerActive: "No public per-instance signal proves a transmuxer worker was activated.",
      loadLatencySeconds: "SDK seconds from its load clock to loadedmetadata, not selection-to-play; non-finite or negative values are unavailable.",
      timeToFirstFrameSeconds: "SDK seconds to its own video-frame callback or loadeddata fallback, not the common callback-observation clock; non-finite or negative values are unavailable.",
      bandwidthEstimateBps: "The SDK bandwidth estimate is in bits per second; non-finite or negative values are unavailable.",
    },
    unavailable: {
      sdkPlaying: "Shaka has no ordinary SDK Playing event; started is a progress event, not native playing.",
    },
  };

  let player: shaka.Player | undefined;
  let disposed = false;
  let failure: Error | undefined;
  let mediaEngine: ProviderSample["mediaEngine"] = "unknown";
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  const marks = new Set<AdapterMark>();
  let rejectCancellation!: (reason: Error) => void;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
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
  function fail(code: FailureCode, sdkCode?: number) {
    if (disposed || failure || context.signal.aborted) return;
    failure = new Error(`The startup adapter failed (${code}).`);
    context.fatal(code, sdkCode);
    void dispose().catch(() => {});
  }
  function observeMediaMode(): boolean {
    if (disposed || context.signal.aborted || !player) return false;
    if (player.getMediaElement() !== video || player.getLoadMode() !== shaka.Player.LoadMode.MEDIA_SOURCE) {
      fail("unsupported"); return false;
    }
    // This public mode establishes the MediaSource family, not a native src= route.
    mediaEngine = typeof managed === "function" ? "media-source-family" : "media-source";
    return true;
  }
  const onStreaming = () => { observeMediaMode(); };
  const onReady = () => { if (observeMediaMode()) mark("sdkReady"); };
  const onError = (event: Event) => {
    const detail: unknown = "detail" in event ? event.detail : undefined;
    if (detail && typeof detail === "object" && "severity" in detail
        && detail.severity === shaka.util.Error.Severity.CRITICAL) fail("sdk-error", errorCode(detail));
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
          player.removeEventListener("streaming", onStreaming);
          player.removeEventListener("loaded", onReady);
          player.removeEventListener("error", onError);
        } finally {
          await player.destroy();
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
      mark("attachStart");
      await Promise.race([active.attach(video), cancellation]);
      ensureActive(); mark("attachComplete");
      // A sourceopen-complete fresh MSE attachment has selected its owned blob.
      // Refuse a missing-src/native-only path before the concurrent play request.
      if (!video.currentSrc.startsWith("blob:")) { fail("unsupported"); throw stoppedError(); }
      stage = "load-failed";
      mark("loadStart");
      const loading = active.load(context.url, 0, "application/x-mpegurl").then(() => {
        ensureActive();
        if (!observeMediaMode()) throw stoppedError();
        mark("loadComplete");
      }, (error: unknown) => {
        if (!disposed && !context.signal.aborted) fail("load-failed", errorCode(error));
        throw stoppedError();
      });
      // A synchronous fatal event can dispose the player while load() returns.
      // Keep its pending promise observed even when no play request is issued.
      void loading.catch(() => {});
      ensureActive();
      // Attach, rather than load completion or the progress event started,
      // is the earliest supported gate for this fresh clear MSE element.
      stage = "play-rejected";
      mark("playRequest");
      let playRequest: Promise<void>;
      try { playRequest = video.play(); } catch { playRequest = Promise.reject(new Error("The native play request failed.")); }
      const playing = playRequest.then(() => { ensureActive(); mark("playResolved"); }, () => {
        if (!disposed && !context.signal.aborted) fail("play-rejected");
        throw stoppedError();
      });
      await Promise.race([Promise.all([loading, playing]), cancellation]);
    } catch {
      if (!disposed && !context.signal.aborted) fail(stage);
      throw stoppedError();
    }
  }

  try {
    mark("constructorStart"); player = new shaka.Player(); mark("constructorEnd");
    player.addEventListener("streaming", onStreaming);
    player.addEventListener("loaded", onReady);
    player.addEventListener("error", onError);
    // configure(false) may already have applied valid fields. Never run that
    // partially accepted candidate or try to turn it into a default trial.
    let accepted = false;
    try { accepted = player.configure(configuration); } catch { /* Rejected configuration is handled below. */ }
    if (!accepted) { fail("configuration-rejected"); await dispose(); throw stoppedError(); }
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
      const stats = player.getStats();
      const audio = player.getVariantTracks().find((track) => track.active);
      return {
        mediaEngine, audioLanguage: language(audio?.audioLanguage ?? audio?.language),
        // No per-instance public signal proves a transmuxer worker was activated.
        workerActive: null, loadLatencySeconds: finite(stats.loadLatency),
        timeToFirstFrameSeconds: finite(stats.timeToFirstFrame),
        bandwidthEstimateBps: finite(stats.estimatedBandwidth),
      };
    },
    dispose,
  };
};
