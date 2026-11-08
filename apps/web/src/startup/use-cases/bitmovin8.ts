import {
  LogLevel, Player, PlayerEvent, PlayerType, StreamType, TimelineReferencePoint,
  type PlayerAPI, type PlayerConfig, type SourceConfig,
} from "bitmovin-player/modules/bitmovinplayer-core";
import Engine from "bitmovin-player/modules/bitmovinplayer-engine-bitmovin";
import Renderer from "bitmovin-player/modules/bitmovinplayer-mserenderer";
import Hls from "bitmovin-player/modules/bitmovinplayer-hls";
import Xml from "bitmovin-player/modules/bitmovinplayer-xml";
import Dash from "bitmovin-player/modules/bitmovinplayer-dash";
import Abr from "bitmovin-player/modules/bitmovinplayer-abr";
import Mp4 from "bitmovin-player/modules/bitmovinplayer-container-mp4";
import Ts from "bitmovin-player/modules/bitmovinplayer-container-ts";
import { bitmovin8Module } from "../adapters/bitmovin8-shared";
import {
  observedBuffer, type CreateUseCaseDriver, type PreparationPolicy, type UseCaseSource,
} from "./contracts";
import {
  abortable, cancelled, createOwnedVideo, createStage, releaseOwnedVideo, showOwnedVideo,
  supportsDecodedPreparation, waitForBuffer, waitForDecodedFrame,
} from "./hls-v8-shared";

const registered = new Set<string>();
function registerModules(format: UseCaseSource["format"]): void {
  for (const value of [Engine, Renderer, Abr, Mp4, ...(format === "hls" ? [Hls, Ts] : [Xml, Dash])]) {
    const module = bitmovin8Module(value);
    if (!registered.has(module.name)) { Player.addModule(module); registered.add(module.name); }
  }
}

interface Entry {
  readonly source: UseCaseSource;
  readonly controller: AbortController;
  readonly preparationController: AbortController;
  promoted: boolean;
  foreground: boolean;
  closed: boolean;
  failure?: Error;
  video?: HTMLVideoElement;
  mount?: HTMLElement;
  player?: PlayerAPI;
  pendingObserver?: (video: HTMLVideoElement) => void;
  initialization?: Promise<void>;
  metadata?: Promise<void>;
  decoded?: Promise<void>;
  preparation?: Promise<void>;
  cleanup?: Promise<void>;
}

