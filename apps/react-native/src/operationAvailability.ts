import type { Player } from "bitmovin-player-react-native";
import type { NativeSettings } from "./nativeSettings";

export interface NativePlaybackContext {
  loaded: boolean;
  live: boolean | null;
  maxTimeShift: number;
  linearAd: boolean;
  nonLinearAd: boolean;
  castAvailable: boolean;
  casting: boolean;
}
const empty = (): NativePlaybackContext => ({ loaded: false, live: null, maxTimeShift: 0,
  linearAd: false, nonLinearAd: false, castAvailable: false, casting: false });

/** Capability observations belong to one player and current source, never to the event log. */
export class NativeOperationContext {
  private state = empty();
  private source: Player["source"];
  private generation = 0;
  private active = true;
  private reading: Promise<boolean> | undefined;
  private offlineRequested = false;
  private offlineLoaded = false;
  constructor(private readonly player: Player, private readonly changed: () => void = () => {}) {}
  snapshot(): NativePlaybackContext {
    return this.source === this.player.source ? this.state : empty();
  }
  reset(offlineRequested = false): void {
    this.generation++; this.source = this.player.source; this.state = empty();
    this.offlineRequested = offlineRequested; this.offlineLoaded = false; this.changed();
  }
  retire(): void { this.active = false; this.reset(); }
  event(name: string): void {
    if (!this.active) return;
    if (this.source !== this.player.source) this.reset(this.offlineRequested && !this.offlineLoaded && !this.player.source);
    // isAd is false for pause ads; their independent public lifecycle is required.
    if (name === "onNonLinearAdStarted") this.state = { ...this.state, nonLinearAd: true };
    else if (["onNonLinearAdFinished", "onNonLinearAdSkipped"].includes(name)) this.state = { ...this.state, nonLinearAd: false };
    else if (["onAdBreakStarted", "onAdStarted"].includes(name)) this.state = { ...this.state, linearAd: true };
    else if (["onAdBreakFinished", "onAdFinished", "onAdSkipped"].includes(name)) this.state = { ...this.state, linearAd: false };
    else if (name === "onSourceLoaded" && this.offlineRequested && !this.player.source) { this.offlineLoaded = true; this.state = { ...this.state, loaded: true }; }
    else if (name === "onSourceLoad") { this.reset(this.offlineRequested); return; }
    else if (name === "onSourceUnloaded") { this.reset(this.offlineRequested && !this.offlineLoaded); return; }
    else if (["onSourceError", "onPlayerError", "onDestroy"].includes(name)) { this.reset(); return; }
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
      const [loading, live, maxTimeShift, linearAd, castAvailable, casting] = await Promise.all(reads);
      if (!this.active || this.player.isDestroyed || source !== this.player.source || generation !== this.generation) return false;
      this.state = { ...this.state, loaded: loading === 2, live, maxTimeShift, linearAd, castAvailable, casting };
      this.changed();
      return true;
    } catch {
      await Promise.allSettled(reads);
      if (this.active && source === this.player.source && generation === this.generation) {
        this.state = { ...empty(), nonLinearAd: this.state.nonLinearAd }; this.changed();
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
  settings: NativeSettings, dvrAllowed: boolean, values: Record<string, string> = {}): string | undefined {
  if (player.isDestroyed) return "Recreate the player before running this operation.";
  if (platform !== "ios" && (id.includes("AirPlay") || id.startsWith("Source.drm.fairplay."))) return "This operation requires iOS.";
  if (platform !== "android" && id === "BitmovinCastManager.updateContext") return "This operation requires Android.";
  if (id.startsWith("Player.analytics.") && !player.analytics) return "Configure Analytics before creating this player.";
  if (id.startsWith("Source.")) {
    if (!player.source || player.source.isDestroyed) return "Load a source first.";
    if (id.startsWith("Source.drm.") && !player.source.drm) return "Load a DRM-configured source first.";
    if (id.startsWith("Source.drm.fairplay.") && !player.source.drm?.fairplay) return "Load a FairPlay-configured source first.";
  }
  if (sessionMethods.has(id) && !state.loaded) return "Wait for a loaded source.";
  if (id === "Player.skipAd" && !state.linearAd && !state.nonLinearAd) return "No active ad is available to skip.";
  if ((id === "Player.seek" || id === "Player.timeShift") && state.linearAd) return "Wait for the linear ad to finish.";
  if (id === "Player.seek" && state.live !== false) return "Seek requires an on-demand source.";
  if (id === "Player.timeShift") {
    if (state.live !== true) return "Time shift requires a live source.";
    // Returning to the edge remains available when live rewind is disabled.
    if (Number(values.value ?? "0") !== 0 && (!dvrAllowed || !Number.isFinite(state.maxTimeShift) || state.maxTimeShift >= 0)) return "Live rewind is unavailable for this source or setting.";
  }
  if (id === "Player.scheduleAd" && !settings.player.advertisingConfig?.schedule.length) return "Apply an advertising schedule first.";
  if (id === "Player.castVideo" && !state.castAvailable) return "No Cast receiver is available.";
  if (["Player.castStop", "BitmovinCastManager.sendMessage"].includes(id) && !state.casting) return "No Cast session is active.";
  return undefined;
}
