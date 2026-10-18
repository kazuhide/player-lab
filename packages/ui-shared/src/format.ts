/**
 * Pure label formatters for the DVR UI. No DOM, no player — testable in isolation.
 */
import { DEFAULT_LIVE_EDGE_EPSILON, behindLiveSeconds, isAtLiveEdge } from "./liveState";

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a non-negative second count as `12s`, `1m 05s`, or `1h 02m`. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "0s";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

export interface BehindLiveOptions {
  epsilon?: number;
  liveLabel?: string;
  negativePrefix?: string;
}

/** `"LIVE"` at the edge, otherwise the behind-live offset, e.g. `"-1m 05s behind"`. */
export function formatBehindLive(timeShift: number, opts: BehindLiveOptions = {}): string {
  const epsilon = opts.epsilon ?? DEFAULT_LIVE_EDGE_EPSILON;
  const liveLabel = opts.liveLabel ?? "LIVE";
  const prefix = opts.negativePrefix ?? "-";
  if (isAtLiveEdge(timeShift, epsilon)) return liveLabel;
  return `${prefix}${formatDuration(behindLiveSeconds(timeShift))} behind`;
}

export interface WallClockOptions {
  utc?: boolean;
  withSeconds?: boolean;
}

/** Format a UNIX-seconds time as `HH:MM:SS` (local by default). */
export function formatWallClock(unixSeconds: number, opts: WallClockOptions = {}): string {
  const utc = opts.utc ?? false;
  const withSeconds = opts.withSeconds ?? true;
  if (!Number.isFinite(unixSeconds)) return withSeconds ? "--:--:--" : "--:--";
  const d = new Date(unixSeconds * 1000);
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
}
