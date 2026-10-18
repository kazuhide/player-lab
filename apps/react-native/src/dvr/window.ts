/**
 * DVR (timeshift) coordinate math — the React Native app's own copy (per the
 * per-app architecture). Identical to the web app's `src/dvr/window.ts`; the only
 * RN difference is upstream — the player reads are async (Promise-based), so the
 * app awaits them into a `PlayerSnapshot` before calling these sync functions.
 */

export function clampToWindow(requestedOffset: number, maxTimeShift: number): number {
  if (!Number.isFinite(requestedOffset)) return 0;
  if (!Number.isFinite(maxTimeShift) || maxTimeShift >= 0) return 0;
  return Math.min(0, Math.max(maxTimeShift, requestedOffset));
}

export function isAtLiveEdge(currentTimeShift: number, epsilon = 1): boolean {
  return Number.isFinite(currentTimeShift) && Math.abs(currentTimeShift) <= epsilon;
}

export function windowDuration(maxTimeShift: number): number {
  return Number.isFinite(maxTimeShift) && maxTimeShift < 0 ? -maxTimeShift : 0;
}

export function behindLive(currentTimeShift: number): number {
  return Number.isFinite(currentTimeShift) && currentTimeShift < 0 ? -currentTimeShift : 0;
}

export function seekProgress(currentTimeShift: number, maxTimeShift: number): number {
  const win = windowDuration(maxTimeShift);
  if (win <= 0) return 1;
  const offset = clampToWindow(currentTimeShift, maxTimeShift);
  return (win + offset) / win;
}

export function isWindowSettled(maxTimeShift: number): boolean {
  return maxTimeShift < 0;
}
