import type { NativePlayerApi, NativeSourceApi } from "../adapters/webx-shared";
import type { PreparationPolicy, UseCaseDriver, UseCaseDriverOptions, UseCaseSource } from "./contracts";
import { observedBuffer } from "./contracts";
import { abortable, cancelled, createPreparedMedia, prepareDecoded, waitUntil, type PreparedMedia } from "./prepared-media";

type Format = UseCaseSource["format"];
interface Entry {
  readonly descriptor: UseCaseSource;
  readonly controller: AbortController;
  readonly preparationController: AbortController;
  readonly listeners: Array<() => void>;
  player?: NativePlayerApi;
  source?: NativeSourceApi;
  media?: PreparedMedia;
  setup?: Promise<void>;
  preparation?: Promise<void>;
  removal?: Promise<void>;
  failure?: Error;
  promoted: boolean;
}

const policies: readonly PreparationPolicy[] = ["on-demand", "metadata", "segments", "decoded"];

/** Native independent sources share one player for each selected stream format. */
export async function createDriver(options: UseCaseDriverOptions): Promise<UseCaseDriver> {
  if (options.signal.aborted) throw cancelled();
  if (!policies.includes(options.policy)) throw new Error("Unsupported Web X preparation policy.");
  // 10.3.1 exposes no public buffer-goal setter. Its default is 12 s forward / 6 s back.
  if (options.bufferSeconds !== 12) throw new Error("Web X public APIs support only the 12-second default buffer goal in this sweep.");
  const entries = new Map<string, Entry>();
  const players = new Map<Format, Promise<NativePlayerApi>>();
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
  function fail(entry: Entry): void {
    if (entry.failure || entry.controller.signal.aborted || closed) return;
    entry.failure = new Error("The Web X prepared source failed.");
    emit("error", entry); entry.controller.abort(); entry.preparationController.abort();
  }
  function getPlayer(format: Format): Promise<NativePlayerApi> {
    let pending = players.get(format);
    if (!pending) {
      pending = (async () => {
        const configuration = {
          key: options.licenseKey, defaultContainer: options.container, defaultLogLevel: 0 as const,
          playback: { muted: true, autoplay: false, preventSeeking: false },
        };
        const player = format === "hls"
          ? await (await import("../adapters/webx-clear-fmp4")).createPlayer(configuration)
          : (await import("@bitmovin/player-web-x/bundles/playerx-dash")).Player(configuration) as NativePlayerApi;
        const onPlayerError = () => { for (const entry of entries.values()) if (entry.player === player) fail(entry); };
        const onSourceError = (event: { sourceId: string }) => {
          for (const entry of entries.values()) if (entry.source?.id === event.sourceId) fail(entry);
        };
        player.events.on(player.events.Type.PlayerError, onPlayerError);
        player.events.on(player.events.Type.SourceError, onSourceError);
        return player;
      })();
      players.set(format, pending);
    }
    return pending;
  }
  function media(entry: Entry): PreparedMedia {
    return entry.media ??= createPreparedMedia(options.container);
  }
  function attach(entry: Entry): void {
    ensureOpen(entry);
    const player = entry.player;
    const source = entry.source;
    if (!player || !source) throw new Error("The Web X source is not initialized.");
    if (!source.attached) {
      const ownedMedia = media(entry);
      player.sources.attachVideo(source, { video: ownedMedia.video, container: ownedMedia.container });
      ownedMedia.video.controls = false;
    }
  }
  function setup(entry: Entry): Promise<void> {
    return entry.setup ??= (async () => {
      ensureOpen(entry);
      entry.player = await getPlayer(entry.descriptor.format);
      ensureOpen(entry);
      // Set the common timeline position before permitting any manifest/segment work.
      const source = entry.player.sources.add({
        resources: [{ url: entry.descriptor.url, type: entry.descriptor.format }], contentType: "content",
      }, { attach: false, loadControl: 0, playback: { muted: true, autoplay: false, preventSeeking: false } });
      entry.source = source; source.logLevel = 0;
      source.currentTime = entry.descriptor.startTimeSeconds; source.playbackRate = 1;
      const onDuration = () => {
        if (Number.isFinite(source.duration) && source.duration > 0) emitMetadata();
      };
      let metadataEmitted = false;
      const emitMetadata = () => { if (!metadataEmitted) { metadataEmitted = true; emit("metadata", entry); } };
      source.events.on(source.events.Type.DurationChanged, onDuration);
      entry.listeners.push(() => source.events.off(source.events.Type.DurationChanged, onDuration));
      emit("source-created", entry);
      if (options.policy === "decoded") attach(entry);
      source.loadControl = options.policy === "metadata" ? 1 : 2;
    })();
  }
  function startPreparation(entry: Entry): Promise<void> {
    return entry.preparation ??= (async () => {
      await setup(entry); ensureOpen(entry);
      const source = entry.source!;
      if (options.policy === "decoded") {
        if (entry.promoted) return;
        try {
          await prepareDecoded({
            media: media(entry), signal: entry.preparationController.signal,
            startTimeSeconds: entry.descriptor.startTimeSeconds, bufferSeconds: options.bufferSeconds,
            promoted: () => entry.promoted,
            play: () => source.play(), pause: () => source.pause(), seek: (seconds) => { source.currentTime = seconds; },
          });
        } catch (error) {
          if (entry.promoted && !entry.controller.signal.aborted) return;
          throw error;
        }
        if (entry.promoted) return;
      } else {
        // Detached segment buffering has no public completion/byte-range getter.
        // This acknowledges manifest availability only, never a full prefetched buffer.
        await waitUntil(() => Number.isFinite(source.duration) && source.duration > 0, entry.controller.signal);
      }
      ensureOpen(entry); emit("prepared", entry);
    })();
  }
  function removeEntry(entry: Entry): Promise<void> {
    return entry.removal ??= (async () => {
      entry.controller.abort(); entry.preparationController.abort();
      // Setup may still be importing/constructing the shared player. Join it before removal.
      await entry.setup?.catch(() => {});
      await entry.preparation?.catch(() => {});
      let cleanupFailed = false;
      for (const remove of entry.listeners.splice(0)) { try { remove(); } catch { cleanupFailed = true; } }
      try {
        if (entry.source && entry.player) {
          entry.source.pause();
          if (entry.source.attached) entry.player.sources.detachVideo(entry.source);
          entry.player.sources.remove(entry.source);
        }
      } catch { cleanupFailed = true; }
      try { entry.media?.destroy(); } catch { cleanupFailed = true; }
      if (foreground === entry) foreground = undefined;
      if (entries.get(entry.descriptor.id) === entry) entries.delete(entry.descriptor.id);
      if (cleanupFailed) throw new Error("Web X prepared source cleanup failed.");
    })();
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    closed = true; options.signal.removeEventListener("abort", onAbort);
    disposal = (async () => {
      const results = await Promise.allSettled([...entries.values()].map(removeEntry));
      // Source removal is synchronous in the public API; player disposal acknowledges async teardown.
      const playerResults = await Promise.allSettled([...players.values()].map(async (pending) => {
        let player: NativePlayerApi;
        try { player = await pending; } catch { return; }
        await player.dispose();
      }));
      if ([...results, ...playerResults].some((result) => result.status === "rejected")) {
        throw new Error("Web X driver cleanup failed.");
      }
    })();
    return disposal;
  }
  function onAbort(): void { void dispose().catch(() => {}); }
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) { await dispose(); throw cancelled(); }

  return {
    engine: "web-x", supportedPolicies: policies,
    configuration: {
      policy: options.policy, sdk: "10.3.1", playerStrategy: "one shared player per format; independent SourcesAPI sources",
      hlsBundle: "playerx-core-clear-fmp4-no-adaptation", dashBundle: "playerx-dash",
      preparationLoadControl: options.policy === "on-demand" ? 0 : options.policy === "metadata" ? 1 : 2,
      activeLoadControl: 2, activationStartPosition: "reset to source start before every foreground play", attachDuringPreparation: options.policy === "decoded",
      videoStrategy: "one retained video per attached source; decoded staging is paintable",
      bufferSeconds: 12, bufferBehindSeconds: 6, bufferGoalControl: "SDK defaults; no public setter",
      preparationCompletion: options.policy === "segments"
        ? "manifest duration observed; detached segment prefetch continues without a public completion getter"
        : options.policy === "metadata" ? "manifest duration observed"
        : options.policy === "decoded" ? "presented frame then paused at source start; observed forward buffer >= 11.95s"
        : "descriptor registered; source creation deferred to activation",
      detachedBufferObservation: "unavailable; null is not zero", sourceRemovalAcknowledgment: "public synchronous remove; async cleanup awaited on player.dispose",
      autoplay: false, muted: true, optionalAnalytics: false, optionalAdvertising: false, optionalUI: false,
    },
    prepare(descriptor) {
      ensureOpen();
      if (entries.has(descriptor.id)) return Promise.reject(new Error("The prepared source ID is already registered."));
      const entry: Entry = { descriptor, controller: new AbortController(), preparationController: new AbortController(), listeners: [], promoted: false };
      entries.set(descriptor.id, entry);
      if (options.policy === "on-demand") return Promise.resolve();
      if (options.policy === "decoded") media(entry);
      const preparation = startPreparation(entry);
      void preparation.catch(() => {});
      return preparation;
    },
    activate(sourceId, observeVideo) {
      ensureOpen();
      const entry = entries.get(sourceId);
      if (!entry) return Promise.reject(new Error("The prepared source is not registered."));
      // Install the foreground observer immediately, before pending setup can attach/play.
      entry.promoted = true; entry.preparationController.abort();
      if (options.policy === "decoded") { entry.source?.pause(); entry.media?.video.pause(); }
      const targetMedia = media(entry); observeVideo(targetMedia.video);
      const activation = switching.catch(() => {}).then(async () => {
        await abortable(setup(entry), entry.controller.signal); ensureOpen(entry);
        if (foreground && foreground !== entry) { foreground.source?.pause(); foreground.media?.show(false); }
        foreground = entry; targetMedia.show(true);
        attach(entry);
        // A promoted decoded preparation may have presented frames before its rewind.
        // Reset through the public Source API after observation and before foreground play.
        entry.source!.currentTime = entry.descriptor.startTimeSeconds;
        entry.source!.loadControl = 2;
        await abortable(entry.source!.play(), entry.controller.signal); ensureOpen(entry);
        return targetMedia.video;
      });
      switching = activation; return activation;
    },
    state(sourceId) {
      const entry = entries.get(sourceId);
      const video = entry?.media?.video ?? null;
      return { video, bufferSeconds: video ? observedBuffer(video) : null, readyState: video?.readyState ?? null };
    },
    async remove(sourceId) {
      const entry = entries.get(sourceId);
      if (entry) await removeEntry(entry);
    },
    dispose,
  };
}
