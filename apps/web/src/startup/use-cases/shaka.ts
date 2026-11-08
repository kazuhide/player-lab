import type Shaka from "shaka-player/dist/shaka-player.hls-es2021.js";
import type { PreparationPolicy, UseCaseDriver, UseCaseDriverOptions, UseCaseSource } from "./contracts";
import { observedBuffer } from "./contracts";
import { abortable, cancelled, createPreparedMedia, prepareDecoded, type PreparedMedia } from "./prepared-media";

type ShakaModule = typeof Shaka;
interface Entry {
  readonly descriptor: UseCaseSource;
  readonly controller: AbortController;
  readonly preparationController: AbortController;
  player?: Shaka.Player;
  sdk?: ShakaModule;
  media?: PreparedMedia;
  setup?: Promise<void>;
  attach?: Promise<void>;
  preloadCreation?: Promise<Shaka.media.PreloadManager>;
  preloader?: Shaka.media.PreloadManager;
  loading?: Promise<void>;
  preparation?: Promise<void>;
  removal?: Promise<void>;
  failure?: Error;
  onError?: (event: Event) => void;
  promoted: boolean;
}

// 5.3.x preload() always prefetches media: a metadata-only policy is not public.
const policies: readonly PreparationPolicy[] = ["on-demand", "segments", "decoded"];

