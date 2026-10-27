import type { AdStartedEvent, NonLinearAdStartedEvent, Player } from "bitmovin-player-react-native";
import type { NativeSettings } from "./nativeSettings";

export interface NativePlaybackContext {
  loaded: boolean;
  failure: "source" | "player" | null;
  live: boolean | null;
  maxTimeShift: number;
  linearAd: boolean;
  adPlaying: boolean;
  adSkipOffset: number | null;
  adClientType: AdStartedEvent["clientType"] | null;
  adTime: number | null;
  nonLinearAd: boolean;
  castAvailable: boolean;
  casting: boolean;
  audioTrackIds: string[] | null;
  subtitleTrackIds: string[] | null;
  videoQualityIds: string[] | null;
}
const empty = (failure: NativePlaybackContext["failure"] = null): NativePlaybackContext => ({ loaded: false, failure, live: null, maxTimeShift: 0,
  linearAd: false, adPlaying: false, adSkipOffset: null, adClientType: null, adTime: null,
  nonLinearAd: false, castAvailable: false, casting: false, audioTrackIds: null, subtitleTrackIds: null, videoQualityIds: null });

function adPayload(value: unknown): Partial<AdStartedEvent & NonLinearAdStartedEvent> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
const clearLinearAd = { linearAd: false, adPlaying: false, adSkipOffset: null, adClientType: null, adTime: null } as const;

function catalogIds(result: PromiseSettledResult<unknown>, key: "identifier" | "id"): string[] | null {
  if (result.status !== "fulfilled" || !Array.isArray(result.value)) return null;
  return result.value.flatMap(value => value && typeof value === "object" && typeof value[key] === "string" && value[key].length
    ? [value[key] as string] : []);
}

// RN 1.29 forwards Android's enum name and iOS's ordinal without normalization.
const sourceIsLoaded = (value: unknown): boolean => value === "LOADED" || value === 2;

