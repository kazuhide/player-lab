/**
 * Render-ready playback timing state from a player snapshot. Pure and unit-tested. The RN app
 * builds the snapshot by awaiting the async player reads (`getMaxTimeShift()`,
 * `getTimeShift()`, …) and feeds it here.
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

export function isLiveStream(s: PlayerSnapshot): boolean {
  if (Number.isFinite(s.duration) && s.duration > 0) return false;
  return true;
}

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

/**
 * True when a live stream has finalized into VOD between two snapshots. Critical
 * on RN: there is **no `onDurationChanged`** event, so the app polls snapshots on
 * `onTimeChanged` and feeds consecutive pairs here (§9).
 */
export function detectLiveToVod(prev: PlayerSnapshot, next: PlayerSnapshot): boolean {
  return isLiveStream(prev) && !isLiveStream(next);
}