/** A retained player/video pool preserves each selected asset across later switches. */
export async function createDriver(options: UseCaseDriverOptions): Promise<UseCaseDriver> {
  if (options.signal.aborted) throw cancelled();
  if (!policies.includes(options.policy)) throw new Error("Shaka has no public metadata-only preload policy.");
  if (options.bufferSeconds !== 6 && options.bufferSeconds !== 12) throw new Error("Unsupported Shaka buffer goal.");
  const entries = new Map<string, Entry>();
  const modules = new Map<UseCaseSource["format"], Promise<ShakaModule>>();
  const prefetchLimit = options.bufferSeconds === 12 ? 6 : 3;
  let foreground: Entry | undefined;
  let closed = false;
  let disposal: Promise<void> | undefined;
  let switching: Promise<unknown> = Promise.resolve();

  function ensureOpen(entry?: Entry): void {
    if (closed || options.signal.aborted || entry?.controller.signal.aborted) throw entry?.failure ?? cancelled();
  }
  function emit(name: Parameters<UseCaseDriverOptions["event"]>[0], entry: Entry): void {
    if (!closed && !entry.controller.signal.aborted && !options.signal.aborted) options.event(name, entry.descriptor.id);
  }
  function media(entry: Entry): PreparedMedia { return entry.media ??= createPreparedMedia(options.container); }
  function fail(entry: Entry): void {
    if (entry.failure || closed || entry.controller.signal.aborted) return;
    entry.failure = new Error("The Shaka prepared source failed.");
    emit("error", entry); entry.controller.abort(); entry.preparationController.abort();
  }
  function getModule(format: UseCaseSource["format"]): Promise<ShakaModule> {
    let pending = modules.get(format);
    if (!pending) {
      pending = (format === "hls" ? import("shaka-player/dist/shaka-player.hls-es2021.js")
        : import("shaka-player/dist/shaka-player.dash-es2021.js")).then((module) => module.default as unknown as ShakaModule);
      modules.set(format, pending);
    }
    return pending;
  }
  function setup(entry: Entry): Promise<void> {
    return entry.setup ??= (async () => {
      ensureOpen(entry);
      const sdk = await getModule(entry.descriptor.format); ensureOpen(entry);
      sdk.polyfill.installAll();
      const managed: unknown = Reflect.get(globalThis, "ManagedMediaSource");
      if (!sdk.Player.isBrowserSupported() || (typeof MediaSource === "undefined" && typeof managed !== "function")) {
        throw new Error("Shaka MediaSource playback is unsupported.");
      }
      entry.sdk = sdk;
      const player = new sdk.Player(); entry.player = player;
      const onError = (event: Event) => {
        const detail: unknown = "detail" in event ? event.detail : undefined;
        if (detail && typeof detail === "object" && "severity" in detail
            && detail.severity === sdk.util.Error.Severity.CRITICAL) fail(entry);
      };
      entry.onError = onError; player.addEventListener("error", onError);
      const accepted = player.configure({
        preferredAudio: [{ language: "en", role: "", label: "", channelCount: 2, codec: "", spatialAudio: false }],
        streaming: {
          preferNativeHls: false, fallbackToNativeHlsOnMseError: false,
          useNativeHlsForFairPlay: false, lowLatencyMode: false,
          bufferingGoal: options.bufferSeconds, bufferBehind: 6, rebufferingGoal: 0,
          segmentPrefetchLimit: prefetchLimit, disableTextPrefetch: true,
          stopFetchingOnPause: false,
        },
        cmcd: { enabled: false }, cmsd: { enabled: false },
        ads: { disableHLSInterstitial: true, disableDASHInterstitial: true, disableSVTA: true },
      });
      if (!accepted) throw new Error("Shaka rejected the preparation configuration.");
      ensureOpen(entry); emit("source-created", entry);
    })();
  }
  function mime(entry: Entry): string {
    return entry.descriptor.format === "hls" ? "application/x-mpegurl" : "application/dash+xml";
  }
  function preload(entry: Entry): Promise<Shaka.media.PreloadManager> {
    return entry.preloadCreation ??= (async () => {
      await setup(entry); ensureOpen(entry);
      // Public API: preserve and later load this exact manager on its creating player.
      // https://github.com/shaka-project/shaka-player/blob/v5.3.4/docs/tutorials/preload.md
      const manager = await entry.player!.preload(entry.descriptor.url, entry.descriptor.startTimeSeconds, mime(entry));
      if (!manager) throw new Error("The Shaka source does not support MediaSource preloading.");
      entry.preloader = manager; ensureOpen(entry);
      return manager;
    })();
  }
  function attach(entry: Entry): Promise<void> {
    return entry.attach ??= (async () => {
      await setup(entry); ensureOpen(entry);
      await entry.player!.attach(media(entry).video); ensureOpen(entry);
    })();
  }
  function load(entry: Entry): Promise<void> {
    return entry.loading ??= (async () => {
      await attach(entry); ensureOpen(entry);
      const player = entry.player!;
      if (options.policy === "segments") {
        const manager = await preload(entry); ensureOpen(entry);
        // load() may consume an unfinished preloader; do not waitForFinish before activation.
        await player.load(manager, entry.descriptor.startTimeSeconds, mime(entry));
        delete entry.preloader;
      } else {
        await player.load(entry.descriptor.url, entry.descriptor.startTimeSeconds, mime(entry));
      }
      ensureOpen(entry);
      if (player.getLoadMode() !== entry.sdk!.Player.LoadMode.MEDIA_SOURCE) {
        throw new Error("Shaka selected an unsupported native playback route.");
      }
      emit("metadata", entry);
    })();
  }
  function startPreparation(entry: Entry): Promise<void> {
    return entry.preparation ??= (async () => {
      await setup(entry); ensureOpen(entry);
      if (options.policy === "segments") {
        const manager = await preload(entry);
        await abortable(manager.waitForFinish(), entry.controller.signal);
        ensureOpen(entry); emit("metadata", entry);
      } else {
        const loading = load(entry);
        void loading.catch(() => {});
        await abortable(attach(entry), entry.controller.signal); ensureOpen(entry);
        if (entry.promoted) return;
        try {
          await prepareDecoded({
            media: media(entry), signal: entry.preparationController.signal,
            startTimeSeconds: entry.descriptor.startTimeSeconds, bufferSeconds: options.bufferSeconds,
            promoted: () => entry.promoted,
            play: () => media(entry).video.play(), pause: () => media(entry).video.pause(),
            seek: (seconds) => { media(entry).video.currentTime = seconds; },
          });
          await abortable(loading, entry.preparationController.signal);
        } catch (error) {
          if (entry.promoted && !entry.controller.signal.aborted) return;
          throw error;
        }
        if (entry.promoted) return;
      }
      ensureOpen(entry); emit("prepared", entry);
    })();
  }
  function removeEntry(entry: Entry): Promise<void> {
    return entry.removal ??= (async () => {
      entry.controller.abort(); entry.preparationController.abort();
      entry.media?.video.pause();
      // A pending constructor/import must settle before destruction can own its player.
      await entry.setup?.catch(() => {});
      let cleanupFailed = false;
      try {
        if (entry.onError) entry.player?.removeEventListener("error", entry.onError);
        // destroy() aborts loads and created preloaders, including ones still being constructed.
        await entry.player?.destroy();
      } catch { cleanupFailed = true; }
      await Promise.allSettled([entry.attach, entry.loading, entry.preloadCreation, entry.preparation].filter((pending) => pending !== undefined));
      try { await entry.preloader?.destroy(); } catch { cleanupFailed = true; }
      try { entry.media?.destroy(); } catch { cleanupFailed = true; }
      if (foreground === entry) foreground = undefined;
      if (entries.get(entry.descriptor.id) === entry) entries.delete(entry.descriptor.id);
      if (cleanupFailed) throw new Error("Shaka prepared source cleanup failed.");
    })();
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    closed = true; options.signal.removeEventListener("abort", onAbort);
    disposal = (async () => {
      const results = await Promise.allSettled([...entries.values()].map(removeEntry));
      if (results.some((result) => result.status === "rejected")) throw new Error("Shaka driver cleanup failed.");
    })();
    return disposal;
  }
  function onAbort(): void { void dispose().catch(() => {}); }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) { await dispose(); throw cancelled(); }

  return {
    engine: "shaka", supportedPolicies: policies,
    configuration: {
      policy: options.policy, bundle: "shaka-player format-specific ES2021",
      playerStrategy: "one retained player and owned video per source",
      preparationAPI: options.policy === "segments" ? "Player.preload + PreloadManager.waitForFinish" : options.policy === "decoded" ? "load + observed presented frame + pause" : "descriptor only",
      preparationCompletion: options.policy === "segments" ? "PreloadManager.waitForFinish; detached bytes have no public duration observation"
        : options.policy === "decoded" ? "presented frame then paused at source start; measured forward buffer reaches goal within 0.05s"
        : "descriptor registered; player construction deferred to activation",
      metadataPolicy: "unsupported: public preload() fetches selected media; zero prefetch limit falls back to two",
      segmentPrefetchLimit: prefetchLimit, segmentPrefetchDuration: "segment count only; no assumed equality with buffered seconds",
      bufferingGoal: options.bufferSeconds, bufferBehind: 6, rebufferingGoal: 0, stopFetchingOnPause: false,
      preferNativeHls: false, fallbackToNativeHlsOnMseError: false, useNativeHlsForFairPlay: false,
      disableTextPrefetch: true, attachDuringPreparation: options.policy === "decoded",
      videoStrategy: "retained source pool; decoded staging is paintable",
      activation: "join player/attachment and manager creation; consume pending preload without waiting for preparation",
      activationStartPosition: "reset to source start before every foreground play",
      playbackAPI: "owned HTMLMediaElement.play; Shaka exposes no Player.play",
      autoplay: false, muted: true, cmcd: false, cmsd: false, optionalAdvertising: false, optionalUI: false,
    },
    prepare(descriptor) {
      ensureOpen();
      if (entries.has(descriptor.id)) return Promise.reject(new Error("The prepared source ID is already registered."));
      const entry: Entry = { descriptor, controller: new AbortController(), preparationController: new AbortController(), promoted: false };
      entries.set(descriptor.id, entry);
      if (options.policy === "on-demand") return Promise.resolve();
      if (options.policy === "decoded") media(entry);
      const preparation = startPreparation(entry); void preparation.catch(() => {}); return preparation;
    },
    activate(sourceId, observeVideo) {
      ensureOpen();
      const entry = entries.get(sourceId);
      if (!entry) return Promise.reject(new Error("The prepared source is not registered."));
      // A decoded preparation promoted during its first-frame wait must never pause later.
      entry.promoted = true; entry.preparationController.abort();
      if (options.policy === "decoded") entry.media?.video.pause();
      const targetMedia = media(entry); observeVideo(targetMedia.video);
      const activation = switching.catch(() => {}).then(async () => {
        await abortable(attach(entry), entry.controller.signal); ensureOpen(entry);
        if (foreground && foreground !== entry) { foreground.media?.video.pause(); foreground.media?.show(false); }
        foreground = entry; targetMedia.show(true);
        const loading = load(entry); void loading.catch(() => {});
        // Promotion can interrupt preparation before its rewind; load() already carries
        // the same start time, and this also rewinds an already decoded owned element.
        targetMedia.video.currentTime = entry.descriptor.startTimeSeconds;
        // Request play as soon as attachment allows it; the unfinished load can continue concurrently.
        const playing = targetMedia.video.play();
        await abortable(Promise.all([loading, playing]), entry.controller.signal); ensureOpen(entry);
        return targetMedia.video;
      });
      switching = activation; return activation;
    },
    state(sourceId) {
      const video = entries.get(sourceId)?.media?.video ?? null;
      return { video, bufferSeconds: video ? observedBuffer(video) : null, readyState: video?.readyState ?? null };
    },
    async remove(sourceId) { const entry = entries.get(sourceId); if (entry) await removeEntry(entry); },
    dispose,
  };
}