/** Modular public v8 APIs; preloading uses the real owned per-source player. */
export const createDriver: CreateUseCaseDriver = async (options) => {
  if (options.signal.aborted) throw cancelled();
  const managed: unknown = Reflect.get(globalThis, "ManagedMediaSource");
  if (typeof MediaSource === "undefined" && typeof managed !== "function") throw new Error("Bitmovin MediaSource playback is unavailable.");
  const supportedPolicies: PreparationPolicy[] = ["on-demand", "metadata", "segments"];
  if (supportsDecodedPreparation()) supportedPolicies.push("decoded");
  if (!supportedPolicies.includes(options.policy)) throw new Error("Decoded preparation requires video-frame callbacks.");
  const stage = createStage(options.container);
  const entries = new Map<string, Entry>();
  let disposed = false;
  let activation = 0;
  let disposal: Promise<void> | undefined;
  const preload = options.policy !== "metadata";
  const buffer = {
    audio: { forwardduration: options.bufferSeconds, backwardduration: 6 },
    video: { forwardduration: options.bufferSeconds, backwardduration: 6 },
  };

  function ensure(entry?: Entry): void {
    if (entry?.failure) throw entry.failure;
    if (disposed || options.signal.aborted || entry?.closed || entry?.controller.signal.aborted) throw cancelled();
  }
  function fail(entry: Entry): void {
    if (entry.failure || entry.closed || disposed || options.signal.aborted) return;
    entry.failure = new Error("The Bitmovin v8 use-case source failed.");
    options.event("error", entry.source.id); entry.controller.abort();
    void cleanup(entry).catch(() => {});
  }
  function pause(entry: Entry): void {
    if (entry.closed) return;
    entry.player?.pause(); entry.video?.pause();
  }
  function initialize(entry: Entry, observeVideo?: (video: HTMLVideoElement) => void): Promise<void> {
    // An activation must join preparation without losing its video observer
    // when the preparation call already memoized the initialization promise.
    if (observeVideo) entry.pendingObserver = observeVideo;
    return entry.initialization ??= Promise.resolve().then(() => {
      ensure(entry); registerModules(entry.source.format);
      const { mount, video } = createOwnedVideo(stage);
      entry.mount = mount; entry.video = video;
      showOwnedVideo(mount, entry.foreground);
      const observer = entry.pendingObserver; delete entry.pendingObserver;
      observer?.(video); ensure(entry);
      if (options.policy === "decoded") {
        entry.decoded = waitForDecodedFrame(video, entry.preparationController.signal);
        void entry.decoded.catch(() => {});
      }
      const configuration = {
        key: options.licenseKey, ui: false, analytics: false,
        playback: { muted: true, autoplay: false, audioLanguage: "en",
          preferredTech: [{ player: PlayerType.Html5, streaming: entry.source.format === "hls" ? StreamType.Hls : StreamType.Dash }] },
        adaptation: { preload }, buffer,
        tweaks: { startup_threshold: 0.1, restart_threshold: 0.1, prevent_video_element_preloading: !preload },
        storage: { disableStorageApi: true }, logs: { level: LogLevel.OFF, bitmovin: false },
      } satisfies PlayerConfig;
      const player = new Player(mount, configuration);
      entry.player = player; options.event("source-created", entry.source.id);
      player.on(PlayerEvent.Error, () => { fail(entry); });
      // The typed public API is called before load, preserving ownership of the
      // element observed by the foreground clock and the preparation observer.
      player.setVideoElement(video); ensure(entry);
      const source: SourceConfig = {
        [entry.source.format]: entry.source.url,
        options: { startOffset: entry.source.startTimeSeconds, startOffsetTimelineReference: TimelineReferencePoint.Start },
      };
      entry.metadata = abortable(player.load(source, `html5.${entry.source.format}`), entry.controller.signal).then(() => {
        ensure(entry);
        if (player.getVideoElement() !== video || player.getPlayerType() !== PlayerType.Html5) {
          throw new Error("Bitmovin v8 did not retain the owned MSE video.");
        }
        options.event("metadata", entry.source.id);
      });
      void entry.metadata.catch(() => {});
    });
  }
  function cleanup(entry: Entry): Promise<void> {
    if (entry.cleanup) return entry.cleanup;
    entry.closed = true; entry.foreground = false; entry.controller.abort(); entry.preparationController.abort();
    entry.cleanup = (async () => {
      // initialize only starts load; destroy must be allowed to cancel its I/O.
      await entry.initialization?.catch(() => {});
      let failed = false;
      try { await entry.player?.destroy(); } catch { failed = true; }
      if (entry.video && entry.mount) {
        try { releaseOwnedVideo(entry.video, entry.mount); } catch { failed = true; }
      }
      if (failed) throw new Error("The Bitmovin v8 use-case cleanup failed.");
    })();
    return entry.cleanup;
  }
  async function prepareEntry(entry: Entry): Promise<void> {
    try {
      await initialize(entry); ensure(entry);
      if (options.policy === "decoded" && entry.promoted) return;
      await entry.metadata; ensure(entry);
      if (options.policy === "segments") {
        // adaptation.preload already allows the earliest supported loading;
        // preload() also explicitly initializes the source's start position.
        entry.player!.preload();
        await waitForBuffer(entry.video!, options.bufferSeconds, entry.controller.signal);
      } else if (options.policy === "decoded") {
        if (entry.promoted) return;
        await Promise.all([
          abortable(entry.player!.play(), entry.preparationController.signal), entry.decoded!,
        ]);
        ensure(entry);
        if (entry.promoted) return;
        if (!entry.foreground) pause(entry);
      }
      ensure(entry); options.event("prepared", entry.source.id);
    } catch (error) {
      // Foreground promotion cancels only background preparation. pause() may
      // reject its pending SDK play promise without invalidating the source.
      if (entry.promoted && entry.preparationController.signal.aborted
          && !entry.closed && !disposed && !options.signal.aborted && !entry.failure) return;
      if (!entry.closed && !disposed && !options.signal.aborted && !entry.failure) fail(entry);
      const failure = entry.failure ?? error;
      await cleanup(entry); throw failure;
    }
  }
  const onAbort = () => { void dispose().catch(() => {}); };
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true; activation++;
    options.signal.removeEventListener("abort", onAbort);
    disposal = (async () => {
      const results = await Promise.allSettled([...entries.values()].map(cleanup));
      entries.clear(); stage.remove();
      if (results.some((result) => result.status === "rejected")) throw new Error("The Bitmovin v8 use-case cleanup failed.");
    })();
    return disposal;
  }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) { await dispose(); throw cancelled(); }

  return {
    engine: "bitmovin-8", supportedPolicies,
    configuration: {
      policy: options.policy, pool: "one-modular-player-and-owned-video-per-source", formats: ["hls", "dash"],
      commonModules: ["Core", "EngineBitmovin", "RendererMSE", "ABR", "ContainerMP4"],
      formatModules: { hls: ["HLS", "ContainerTS"], dash: ["XML", "DASH"] },
      moduleRegistration: "minimum-modules-for-each-registered-source-format",
      playback: { muted: true, autoplay: false, audioLanguage: "en", preferredTech: "html5-per-source-format" },
      adaptation: { preload }, buffer,
      tweaks: { startup_threshold: 0.1, restart_threshold: 0.1, prevent_video_element_preloading: !preload },
      ui: false, analytics: false, storage: { disableStorageApi: true }, logs: { level: "off", bitmovin: false },
      sourceOptions: { startOffset: "per-source-startTimeSeconds", startOffsetTimelineReference: "start" },
      metadata: "load-with-adaptation-preload-false", segments: "adaptation-preload-and-public-preload-then-observed-buffer",
      decoded: "muted-public-play-frame-callback-then-pause", activation: "public-play-after-load-promise", stagedOpacity: 0.001,
      mediaEngineObservation: "public-html5-type-proves-MSE-family-not-ManagedMediaSource-subtype",
      decodedSupported: supportedPolicies.includes("decoded"),
      unsupportedPolicies: supportedPolicies.includes("decoded") ? [] : ["decoded: video-frame callbacks unavailable"],
    },
    prepare(source) {
      ensure(); const existing = entries.get(source.id);
      if (existing) {
        if (existing.source.url !== source.url || existing.source.format !== source.format
            || existing.source.startTimeSeconds !== source.startTimeSeconds) {
          return Promise.reject(new Error("A source ID cannot be registered with a different descriptor."));
        }
        return existing.preparation ?? Promise.resolve();
      }
      const entry: Entry = { source: { ...source }, controller: new AbortController(), preparationController: new AbortController(),
        promoted: false, foreground: false, closed: false };
      entries.set(source.id, entry);
      if (options.policy === "on-demand") return Promise.resolve();
      return entry.preparation = prepareEntry(entry);
    },
    async activate(sourceId, observeVideo) {
      ensure(); const entry = entries.get(sourceId);
      if (!entry) throw new Error("The use-case source is not registered.");
      ensure(entry); const selected = ++activation;
      if (options.policy === "decoded") { entry.promoted = true; entry.preparationController.abort(); }
      if (entry.video) {
        if (options.policy === "decoded") {
          pause(entry);
          if (entry.video.currentTime !== entry.source.startTimeSeconds
            && !entry.player?.seek(entry.source.startTimeSeconds)) throw new Error("The prepared source position could not be reset.");
        }
        observeVideo(entry.video);
      }
      for (const other of entries.values()) {
        const wasForeground = other.foreground;
        other.foreground = other === entry;
        if (other !== entry && wasForeground) pause(other);
        if (other.mount) showOwnedVideo(other.mount, other === entry);
      }
      try {
        await initialize(entry, entry.video ? undefined : observeVideo);
        await entry.metadata; ensure(entry);
        if (selected !== activation) throw cancelled();
        // Partial segment/decoded preparation is promoted as soon as load permits
        // play; foreground startup never waits for the full preparation target.
        await abortable(entry.player!.play(), entry.controller.signal); ensure(entry);
        if (selected !== activation) { if (!entry.foreground) pause(entry); throw cancelled(); }
        return entry.video!;
      } catch (error) {
        if (selected !== activation) throw error;
        if (!entry.closed && !disposed && !options.signal.aborted && !entry.failure) fail(entry);
        const failure = entry.failure ?? error;
        await cleanup(entry); throw failure;
      }
    },
    state(sourceId) {
      const entry = entries.get(sourceId);
      const video = entry && !entry.closed ? entry.video : undefined;
      return { video: video ?? null, bufferSeconds: video ? observedBuffer(video) : null, readyState: video?.readyState ?? null };
    },
    async remove(sourceId) {
      const entry = entries.get(sourceId);
      if (!entry) return;
      entries.delete(sourceId); await cleanup(entry);
    },
    dispose,
  };
};
