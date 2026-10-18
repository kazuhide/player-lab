/**
 * Pure, UI-local DVR helpers for the LIVE button. No DOM, no player — so they are
 * trivially testable. Timeshift offsets are `<= 0`; the live edge is `0`.
 */

/** Seconds within the live edge still treated as "at live". */
export const DEFAULT_LIVE_EDGE_EPSILON = 1;

/** True when the timeshift offset is within `epsilon` of the live edge (0). */
export function isAtLiveEdge(timeShift: number, epsilon: number = DEFAULT_LIVE_EDGE_EPSILON): boolean {
  return Number.isFinite(timeShift) && Math.abs(timeShift) <= epsilon;
}

/** Seconds behind the live edge (`>= 0`); `0` at or ahead of the edge. */
export function behindLiveSeconds(timeShift: number): number {
  return Number.isFinite(timeShift) && timeShift < 0 ? -timeShift : 0;
}

/** What the LIVE button should display. */
export type LiveButtonState = "hidden" | "at-edge" | "behind";

/**
 * Decide the LIVE button state from the player's live flag and timeshift offset.
 * Hidden for VOD; "at-edge" within `epsilon` of live; otherwise "behind".
 */
export function deriveLiveButtonState(
  isLive: boolean,
  timeShift: number,
  epsilon: number = DEFAULT_LIVE_EDGE_EPSILON,
): LiveButtonState {
  if (!isLive) return "hidden";
  return isAtLiveEdge(timeShift, epsilon) ? "at-edge" : "behind";
}
