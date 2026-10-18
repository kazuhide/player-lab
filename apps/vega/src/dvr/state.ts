/**
 * Render-ready DVR state from a player snapshot. Pure and unit-tested — identical
 * to the web app's logic, since Vega runs the same (modular web) player API.
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

export interface DvrConfig {
  timeShiftEnabled: boolean;
  liveEdgeEpsilon?: number;
}

export interface DvrState {
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

export function deriveDvrState(s: PlayerSnapshot, config: DvrConfig): DvrState {
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

/** True when a live stream has finalized into VOD between two snapshots (§9). */
export function detectLiveToVod(prev: PlayerSnapshot, next: PlayerSnapshot): boolean {
  return isLiveStream(prev) && !isLiveStream(next);
}
