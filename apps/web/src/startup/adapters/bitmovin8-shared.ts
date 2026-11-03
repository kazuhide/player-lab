import {
  LogLevel, PlayerEvent, PlayerType, StreamType,
  type PlayerAPI, type PlayerConfig, type SourceConfig,
} from "bitmovin-player/modules/bitmovinplayer-core";
import {
  DEMO_SDK_VERSIONS, type AdapterMark, type AdapterMetadata, type CreateAdapter,
  type FailureCode, type ProviderSample,
} from "../contract";

type BitmovinPlayer = Pick<PlayerAPI, "on" | "off" | "load" | "play" | "pause" | "seek" | "isLive"
  | "timeShift" | "getTimeShift" | "getMaxTimeShift" | "setVideoElement" | "getVideoElement"
  | "getPlayerType" | "getAudio" | "destroy">;
export interface Bitmovin8Constructor {
  new(container: HTMLElement, configuration: PlayerConfig): BitmovinPlayer;
}
/** The published UMD module can arrive directly or under a bundler's default namespace. */
export function bitmovin8Module(value: unknown): { name: string; module: object } {
  const isDefinition = (candidate: unknown): candidate is { name: string; module: object } => {
    if (!candidate || typeof candidate !== "object" || !("name" in candidate) || !("module" in candidate)) return false;
    return typeof candidate.name === "string" && candidate.name.length > 0
      && (typeof candidate.module === "function" || (typeof candidate.module === "object" && candidate.module !== null));
  };
  if (isDefinition(value)) return value;
  if (value && typeof value === "object" && "default" in value && isDefinition(value.default)) return value.default;
  throw new Error("Invalid Bitmovin module definition.");
}
const cancelled = () => new DOMException("The startup trial was cancelled.", "AbortError");
function code(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("code" in value)) return undefined;
  return typeof value.code === "number" && Number.isSafeInteger(value.code) && value.code >= 0 ? value.code : undefined;
}
function language(value: string | undefined): string | null {
  return value && value.length <= 35 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null;
}

