import Hls, { type HlsConfig } from "hls.js";
import workerURL from "hls.js/dist/hls.worker.js?url";
import {
  observedBuffer, type CreateUseCaseDriver, type PreparationPolicy, type UseCaseSource,
} from "./contracts";
import {
  abortable, cancelled, createOwnedVideo, createStage, releaseOwnedVideo, showOwnedVideo,
  supportsDecodedPreparation, waitForBuffer, waitForDecodedFrame,
} from "./hls-v8-shared";

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
  player?: Hls;
  attached?: boolean;
  pendingObserver?: (video: HTMLVideoElement) => void;
  initialization?: Promise<void>;
  metadata?: Promise<void>;
  decoded?: Promise<void>;
  preparation?: Promise<void>;
  cleanup?: Promise<void>;
}

/** Public hls.js APIs, with an independent MSE/video pool for prepared sources. */
export const createDriver: CreateUseCaseDriver = async (options) => {
  if (options.signal.aborted) throw cancelled();
  if (!Hls.isSupported()) throw new Error("hls.js MediaSource playback is unavailable.");
  const supportedPolicies: PreparationPolicy[] = ["on-demand", "metadata", "segments"];
  if (supportsDecodedPreparation()) supportedPolicies.push("decoded");
  if (!supportedPolicies.includes(options.policy)) throw new Error("Decoded preparation requires video-frame callbacks.");
  const stage = createStage(options.container);
  const entries = new Map<string, Entry>();
  let disposed = false;
  let activation = 0;
  let disposal: Promise<void> | undefined;
  const autoStartLoad = options.policy !== "metadata";
  const enableWorker = options.workerEnabled ?? true;
  const metadataDetached = options.policy === "metadata" && options.hlsMetadataDetached === true;
  const settings = {
    debug: false, autoStartLoad, enableWorker, workerPath: workerURL,
    audioPreference: { lang: "en" }, preferManagedMediaSource: false,
    lowLatencyMode: false, enableInterstitialPlayback: false,
    maxBufferLength: options.bufferSeconds, maxMaxBufferLength: options.bufferSeconds,
    backBufferLength: 6, frontBufferFlushThreshold: options.bufferSeconds,
  } satisfies Partial<HlsConfig>;

  function ensure(entry?: Entry): void {
    if (entry?.failure) throw entry.failure;
    if (disposed || options.signal.aborted || entry?.closed || entry?.controller.signal.aborted) throw cancelled();
  }
  function fail(entry: Entry): void {
    if (entry.failure || entry.closed || disposed || options.signal.aborted) return;
    entry.failure = new Error("The hls.js use-case source failed.");
    options.event("error", entry.source.id); entry.controller.abort();
    void cleanup(entry).catch(() => {});
  }
  function initialize(entry: Entry, observeVideo?: (video: HTMLVideoElement) => void): Promise<void> {
    // prepare() can queue initialization before activate() runs in the same
    // task. Keep the later observer on the entry, not on the first call's closure.
    if (observeVideo) entry.pendingObserver = observeVideo;
    return entry.initialization ??= Promise.resolve().then(() => {
      ensure(entry);
      if (!metadataDetached) {
        const { mount, video } = createOwnedVideo(stage);
        entry.mount = mount; entry.video = video;
        showOwnedVideo(mount, entry.foreground);
        // The foreground observer sees a fresh on-demand element before MSE attachment.
        const observer = entry.pendingObserver; delete entry.pendingObserver;
        observer?.(video);
        ensure(entry);
        if (options.policy === "decoded") {
          entry.decoded = waitForDecodedFrame(video, entry.preparationController.signal);
          void entry.decoded.catch(() => {});
        }
      }
      const player = new Hls({ ...settings, startPosition: entry.source.startTimeSeconds });
      entry.player = player;
      options.event("source-created", entry.source.id);
      let metadata!: () => void;
      entry.metadata = abortable(new Promise<void>((resolve) => { metadata = resolve; }), entry.controller.signal);
      void entry.metadata.catch(() => {});
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        if (entry.closed || disposed || options.signal.aborted || entry.failure) return;
        options.event("metadata", entry.source.id); metadata();
      });
      player.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(entry); });
      if (!metadataDetached) { player.attachMedia(entry.video!); entry.attached = true; ensure(entry); }
      player.loadSource(entry.source.url); ensure(entry);
    });
  }
  function cleanup(entry: Entry): Promise<void> {
    if (entry.cleanup) return entry.cleanup;
    entry.closed = true; entry.foreground = false; entry.controller.abort(); entry.preparationController.abort();
    entry.cleanup = (async () => {
      // Initialization does not await manifest/network completion, so destroy can
      // cancel load rather than waiting for a load that itself needs destruction.
      await entry.initialization?.catch(() => {});
      let failed = false;
      try { entry.player?.destroy(); } catch { failed = true; }
      if (entry.video && entry.mount) {
        try { releaseOwnedVideo(entry.video, entry.mount); } catch { failed = true; }
      }
      if (failed) throw new Error("The hls.js use-case cleanup failed.");
    })();
    return entry.cleanup;
  }
  async function prepareEntry(entry: Entry): Promise<void> {
    try {
      await initialize(entry); ensure(entry);
      if (options.policy === "decoded") {
        if (entry.promoted) return;
        // Registering the frame observer happened before attach/load. Preplay is
        // charged to preparation and never reused as the foreground frame sample.
        await Promise.all([
          abortable(entry.video!.play(), entry.preparationController.signal), entry.decoded!, entry.metadata!,
        ]);
        ensure(entry);
        if (!entry.foreground) entry.video!.pause();
      } else {
        await entry.metadata; ensure(entry);
        if (options.policy === "segments") await waitForBuffer(entry.video!, options.bufferSeconds, entry.controller.signal);
      }
      ensure(entry); options.event("prepared", entry.source.id);
    } catch (error) {
      // pause() at promotion can reject a pending preparation play(). This is
      // expected cancellation of background work, not failure of the source.
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
      if (results.some((result) => result.status === "rejected")) throw new Error("The hls.js use-case cleanup failed.");
    })();
    return disposal;
  }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) { await dispose(); throw cancelled(); }

  return {
    engine: "hls", supportedPolicies,
    configuration: {
      policy: options.policy, pool: "one-hls-instance-and-owned-video-per-source", formats: ["hls"], unsupportedFormats: ["dash"],
      debug: false, autoStartLoad, enableWorker, workerPath: "bundled-worker-asset",
      workerActive: null, audioPreference: { lang: "en" }, preferManagedMediaSource: false,
      lowLatencyMode: false, enableInterstitialPlayback: false,
      maxBufferLength: options.bufferSeconds, maxMaxBufferLength: options.bufferSeconds,
      backBufferLength: 6, frontBufferFlushThreshold: options.bufferSeconds,
      startPosition: "per-source-startTimeSeconds", metadata: "loadSource-with-autoStartLoad-false",
      hlsMetadataDetached: metadataDetached,
      metadataVideoCreation: metadataDetached ? "activation-only; no attached media during preparation" : "source-initialization",
      segments: "autoStartLoad-and-observed-owned-video-buffer", decoded: "muted-preplay-frame-callback-then-pause",
      activation: "native-play-without-an-extra-manifest-gate", stagedOpacity: 0.001,
      decodedSupported: supportedPolicies.includes("decoded"),
      unsupportedPolicies: supportedPolicies.includes("decoded") ? [] : ["decoded: video-frame callbacks unavailable"],
    },
    prepare(source) {
      ensure();
      if (source.format !== "hls") return Promise.reject(new Error("hls.js does not support DASH sources."));
      const existing = entries.get(source.id);
      if (existing) {
        if (existing.source.url !== source.url || existing.source.startTimeSeconds !== source.startTimeSeconds) {
          return Promise.reject(new Error("A source ID cannot be registered with a different descriptor."));
        }
        return existing.preparation ?? Promise.resolve();
      }
      const entry: Entry = { source: { ...source }, controller: new AbortController(), preparationController: new AbortController(),
        promoted: false, foreground: false, closed: false };
      entries.set(source.id, entry);
      // On-demand retains only the descriptor: no SDK instance, video or request.
      if (options.policy === "on-demand") return Promise.resolve();
      return entry.preparation = prepareEntry(entry);
    },
    async activate(sourceId, observeVideo) {
      ensure(); const entry = entries.get(sourceId);
      if (!entry) throw new Error("The use-case source is not registered.");
      ensure(entry); const selected = ++activation;
      if (options.policy === "decoded") { entry.promoted = true; entry.preparationController.abort(); }
      if (metadataDetached && !entry.video) {
        const owned = createOwnedVideo(stage); entry.mount = owned.mount; entry.video = owned.video;
      }
      if (entry.video) {
        if (options.policy === "decoded") {
          entry.video.pause();
          if (entry.video.currentTime !== entry.source.startTimeSeconds) entry.video.currentTime = entry.source.startTimeSeconds;
        }
        observeVideo(entry.video);
      }
      for (const other of entries.values()) {
        const wasForeground = other.foreground;
        other.foreground = other === entry;
        if (other !== entry && wasForeground) other.video?.pause();
        if (other.mount) showOwnedVideo(other.mount, other === entry);
      }
      try {
        await initialize(entry, entry.video ? undefined : observeVideo); ensure(entry);
        if (selected !== activation) throw cancelled();
        if (!entry.attached) { entry.player!.attachMedia(entry.video!); entry.attached = true; ensure(entry); }
        if (options.policy === "metadata") entry.player!.startLoad(entry.source.startTimeSeconds);
        // Promote partial preparation immediately rather than waiting for 12 s
        // of buffer or the preparation frame when the user has already clicked.
        await abortable(entry.video!.play(), entry.controller.signal); ensure(entry);
        if (selected !== activation) { if (!entry.foreground) entry.video!.pause(); throw cancelled(); }
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
