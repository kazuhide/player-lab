/**
 * DVR (timeshift) coordinate math — Vega's own copy (per the per-app architecture).
 * Vega runs the modular *web* player, so the player API and DVR semantics match the
 * web app exactly; this is the same logic as `apps/web/src/playback/window.ts`.
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