/** Public v8 MSE API; the wrappers register only the selected format's modules. */
export const makeBitmovin8Adapter = (Player: Bitmovin8Constructor, format: "hls" | "dash"): CreateAdapter => async (context) => {
  if (context.signal.aborted) throw cancelled();
  const { video } = context;
  if (video.currentSrc || video.hasAttribute("src") || video.srcObject || video.mediaKeys || video.querySelector("source")) {
    context.fatal("unsupported"); throw new Error("A fresh clear media element is required.");
  }
  const managed: unknown = Reflect.get(globalThis, "ManagedMediaSource");
  if (typeof MediaSource === "undefined" && typeof managed !== "function") {
    context.fatal("unsupported"); throw new Error("Bitmovin MediaSource playback is unavailable.");
  }
  if (context.profile !== "default" && context.profile !== "startup") {
    context.fatal("configuration-rejected"); throw new Error("The startup configuration is unsupported.");
  }
  const playback = { muted: true, autoplay: false, audioLanguage: "en",
    preferredTech: [{ player: PlayerType.Html5, streaming: format === "hls" ? StreamType.Hls : StreamType.Dash }] };
  const buffer = context.profile === "startup" ? {
    audio: { forwardduration: 12, backwardduration: 6 },
    video: { forwardduration: 12, backwardduration: 6 },
  } : undefined;
  const configuration = {
    key: context.licenseKey, playback, ui: false, analytics: false,
    storage: { disableStorageApi: true },
    ...(buffer ? { buffer } : {}),
    ...(context.profile === "startup" ? { logs: { level: LogLevel.OFF, bitmovin: false } } : {}),
  } satisfies PlayerConfig;
  const metadata: AdapterMetadata = {
    engine: "bitmovin-8", name: `Bitmovin Player v8 (${format.toUpperCase()} modular)`, version: DEMO_SDK_VERSIONS["bitmovin-8"],
    readyEvent: PlayerEvent.Ready, playingEvent: PlayerEvent.Playing,
    attachCompletion: "synchronous-return", loadCompletion: "promise",
    configuration: {
      profile: context.profile, modular: true, format,
      modules: ["Core", "EngineBitmovin", "RendererMSE",
        ...(format === "hls" ? ["HLS", "ABR", "ContainerMP4", "ContainerTS"] : ["XML", "DASH", "ABR", "ContainerMP4"])],
      playback: { muted: true, autoplay: false, audioLanguage: "en",
        preferredTech: [{ player: "html5", streaming: format }] },
      ui: false, analytics: false, storage: { disableStorageApi: true },
      ...(buffer ? { buffer: { audio: { ...buffer.audio }, video: { ...buffer.video } } } : {}),
      ...(context.profile === "startup" ? { logs: { level: "off", bitmovin: false } } : {}),
      sourceOptions: { startOffset: 0 }, playbackRate: 1,
    },
    unavailable: {},
    sampleLimitations: {
      mediaEngine: "The public html5 player type proves the MediaSource family, not the per-instance ManagedMediaSource subtype.",
      audioLanguage: "Null until a selected audio track exposes a valid language tag.",
      workerActive: "No public per-instance signal proves worker activation.",
      loadLatencySeconds: "No equivalent provider statistic is exported; load completion uses the common observation clock.",
      timeToFirstFrameSeconds: "Common video-frame callbacks are measured separately from provider events.",
      bandwidthEstimateBps: "No equivalent public bandwidth-estimate statistic is exported.",
    },
  };
  let player: BitmovinPlayer | undefined;
  let disposed = false;
  let failure: Error | undefined;
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let mediaEngine: ProviderSample["mediaEngine"] = "unknown";
  const marked = new Set<AdapterMark>();
  let rejectCancellation!: (reason: Error) => void;
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  void cancellation.catch(() => {});
  const stopped = () => failure ?? cancelled();
  function active() { if (disposed || context.signal.aborted || failure) throw stopped(); }
  function mark(name: AdapterMark) {
    if (!disposed && !context.signal.aborted && !failure && !marked.has(name)) { marked.add(name); context.mark(name); }
  }
  function fail(reason: FailureCode, sdkCode?: number) {
    if (disposed || context.signal.aborted || failure) return;
    failure = new Error(`The startup adapter failed (${reason}).`);
    context.fatal(reason, sdkCode); void dispose().catch(() => {});
  }
  function observeMediaMode(): boolean {
    if (disposed || context.signal.aborted || !player) return false;
    if (player.getVideoElement() !== video || player.getPlayerType() !== PlayerType.Html5) {
      fail("unsupported"); return false;
    }
    mediaEngine = typeof managed === "function" ? "media-source-family" : "media-source";
    return true;
  }
  const onReady = () => { if (observeMediaMode()) mark("sdkReady"); };
  const onPlaying = () => { if (observeMediaMode()) mark("sdkPlaying"); };
  const onError = (event: unknown) => { fail("sdk-error", code(event)); };
  const onAbort = () => { void dispose().catch(() => {}); };
  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true; context.signal.removeEventListener("abort", onAbort); rejectCancellation(stopped());
    disposePromise = (async () => {
      if (!player) return;
      let failed = false;
      for (const [event, listener] of [[PlayerEvent.Ready, onReady], [PlayerEvent.Playing, onPlaying], [PlayerEvent.Error, onError]] as const) {
        try { player.off(event, listener); } catch { failed = true; }
      }
      try { await player.destroy(); } catch { failed = true; }
      if (failed) throw new Error("The startup adapter cleanup failed.");
    })();
    return disposePromise;
  }
  async function runStart(): Promise<void> {
    let stage: FailureCode = "initialization-failed";
    try {
      active(); const owned = player;
      if (!owned) throw stopped();
      video.muted = true; video.defaultMuted = true; video.autoplay = false;
      video.playsInline = true; video.controls = false;
      video.playbackRate = 1; video.defaultPlaybackRate = 1;
      // Public setVideoElement must precede load; its return is not sourceopen.
      mark("attachStart"); owned.setVideoElement(video); active(); mark("attachComplete");
      const source: SourceConfig = { [format]: context.url, options: { startOffset: 0 } };
      stage = "load-failed"; mark("loadStart");
      await Promise.race([owned.load(source, `html5.${format}`), cancellation]);
      active();
      if (!observeMediaMode()) throw stopped();
      mark("loadComplete");
      // Public v8 integration requests play after load resolves. Never preload outside the timed start.
      // https://cdn.bitmovin.com/player/web/8/docs/index.html
      stage = "play-rejected"; mark("playRequest");
      await Promise.race([owned.play(), cancellation]); active(); mark("playResolved");
    } catch (error) {
      if (!disposed && !context.signal.aborted && !failure) fail(stage, code(error));
      throw stopped();
    }
  }
  try {
    mark("constructorStart"); player = new Player(context.container, configuration); mark("constructorEnd");
    player.on(PlayerEvent.Ready, onReady); player.on(PlayerEvent.Playing, onPlaying); player.on(PlayerEvent.Error, onError);
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) { await dispose(); throw cancelled(); }
  } catch (error) {
    if (!disposed && !context.signal.aborted && !failure) fail("initialization-failed", code(error));
    await dispose(); throw stopped();
  }
  return {
    metadata, start() { return startPromise ??= runStart(); },
    sample(): ProviderSample {
      return { mediaEngine: disposed ? "unknown" : mediaEngine,
        audioLanguage: disposed ? null : language(player?.getAudio()?.lang), workerActive: null,
        loadLatencySeconds: null, timeToFirstFrameSeconds: null, bandwidthEstimateBps: null };
    },
    playback: {
      play() { active(); return player!.play(); },
      pause() { if (!disposed && !context.signal.aborted && !failure) player?.pause(); },
      seek(seconds) {
        active(); const owned = player!;
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid playback target.");
        if (owned.isLive()) {
          const shift = seconds - video.currentTime + owned.getTimeShift();
          const minimum = owned.getMaxTimeShift();
          if (!Number.isFinite(shift) || !Number.isFinite(minimum) || minimum > 0 || shift < minimum || shift > 0) throw new Error("Invalid playback target.");
          owned.timeShift(shift);
        } else if (!owned.seek(seconds)) throw new Error("The playback target was rejected.");
      },
    },
    dispose,
  };
};