/** Capability observations belong to one player and current source, never to the event log. */
export class NativeOperationContext {
  private state = empty();
  private source: Player["source"];
  private generation = 0;
  private active = true;
  private reading: Promise<boolean> | undefined;
  private offlineRequested = false;
  private offlineLoaded = false;
  private sourceFailed = false;
  private playerFailed = false;
  constructor(private readonly player: Player, private readonly changed: () => void = () => {}) {}
  snapshot(): NativePlaybackContext {
    return this.source === this.player.source ? this.state : empty(this.playerFailed ? "player" : null);
  }
  reset(offlineRequested = false): void {
    if (this.source !== this.player.source) this.sourceFailed = false;
    this.generation++; this.source = this.player.source; this.state = empty(this.failure());
    this.offlineRequested = offlineRequested; this.offlineLoaded = false; this.changed();
  }
  private failure(): NativePlaybackContext["failure"] { return this.playerFailed ? "player" : this.sourceFailed ? "source" : null; }
  retire(): void { this.active = false; this.reset(); }
  event(name: string, payload?: unknown): void {
    if (!this.active) return;
    if (this.source !== this.player.source) this.reset(this.offlineRequested && !this.offlineLoaded && !this.player.source);
    // isAd is false for pause ads; their independent public lifecycle is required.
    if (name === "onNonLinearAdStarted") this.state = { ...this.state, nonLinearAd: adPayload(payload).ad?.isLinear === false };
    else if (["onNonLinearAdFinished", "onNonLinearAdSkipped"].includes(name)) this.state = { ...this.state, nonLinearAd: false };
    else if (name === "onAdStarted") {
      const ad = adPayload(payload);
      this.state = { ...this.state, ...clearLinearAd, linearAd: true, nonLinearAd: false,
        adSkipOffset: typeof ad.skipOffset === "number" && Number.isFinite(ad.skipOffset) ? ad.skipOffset : null,
        adClientType: typeof ad.clientType === "string" && ["bitmovin", "progressive", "ima"].includes(ad.clientType) ? ad.clientType : null };
    }
    else if (name === "onAdBreakStarted") this.state = { ...this.state, ...clearLinearAd, linearAd: true };
    else if (["onAdBreakFinished", "onAdFinished", "onAdSkipped"].includes(name)) this.state = { ...this.state, ...clearLinearAd };
    else if (name === "onAdError") this.state = { ...this.state, ...clearLinearAd, nonLinearAd: false };
    else if (name === "onSourceLoaded" && this.offlineRequested && !this.player.source) { this.offlineLoaded = true; this.state = { ...this.state, loaded: !this.failure() }; }
    else if (name === "onSourceLoad") { this.sourceFailed = false; this.reset(this.offlineRequested); return; }
    else if (name === "onSourceUnloaded") { this.reset(this.offlineRequested && !this.offlineLoaded); return; }
    else if (name === "onSourceError") { this.sourceFailed = true; this.reset(); return; }
    else if (["onPlayerError", "onDestroy"].includes(name)) { this.playerFailed = true; this.reset(); return; }
    else if (["onAudioAdded", "onAudioRemoved"].includes(name)) this.state = { ...this.state, audioTrackIds: null };
    else if (["onSubtitleAdded", "onSubtitleRemoved"].includes(name)) this.state = { ...this.state, subtitleTrackIds: null };
    else return;
    this.generation++;
    this.changed();
  }
  refresh(fresh = false): Promise<boolean> {
    // Event bursts share one batch. Explicit dispatch waits for that batch, then reads again.
    if (fresh && this.reading) return this.reading.then(() => this.refresh());
    if (this.reading) return this.reading;
    const pending = this.read().finally(() => { if (this.reading === pending) this.reading = undefined; });
    this.reading = pending;
    return pending;
  }
  private async read(): Promise<boolean> {
    if (!this.active || this.player.isDestroyed) return false;
    if (this.source !== this.player.source) this.reset(this.offlineRequested && !this.offlineLoaded && !this.player.source);
    const source = this.player.source;
    const generation = this.generation;
    const reads = (source && !source.isDestroyed && source.isInitialized) || this.offlineLoaded ? [
      source ? Promise.resolve().then(() => source.loadingState()) : Promise.resolve(2), this.player.isLive(), this.player.getMaxTimeShift(), this.player.isAd(),
      this.player.isCastAvailable(), this.player.isCasting(),
    ] as const : undefined;
    if (!reads) return false;
    try {
      const [loading, live, maxTimeShift, nativeAd, castAvailable, casting] = await Promise.all(reads);
      const current = () => this.active && !this.player.isDestroyed && !source?.isDestroyed && source === this.player.source && generation === this.generation;
      if (!current()) return false;
      const failure = this.failure();
      const loaded = sourceIsLoaded(loading) && !failure;
      let linearAd = loaded && nativeAd;
      let adTime: number | null = null;
      // Relative time is ad-relative for VOD. RN's native live time-mode offsets
      // are not an independently readable ad clock, so live thresholds stay unavailable.
      if (linearAd && live === false) {
        const time = await this.player.getCurrentTime("relative");
        if (!current()) return false;
        linearAd = await this.player.isAd();
        if (!current()) return false;
        if (linearAd && Number.isFinite(time) && time >= 0) adTime = time;
      }
      // Catalogs can change within one Source. A failed list read blocks only its setter.
      const catalogs = loaded ? await Promise.allSettled([
        Promise.resolve().then(() => current() ? this.player.getAvailableAudioTracks() : null),
        Promise.resolve().then(() => current() ? this.player.getAvailableSubtitles() : null),
        Promise.resolve().then(() => current() ? this.player.getAvailableVideoQualities() : null),
      ]) : null;
      if (!current()) return false;
      this.state = { ...this.state, ...(!linearAd ? clearLinearAd : {}), loaded, failure,
        live, maxTimeShift, linearAd, adPlaying: linearAd, adTime, castAvailable, casting,
        audioTrackIds: catalogs ? catalogIds(catalogs[0]!, "identifier") : null,
        subtitleTrackIds: catalogs ? catalogIds(catalogs[1]!, "identifier") : null,
        videoQualityIds: catalogs ? catalogIds(catalogs[2]!, "id") : null };
      this.changed();
      return true;
    } catch {
      await Promise.allSettled(reads);
      if (this.active && source === this.player.source && generation === this.generation) {
        this.state = { ...empty(this.failure()), nonLinearAd: this.state.nonLinearAd }; this.changed();
      }
      return false;
    }
  }
}

const sessionMethods = new Set(["Player.play", "Player.pause", "Player.seek", "Player.timeShift", "Player.skipAd", "Player.scheduleAd",
  "Player.getDuration", "Player.getCurrentTime", "Player.getTimeShift", "Player.getMaxTimeShift", "Player.getThumbnail",
  "Player.setAudioTrack", "Player.getAudioTrack", "Player.getAvailableAudioTracks", "Player.setSubtitleTrack", "Player.getSubtitleTrack",
  "Player.getAvailableSubtitles", "Player.setVideoQuality", "Player.getVideoQuality", "Player.getAvailableVideoQualities",
  "Player.castVideo", "Player.setPlaybackSpeed"]);

