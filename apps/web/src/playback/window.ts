/**
 * DVR (timeshift) coordinate math — the web app's own copy (per the per-app
 * architecture). Live edge = `0`, the past is negative, the window's lower bound
 * is `maxTimeShift` (`<= 0`). Pure functions, unit-tested.
 */

/** Clamp a requested offset into the legal window `[maxTimeShift, 0]`. */
export function clampToWindow(requestedOffset: number, maxTimeShift: number): number {
  if (!Number.isFinite(requestedOffset)) return 0;
  if (!Number.isFinite(maxTimeShift) || maxTimeShift >= 0) return 0;
  return Math.min(0, Math.max(maxTimeShift, requestedOffset));
}

/** True within `epsilon` seconds of the live edge (offset `0`). */
export function isAtLiveEdge(currentTimeShift: number, epsilon = 1): boolean {
  return Number.isFinite(currentTimeShift) && Math.abs(currentTimeShift) <= epsilon;
}

/**
 * Clamp a VOD seek target into `[0, duration]`. A non-finite/`0` duration (not yet
 * known) means no upper clamp. Used by the ±Ns quick-seek gesture for VOD; live
 * uses {@link clampToWindow} instead.
 */
export function clampToDuration(target: number, duration: number): number {
  if (!Number.isFinite(target)) return 0;
  const lowerBounded = Math.max(0, target);
  return Number.isFinite(duration) && duration > 0 ? Math.min(duration, lowerBounded) : lowerBounded;
}

/** Window length in seconds (`>= 0`). For HLS this is `0` until the buffer fills. */
export function windowDuration(maxTimeShift: number): number {
  return Number.isFinite(maxTimeShift) && maxTimeShift < 0 ? -maxTimeShift : 0;
}

/** Distance behind the live edge in seconds (`>= 0`). */
export function behindLive(currentTimeShift: number): number {
  return Number.isFinite(currentTimeShift) && currentTimeShift < 0 ? -currentTimeShift : 0;
}

/** Normalized scrubber position in `[0, 1]`: `0` = oldest, `1` = live edge. */
export function seekProgress(currentTimeShift: number, maxTimeShift: number): number {
  const win = windowDuration(maxTimeShift);
  if (win <= 0) return 1;
  const offset = clampToWindow(currentTimeShift, maxTimeShift);
  return (win + offset) / win;
}

/** Whether the DVR window has settled (HLS reads `0` until the buffer fills). */
export function isWindowSettled(maxTimeShift: number): boolean {
  return maxTimeShift < 0;
}

/**
 * True end-to-end live latency in seconds: how far the currently-rendered frame is behind
 * real-world time. This is NOT the same as {@link behindLive} (the scrub offset, `0` at the
 * edge) — even at the live edge there is inherent encode/package/CDN/buffer delay, and
 * scrubbing back adds to it.
 *
 * Computed from the playback wall-clock (`getCurrentTime(AbsoluteTime)` — a Unix timestamp via
 * HLS `EXT-X-PROGRAM-DATE-TIME` / DASH `availabilityStartTime`) and the current device clock,
 * both in seconds. Returns `null` when the stream carries no wall clock (absolute time isn't a
 * real Unix timestamp, `<= 1e6`) or the result is implausible (negative, or `>= 24h` ⇒ the
 * device clock is skewed). Note: assumes the device clock is roughly in sync with the stream's.
 */
export function liveLatencySeconds(playbackWallClockSec: number, nowSec: number): number | null {
  // Below this, an "absolute" time is really a relative value (the stream carries no wall clock):
  // 1e6 s ≈ 11.6 days past epoch, far above any DVR-window-relative time (≤ a few hours).
  const MIN_PLAUSIBLE_UNIX_SEC = 1e6;
  // Above this the device clock is skewed vs the stream's, not a real latency.
  const MAX_PLAUSIBLE_LATENCY_SEC = 86_400; // 24h
  if (!Number.isFinite(playbackWallClockSec) || playbackWallClockSec <= MIN_PLAUSIBLE_UNIX_SEC) return null;
  const latency = nowSec - playbackWallClockSec;
  return Number.isFinite(latency) && latency >= 0 && latency < MAX_PLAUSIBLE_LATENCY_SEC ? latency : null;
}
