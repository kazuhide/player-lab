import type Shaka from "shaka-player/dist/shaka-player.hls-es2021.js";
import { observedBuffer, type PreparationPolicy, type UseCaseDriver, type UseCaseDriverOptions, type UseCaseSource } from "./contracts";
import { abortable, cancelled, createPreparedMedia, type PreparedMedia } from "./prepared-media";

interface Entry {
  readonly source: UseCaseSource;
  readonly controller: AbortController;
  removed: boolean;
  failure?: Error;
  manager?: Shaka.media.PreloadManager;
  creation?: Promise<Shaka.media.PreloadManager>;
  preparation?: Promise<void>;
  removal?: Promise<void>;
}

const policies: readonly PreparationPolicy[] = ["on-demand", "segments"];

/** One public Shaka player owns all preload managers and one foreground video. */
export async function createDriver(options: UseCaseDriverOptions): Promise<UseCaseDriver> {
  if (options.signal.aborted) throw cancelled();
  if (!policies.includes(options.policy)) throw new Error("Shared Shaka supports only on-demand and segment preparation.");
  if (options.bufferSeconds !== 6 && options.bufferSeconds !== 12) throw new Error("Unsupported Shaka buffer goal.");
  const entries = new Map<string, Entry>();
  const lifetime = new AbortController();
  const prefetchLimit = options.bufferSeconds === 12 ? 6 : 3;
  let format: UseCaseSource["format"] | undefined;
  let sdk: typeof Shaka | undefined, player: Shaka.Player | undefined, media: PreparedMedia | undefined;
  let setup: Promise<void> | undefined, attachment: Promise<void> | undefined, disposal: Promise<void> | undefined;
  let foreground: Entry | undefined, loaded: Entry | undefined, closed = false, generation = 0;
  let switching: Promise<unknown> = Promise.resolve();
  let sharedFailure: Error | undefined;
  let removePlayerErrorListener: (() => void) | undefined;

  function ensure(entry?: Entry): void {
    if (sharedFailure) throw sharedFailure;
    if (entry?.failure) throw entry.failure;
    if (closed || options.signal.aborted || entry?.removed || entry?.controller.signal.aborted) throw cancelled();
  }
  function emit(name: Parameters<UseCaseDriverOptions["event"]>[0], entry: Entry): void {
    if (!closed && !entry.removed && !options.signal.aborted && (!sharedFailure || name === "error")) options.event(name, entry.source.id);
  }
  function fail(entry: Entry): void {
    if (entry.failure || entry.removed || closed || options.signal.aborted) return;
    entry.failure = new Error("The shared Shaka source failed."); emit("error", entry); entry.controller.abort();
  }
  function failSharedPlayer(): void {
    if (sharedFailure || closed || options.signal.aborted) return;
    sharedFailure = new Error("The shared Shaka player failed.");
    const affected = [...entries.values()].filter((entry) => !entry.removed);
    const context = foreground && !foreground.removed ? foreground
      : loaded && !loaded.removed ? loaded : affected[0];
    // Invalidate every source before the owner can synchronously dispose on error.
    for (const entry of affected) { entry.failure ??= sharedFailure; entry.controller.abort(); }
    generation++; lifetime.abort();
    try { media?.video.pause(); } catch { /* The fatal state already invalidates this session. */ }
    try { if (context) emit("error", context); }
    finally { void dispose().catch(() => {}); }
  }
  function initialize(): Promise<void> {
    return setup ??= (async () => {
      ensure();
      const module = format === "dash" ? await import("shaka-player/dist/shaka-player.dash-es2021.js")
        : await import("shaka-player/dist/shaka-player.hls-es2021.js");
      ensure(); sdk = module.default as unknown as typeof Shaka; sdk.polyfill.installAll();
      const managed: unknown = Reflect.get(globalThis, "ManagedMediaSource");
      if (!sdk.Player.isBrowserSupported() || (typeof MediaSource === "undefined" && typeof managed !== "function")) {
        throw new Error("Shaka MediaSource playback is unsupported.");
      }
      player = new sdk.Player();
      const ownedPlayer = player;
      const criticalSeverity = sdk.util.Error.Severity.CRITICAL;
      const onPlayerError = (event: Event): void => {
        const detail: unknown = "detail" in event ? event.detail : undefined;
        if (detail && typeof detail === "object" && "severity" in detail && detail.severity === criticalSeverity) {
          failSharedPlayer();
        }
      };
      ownedPlayer.addEventListener("error", onPlayerError);
      removePlayerErrorListener = () => ownedPlayer.removeEventListener("error", onPlayerError);
      if (!player.configure({
        preferredAudio: [{ language: "en", role: "", label: "", channelCount: 2, codec: "", spatialAudio: false }],
        streaming: { preferNativeHls: false, fallbackToNativeHlsOnMseError: false, useNativeHlsForFairPlay: false,
          lowLatencyMode: false, bufferingGoal: options.bufferSeconds, bufferBehind: 6, rebufferingGoal: 0,
          segmentPrefetchLimit: prefetchLimit, disableTextPrefetch: true, stopFetchingOnPause: false },
        cmcd: { enabled: false }, cmsd: { enabled: false },
        ads: { disableHLSInterstitial: true, disableDASHInterstitial: true, disableSVTA: true },
      })) throw new Error("Shaka rejected the shared preparation configuration.");
      ensure();
    })();
  }
  const mime = (entry: Entry) => entry.source.format === "hls" ? "application/x-mpegurl" : "application/dash+xml";
  function preload(entry: Entry): Promise<Shaka.media.PreloadManager> {
    return entry.creation ??= (async () => {
      await initialize(); ensure(entry); emit("source-created", entry);
      const manager = await player!.preload(entry.source.url, entry.source.startTimeSeconds, mime(entry));
      if (!manager) throw new Error("The shared Shaka source cannot use MediaSource preloading.");
      entry.manager = manager;
      if (closed || entry.removed || entry.controller.signal.aborted) { await manager.destroy(); throw cancelled(); }
      return manager;
    })();
  }
  function prepareEntry(entry: Entry): Promise<void> {
    return entry.preparation ??= (async () => {
      try {
        const manager = await preload(entry);
        await abortable(manager.waitForFinish(), entry.controller.signal); ensure(entry);
        emit("metadata", entry); emit("prepared", entry);
      } catch (error) { fail(entry); throw entry.failure ?? error; }
    })();
  }
  function attach(): Promise<void> {
    return attachment ??= (async () => {
      await initialize(); ensure();
      await abortable(player!.attach(media!.video), lifetime.signal); ensure();
    })();
  }
  function removeEntry(entry: Entry): Promise<void> {
    if (entry.removal) return entry.removal;
    entry.removed = true; entry.controller.abort();
    if (foreground === entry) media?.video.pause();
    return entry.removal = (async () => {
      if (foreground === entry && !closed) {
        const unloading = switching.catch(() => {}).then(async () => {
          if (!closed && foreground === entry) { await player?.unload(); foreground = undefined; loaded = undefined; }
        });
        switching = unloading; await unloading;
      }
      await entry.creation?.catch(() => {});
      await entry.manager?.destroy();
      await entry.preparation?.catch(() => {});
      if (entries.get(entry.source.id) === entry) entries.delete(entry.source.id);
    })();
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    closed = true; generation++; lifetime.abort(); options.signal.removeEventListener("abort", onAbort);
    for (const entry of entries.values()) { entry.removed = true; entry.controller.abort(); }
    media?.video.pause();
    return disposal = (async () => {
      await setup?.catch(() => {});
      let failed = false;
      try { removePlayerErrorListener?.(); } catch { failed = true; }
      removePlayerErrorListener = undefined;
      // Player.destroy cancels its active load and all of its preload managers,
      // including managers whose asynchronous creation has not returned yet.
      try { await player?.destroy(); } catch { failed = true; }
      const pending = [...entries.values()].flatMap((entry) => [entry.creation, entry.preparation, entry.removal]);
      await Promise.allSettled([...pending, switching].filter((item) => item !== undefined));
      try { media?.destroy(); } catch { failed = true; }
      entries.clear(); foreground = undefined; loaded = undefined;
      if (failed) throw new Error("Shared Shaka cleanup failed.");
    })();
  }
  function onAbort(): void { void dispose().catch(() => {}); }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) { await dispose(); throw cancelled(); }

  return {
    engine: "shaka", supportedPolicies: policies,
    configuration: {
      policy: options.policy, topology: "shared", bundle: "format-specific-ES2021-selected-by-first-source",
      playerStrategy: "one-player-one-owned-video-multiple-public-preload-managers", mixedFormatSession: "unsupported",
      criticalPlayerErrorScope: "shared player fatal: all registered sources and pending work fail; callback context is active source or first pending source",
      criticalPlayerErrorCleanup: "lifetime error listener removed before player destruction; one acknowledged disposal promise",
      unsupportedPolicies: ["metadata: public preload fetches media", "decoded: shared foreground video is not used for background decode"],
      preparationAPI: options.policy === "segments" ? "Player.preload + PreloadManager.waitForFinish" : "descriptor-only",
      segmentPrefetchLimit: prefetchLimit, detachedBufferSeconds: null, prefetchLimitUnit: "segment-count-not-observed-seconds",
      bufferingGoal: options.bufferSeconds, bufferBehind: 6, rebufferingGoal: 0, stopFetchingOnPause: false,
      preferNativeHls: false, fallbackToNativeHlsOnMseError: false, useNativeHlsForFairPlay: false,
      lowLatencyMode: false, disableTextPrefetch: true, preferredAudioLanguage: "en",
      activation: "consume-unfinished-manager-on-its-creating-player-without-waitForFinish",
      foregroundPlay: "pause-old-source-before-observation; native-play-after-public-load-acknowledgment",
      startPosition: "per-source-startTimeSeconds-passed-to-preload-and-load", managerLifetime: "single-consumption; recreated-for-revisit",
      autoplay: false, muted: true, cmcd: false, cmsd: false, optionalAdvertising: false, optionalUI: false,
    },
    prepare(source) {
      ensure();
      if (format && source.format !== format) return Promise.reject(new Error("Shared Shaka requires one format per driver session."));
      if (entries.has(source.id)) return Promise.reject(new Error("The shared Shaka source ID is already registered."));
      format ??= source.format;
      const entry: Entry = { source: { ...source }, controller: new AbortController(), removed: false };
      entries.set(source.id, entry);
      if (options.policy === "on-demand") return Promise.resolve();
      const pending = prepareEntry(entry); void pending.catch(() => {}); return pending;
    },
    activate(sourceId, observeVideo) {
      ensure(); const entry = entries.get(sourceId);
      if (!entry) return Promise.reject(new Error("The shared Shaka source is not registered."));
      const selected = ++generation;
      const activation = switching.catch(() => {}).then(async () => {
        try {
          ensure(entry); if (selected !== generation) throw cancelled();
          media ??= createPreparedMedia(options.container);
          media.video.pause(); observeVideo(media.video); media.show(true);
          await abortable(attach(), entry.controller.signal); ensure(entry);
          foreground = entry; loaded = undefined;
          const manager = options.policy === "segments" ? await abortable(preload(entry), entry.controller.signal) : null;
          ensure(entry); if (selected !== generation) throw cancelled();
          if (!manager) emit("source-created", entry);
          await abortable(player!.load(manager ?? entry.source.url, entry.source.startTimeSeconds, mime(entry)), entry.controller.signal);
          ensure(entry);
          if (player!.getLoadMode() !== sdk!.Player.LoadMode.MEDIA_SOURCE) throw new Error("Shared Shaka selected native playback.");
          delete entry.manager; delete entry.creation; loaded = entry; emit("metadata", entry);
          if (selected !== generation) throw cancelled();
          // A reused video's old source must never play while load is replacing it.
          await abortable(media.video.play(), entry.controller.signal); ensure(entry);
          return media.video;
        } catch (error) {
          if (selected === generation) fail(entry);
          throw entry.failure ?? error;
        }
      });
      switching = activation; return activation;
    },
    state(sourceId) {
      const video = !sharedFailure && loaded?.source.id === sourceId && !loaded.removed && !loaded.failure ? media?.video ?? null : null;
      return { video, bufferSeconds: video ? observedBuffer(video) : null, readyState: video?.readyState ?? null };
    },
    async remove(sourceId) { const entry = entries.get(sourceId); if (entry) await removeEntry(entry); },
    dispose,
  };
}
