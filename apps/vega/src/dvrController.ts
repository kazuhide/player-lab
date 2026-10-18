/**
 * DVR wiring on top of the modular player's `PlayerAPI` — the platform glue between
 * the Bitmovin player and the pure DVR logic. Framework-agnostic (no React/Kepler),
 * so it type-checks directly against `bitmovin-player` and is the most useful part
 * to verify: it's where the player-API surface is actually used.
 *
 * Vega runs the *web* player, so this mirrors the web app: `DVRWindowExceeded` is a
 * real event here (unlike React Native), and live→VOD is driven by `DurationChanged`.
 */
import type { PlayerAPI } from "bitmovin-player";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";
import { clampToWindow } from "./dvr/window";
import { deriveDvrState, detectLiveToVod, type DvrState, type PlayerSnapshot } from "./dvr/state";

export type DvrUpdate = (state: DvrState, log?: string) => void;

export class DvrController {
  private prev: PlayerSnapshot | null = null;
  private timeShiftEnabled = true;
  private disposed = false;

  constructor(
    private readonly player: PlayerAPI,
    private readonly onUpdate: DvrUpdate,
  ) {
    player.on(PlayerEvent.TimeChanged, this.handleRefresh);
    player.on(PlayerEvent.SourceLoaded, this.handleSourceLoaded);
    player.on(PlayerEvent.TimeShifted, this.handleTimeShifted);
    player.on(PlayerEvent.DurationChanged, this.handleDurationChanged);
    // §5.3: the web/modular player emits DVRWindowExceeded — recover to the edge.
    player.on(PlayerEvent.DVRWindowExceeded, this.handleWindowExceeded);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.player.off(PlayerEvent.TimeChanged, this.handleRefresh);
    this.player.off(PlayerEvent.SourceLoaded, this.handleSourceLoaded);
    this.player.off(PlayerEvent.TimeShifted, this.handleTimeShifted);
    this.player.off(PlayerEvent.DurationChanged, this.handleDurationChanged);
    this.player.off(PlayerEvent.DVRWindowExceeded, this.handleWindowExceeded);
  }

  setTimeShiftEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.timeShiftEnabled = enabled;
    this.emit();
  }

  goToLiveEdge(): void {
    if (this.disposed) return;
    this.player.timeShift(0);
  }

  /** Seek to an offset relative to the live edge (timeShift semantics), clamped. */
  seek(offsetFromEdge: number): void {
    if (this.disposed) return;
    const target = this.timeShiftEnabled ? clampToWindow(offsetFromEdge, this.player.getMaxTimeShift()) : 0;
    this.player.timeShift(target);
  }

  private snapshot(): PlayerSnapshot {
    return {
      isLive: this.player.isLive(),
      duration: this.player.getDuration(),
      maxTimeShift: this.player.getMaxTimeShift(),
      timeShift: this.player.getTimeShift(),
      currentTime: this.player.getCurrentTime(),
    };
  }

  private emit(log?: string): void {
    if (this.disposed) return;
    const snap = this.snapshot();
    let line = log;
    if (this.prev && detectLiveToVod(this.prev, snap)) line = "live→VOD";
    this.prev = snap;
    this.onUpdate(deriveDvrState(snap, { timeShiftEnabled: this.timeShiftEnabled }), line);
  }

  private readonly handleRefresh = (): void => this.emit();
  private readonly handleSourceLoaded = (): void => this.emit("SourceLoaded");
  private readonly handleTimeShifted = (): void => this.emit("TimeShifted");
  private readonly handleDurationChanged = (): void => this.emit("DurationChanged");
  private readonly handleWindowExceeded = (): void => {
    if (this.disposed) return;
    this.player.timeShift(0);
    this.emit("DVRWindowExceeded → recover");
  };
}