export const operationNeedsFreshContext = (id: string): boolean => sessionMethods.has(id) || id === "Player.castStop" || id === "BitmovinCastManager.sendMessage";

export function operationUnavailable(id: string, player: Player, state: NativePlaybackContext, platform: string,
  settings: NativeSettings, dvrAllowed: boolean, values?: Record<string, string>): string | undefined {
  if (player.isDestroyed) return "Recreate the player before running this operation.";
  if (platform !== "ios" && (id.includes("AirPlay") || id.startsWith("Source.drm.fairplay."))) return "This operation requires iOS.";
  if (platform !== "android" && ["BitmovinCastManager.updateContext", "Player.setVideoQuality"].includes(id)) return "This operation requires Android.";
  if (id.startsWith("Player.analytics.") && !player.analytics) return "Configure Analytics before creating this player.";
  if (id.startsWith("Source.")) {
    if (!player.source || player.source.isDestroyed) return "Load a source first.";
    if (id.startsWith("Source.drm.") && !player.source.drm) return "Load a DRM-configured source first.";
    if (id.startsWith("Source.drm.fairplay.") && !player.source.drm?.fairplay) return "Load a FairPlay-configured source first.";
  }
  if (sessionMethods.has(id)) {
    if (state.failure === "player") return "Recreate the player after the player error.";
    if (state.failure === "source") return "Load a source again after the source error.";
    if (!state.loaded) return "Wait for a loaded source.";
  }
  if (id === "Player.setAudioTrack") {
    if (!state.audioTrackIds) return "Wait for the current audio track list.";
    if (values ? !state.audioTrackIds.includes(values.value ?? "") : !state.audioTrackIds.length) return "Choose an available audio track identifier.";
  }
  if (id === "Player.setSubtitleTrack" && values?.value) {
    if (!state.subtitleTrackIds) return "Wait for the current subtitle track list.";
    if (!state.subtitleTrackIds.includes(values.value)) return "Choose an available subtitle identifier or leave it blank.";
  }
  if (id === "Player.setVideoQuality" && values && values.value !== "auto") {
    if (!state.videoQualityIds) return "Wait for the current video quality list.";
    if (!state.videoQualityIds.includes(values.value ?? "")) return "Choose an available quality ID or auto.";
  }
  if (id === "Player.skipAd") {
    if (!state.linearAd && !state.nonLinearAd) return "No active ad is available to skip.";
    if (state.linearAd) {
      // RN 1.29 does not expose preferredUiType; it cannot prove IMA programmatic skip is enabled.
      if (state.adClientType === "ima") return "Programmatic skipping is unavailable for IMA ads.";
      if (!["bitmovin", "progressive"].includes(state.adClientType ?? "") || state.adSkipOffset === null) return "The current ad's skip metadata is unavailable.";
      if (state.adSkipOffset < 0) return "This ad does not allow skipping.";
      if (state.adSkipOffset > 0 && state.live !== false && state.adTime === null) return "The live ad's playback position cannot be verified.";
      if (!state.adPlaying || (state.adSkipOffset > 0 && state.adTime === null)) return "Wait for a current native ad position.";
      if (state.adTime !== null && state.adTime < state.adSkipOffset) return "Wait until the ad's skip offset is reached.";
    }
  }
  if ((id === "Player.seek" || id === "Player.timeShift") && state.linearAd) return "Wait for the linear ad to finish.";
  if (id === "Player.seek" && state.live !== false) return "Seek requires an on-demand source.";
  if (id === "Player.timeShift") {
    if (state.live !== true) return "Time shift requires a live source.";
    // Returning to the edge remains available when live rewind is disabled.
    if (Number(values?.value ?? "0") !== 0 && (!dvrAllowed || !Number.isFinite(state.maxTimeShift) || state.maxTimeShift >= 0)) return "Live rewind is unavailable for this source or setting.";
  }
  if (id === "Player.scheduleAd" && !settings.player.advertisingConfig?.schedule.length) return "Apply an advertising schedule first.";
  if (id === "Player.castVideo" && !state.castAvailable) return "No Cast receiver is available.";
  if (["Player.castStop", "BitmovinCastManager.sendMessage"].includes(id) && !state.casting) return "No Cast session is active.";
  return undefined;
}
