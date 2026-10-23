/**
 * Render-ready playback timing state for the control panel, derived from a plain snapshot of
 * the player. Pure and unit-tested.
 */
import { behindLive, clampToWindow, isAtLiveEdge, seekProgress, windowDuration } from "./window";

export type PlaybackMode = "vod" | "live-dvr" | "live-no-dvr";

export interface PlayerSnapshot {
  isLive: boolean;
  duration: number;
  maxTimeShift: number;
  timeShift: number;
  currentTime: number;
}

export interface TimelineConfig {
  timeShiftEnabled: boolean;
  liveEdgeEpsilon?: number;
}

export interface TimelineState {
  mode: PlaybackMode;
  isLive: boolean;
  dvrAvailable: boolean;
  windowDuration: number;
  behindLive: number;
  atLiveEdge: boolean;
  seekProgress: number;
}

/**
 * Whether a snapshot is live. A finite, positive `duration` is the authoritative
 * VOD signal (live duration is `Infinity`); a `0`/`NaN` duration is "not yet
 * known" and treated as live until it settles.
 */
export function isLiveStream(s: PlayerSnapshot): boolean {
  if (Number.isFinite(s.duration) && s.duration > 0) return false;
  return true;
}

/** Derive the control panel's playback timing state from a snapshot + config. */
export function deriveTimelineState(s: PlayerSnapshot, config: TimelineConfig): TimelineState {
  const epsilon = config.liveEdgeEpsilon ?? 1;
  const live = isLiveStream(s);
  const win = windowDuration(s.maxTimeShift);
  const dvrAvailable = live && config.timeShiftEnabled && win > 0;
  const mode: PlaybackMode = !live ? "vod" : dvrAvailable ? "live-dvr" : "live-no-dvr";
  const offset = clampToWindow(s.timeShift, s.maxTimeShift);
  return {
    mode,
    isLive: live,
    dvrAvailable,
    windowDuration: win,
    behindLive: live ? behindLive(offset) : 0,
    atLiveEdge: live ? isAtLiveEdge(offset, epsilon) : false,
    seekProgress: live ? seekProgress(offset, s.maxTimeShift) : 1,
  };
}

/** True when a live stream has just finalized into VOD between two snapshots. */
export function detectLiveToVod(prev: PlayerSnapshot, next: PlayerSnapshot): boolean {
  return isLiveStream(prev) && !isLiveStream(next);
}
