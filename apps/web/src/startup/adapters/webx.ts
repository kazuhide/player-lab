import { Player } from "@bitmovin/player-web-x/bundles/playerx-hls";
import {
  SDK_VERSIONS,
  type AdapterMark,
  type AdapterMetadata,
  type CreateAdapter,
  type FailureCode,
} from "../contract";

type NativePlayer = ReturnType<typeof Player>;
type NativeSource = ReturnType<NativePlayer["sources"]["add"]>;

const failureError = (code: FailureCode): Error => new Error(`Web X startup failed (${code}).`);

/** Native Source/Playback API, without the separate v8 compatibility layer. */
export const createAdapter: CreateAdapter = async (context) => {
  const { video, container, signal } = context;
  if (signal.aborted) {
    context.fatal("aborted");
    throw failureError("aborted");
  }
  const loadControl = context.profile === "startup" ? context.tuning?.webXLoadControl ?? 2 : 2;
  if (loadControl !== 0 && loadControl !== 1 && loadControl !== 2) {
    context.fatal("configuration-rejected");
    throw failureError("configuration-rejected");
  }

  const metadata: AdapterMetadata = {
    engine: "web-x",
    name: "Bitmovin Player Web X",
    version: SDK_VERSIONS["web-x"],
    readyEvent: "ready",
    playingEvent: "playing",
    loadCompletion: "unavailable",
    attachCompletion: "event",
    configuration: {
      profile: context.profile,
      bundle: "playerx-hls",
      muted: true,
      autoplay: false,
      preventSeeking: false,
      playsInline: true,
      controls: false,
      startTimeSeconds: 0,
      playbackRate: 1,
      defaultLogLevel: context.profile === "startup" ? 0 : null,
      logLevelPolicy: context.profile === "startup" ? "explicit Off" : "SDK default",
      sourceType: "hls",
      contentType: "content",
      stagingAttach: false,
      stagingLoadControl: 0,
      startLoadControl: loadControl,
      optionalAnalytics: false,
      optionalAdvertising: false,
      optionalUI: false,
    },
    unavailable: {
      loadComplete: "The native Source API has no load-completion promise; Ready is a separate media-state event.",
      ...(loadControl === 0 ? { loadStart: "LoadControl.Nothing requests neither manifests nor segments." } : {}),
    },
  };

  let player: NativePlayer | undefined;
  let source: NativeSource | undefined;
  let closed = false;
  let failure: FailureCode | undefined;
  let disposal: Promise<void> | undefined;
  let started: Promise<void> | undefined;
  let rejectStart: ((reason: Error) => void) | undefined;
  const removeListeners: Array<() => void> = [];
  const observed = new Set<AdapterMark>();
  const active = (): boolean => !closed && !failure && !signal.aborted;
  const mark = (name: AdapterMark): void => {
    if (!active() || observed.has(name)) return;
    observed.add(name);
    context.mark(name);
  };
  const fail = (code: FailureCode): void => {
    if (closed || failure) return;
    failure = code;
    context.fatal(code);
    rejectStart?.(failureError(code));
  };
  const dispose = (): Promise<void> => {
    if (!disposal) {
      closed = true;
      signal.removeEventListener("abort", onAbort);
      rejectStart?.(failureError(failure ?? "aborted"));
      // Keep one acknowledged cleanup promise, including partial initialization.
      disposal = Promise.resolve().then(async () => {
        let cleanupFailed = false;
        for (const remove of removeListeners.splice(0)) {
          try { remove(); } catch { cleanupFailed = true; }
        }
        try { await player?.dispose(); } catch { cleanupFailed = true; }
        if (cleanupFailed) throw failureError("cleanup-failed");
      });
    }
    return disposal;
  };
  function onAbort(): void {
    fail("aborted");
    // The owner awaits the same promise in dispose; this prevents an unhandled rejection.
    void dispose().catch(() => {});
  }

  try {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.controls = false;
    video.playbackRate = 1;
    mark("constructorStart");
    if (signal.aborted) throw failureError("aborted");
    player = Player({
      key: context.licenseKey,
      defaultContainer: container,
      defaultVideoElement: video,
      playback: { muted: true, autoplay: false, preventSeeking: false },
      ...(context.profile === "startup" ? { defaultLogLevel: 0 } : {}),
    });
    mark("constructorEnd");
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) throw failureError("aborted");

    const onError = (): void => fail("sdk-error");
    const onSourceError = (event: { sourceId: string }): void => {
      if (!source || event.sourceId === source.id) fail("sdk-error");
    };
    const onAttached = (event: { sourceId: string; videoElement: HTMLVideoElement }): void => {
      if (source && event.sourceId === source.id && event.videoElement === video) mark("attachComplete");
    };
    const ownedPlayer = player;
    removeListeners.push(() => ownedPlayer.events.off(ownedPlayer.events.Type.PlayerError, onError));
    player.events.on(player.events.Type.PlayerError, onError);
    removeListeners.push(() => ownedPlayer.events.off(ownedPlayer.events.Type.SourceError, onSourceError));
    player.events.on(player.events.Type.SourceError, onSourceError);
    removeListeners.push(() => ownedPlayer.events.off(ownedPlayer.events.Type.VideoAttached, onAttached));
    player.events.on(player.events.Type.VideoAttached, onAttached);

    // Stage before data loading so all source observers exist before attachment.
    // https://developer.bitmovin.com/playback/docs/load-control
    source = player.sources.add({
      resources: [{ url: context.url, type: "hls" }],
      contentType: "content",
    }, { attach: false, loadControl: 0 });
    source.currentTime = 0;
    source.playbackRate = 1;
    const ownedSource = source;
    const onReady = (): void => mark("sdkReady");
    const onPlaying = (): void => mark("sdkPlaying");
    removeListeners.push(() => ownedSource.events.off(ownedSource.events.Type.Ready, onReady));
    source.events.on(source.events.Type.Ready, onReady);
    removeListeners.push(() => ownedSource.events.off(ownedSource.events.Type.Playing, onPlaying));
    source.events.on(source.events.Type.Playing, onPlaying);
    if (failure || signal.aborted) throw failureError(failure ?? "aborted");
  } catch {
    const code = failure ?? (signal.aborted ? "aborted" : "initialization-failed");
    fail(code);
    await dispose();
    throw failureError(code);
  }

  const ownedPlayer = player;
  const ownedSource = source;
  return {
    metadata,
    start() {
      if (started) return started;
      if (!active()) return Promise.reject(failureError(failure ?? "aborted"));
      started = new Promise<void>((resolve, reject) => {
        rejectStart = reject;
        let stage: FailureCode = "load-failed";
        try {
          mark("attachStart");
          ownedPlayer.sources.attachVideo(ownedSource, { video, container });
          if (!active()) throw failureError(failure ?? "aborted");
          if (loadControl !== 0) mark("loadStart");
          ownedSource.loadControl = loadControl;
          if (!active()) throw failureError(failure ?? "aborted");
          stage = "play-rejected";
          mark("playRequest");
          // Do not wait for Ready or a nonexistent load promise before requesting play.
          // https://developer.bitmovin.com/playback/docs/sourceapi-playbackapi
          void ownedSource.play().then(() => {
            if (!active()) { reject(failureError(failure ?? "aborted")); return; }
            mark("playResolved");
            resolve();
          }, () => {
            fail("play-rejected");
            reject(failureError(failure ?? "aborted"));
          });
        } catch {
          fail(stage);
          reject(failureError(failure ?? stage));
        }
      });
      return started;
    },
    sample: () => ({
      mediaEngine: "unknown",
      audioLanguage: null,
      workerActive: null,
      loadLatencySeconds: null,
      timeToFirstFrameSeconds: null,
      bandwidthEstimateBps: null,
    }),
    dispose,
  };
};
