/**
 * Playback quality metrics computed from the player's event stream — startup
 * time, rebuffering %, error count, seek time, and live latency. Pure and
 * unit-tested: events carry explicit timestamps so the logic is deterministic.
 *
 * This is the in-demo readout. It complements (does not replace) Bitmovin
 * Analytics — the player is also configured with an `AnalyticsConfig` (see
 * `main.ts`), which reports the same class of signals to the Analytics dashboard.
 */

export type MetricsEvent =
  | { type: "load"; t: number }
  | { type: "playing"; t: number }
  | { type: "paused"; t: number }
  | { type: "stallStart"; t: number }
  | { type: "stallEnd"; t: number }
  | { type: "ended"; t: number }
  | { type: "unload"; t: number }
  | { type: "error" }
  | { type: "seek"; t: number }
  | { type: "seeked"; t: number }
  | { type: "liveLatency"; seconds: number } // wall-clock: now − playback PDT (vs real-time)
  | { type: "sdkLatency"; seconds: number }; // player.lowlatency.getLatency() (vs the live edge)

type Phase = "idle" | "playing" | "stalled" | "paused";

export interface MetricsState {
  phase: Phase;
  phaseSince: number;
  loadAt: number | null;
  startupMs: number | null;
  watchedMs: number;
  rebufferMs: number;
  rebufferCount: number;
  errorCount: number;
  seekAt: number | null;
  lastSeekMs: number | null;
  liveLatencySec: number | null;
  sdkLatencySec: number | null;
}

export interface MetricsSnapshot {
  startupMs: number | null;
  watchedMs: number;
  rebufferMs: number;
  rebufferRatio: number;
  rebufferCount: number;
  errorCount: number;
  lastSeekMs: number | null;
  liveLatencySec: number | null;
  sdkLatencySec: number | null;
}

export function initialMetrics(): MetricsState {
  return {
    phase: "idle",
    phaseSince: 0,
    loadAt: null,
    startupMs: null,
    watchedMs: 0,
    rebufferMs: 0,
    rebufferCount: 0,
    errorCount: 0,
    seekAt: null,
    lastSeekMs: null,
    liveLatencySec: null,
    sdkLatencySec: null,
  };
}

/** Credit elapsed time in the current phase to the right accumulator. */
function settle(s: MetricsState, now: number): MetricsState {
  const elapsed = Math.max(0, now - s.phaseSince);
  if (s.phase === "playing") return { ...s, watchedMs: s.watchedMs + elapsed, phaseSince: now };
  if (s.phase === "stalled") return { ...s, rebufferMs: s.rebufferMs + elapsed, phaseSince: now };
  return { ...s, phaseSince: now };
}

export function reduceMetrics(state: MetricsState, ev: MetricsEvent): MetricsState {
  switch (ev.type) {
    case "load":
      // A new source resets the per-session metrics.
      return { ...initialMetrics(), loadAt: ev.t, phaseSince: ev.t };
    case "unload":
      return { ...initialMetrics(), phaseSince: ev.t };
    case "ended":
      return { ...settle(state, ev.t), phase: "idle", loadAt: null, seekAt: null };
    case "playing": {
      const s = settle(state, ev.t);
      const startupMs = s.startupMs ?? (s.loadAt !== null ? ev.t - s.loadAt : null);
      return { ...s, startupMs, phase: "playing", phaseSince: ev.t };
    }
    case "paused": {
      const s = settle(state, ev.t);
      return { ...s, phase: "paused", phaseSince: ev.t };
    }
    case "stallStart": {
      // Buffering before the first frame is startup, not rebuffering.
      if (state.startupMs === null || state.phase !== "playing") return state;
      const s = settle(state, ev.t);
      return { ...s, phase: "stalled", phaseSince: ev.t, rebufferCount: s.rebufferCount + 1 };
    }
    case "stallEnd": {
      if (state.phase !== "stalled") return state;
      const s = settle(state, ev.t);
      return { ...s, phase: "playing", phaseSince: ev.t };
    }
    case "error":
      return { ...state, errorCount: state.errorCount + 1 };
    case "seek":
      return { ...state, seekAt: ev.t };
    case "seeked":
      return { ...state, lastSeekMs: state.seekAt !== null ? ev.t - state.seekAt : state.lastSeekMs, seekAt: null };
    case "liveLatency":
      return { ...state, liveLatencySec: ev.seconds };
    case "sdkLatency":
      return { ...state, sdkLatencySec: ev.seconds };
  }
}

/** Include the active phase at `now` without committing or double-counting it. */
export function metricsSnapshot(state: MetricsState, now = state.phaseSince): MetricsSnapshot {
  const s = settle(state, now);
  const denom = s.watchedMs + s.rebufferMs;
  return {
    startupMs: s.startupMs,
    watchedMs: s.watchedMs,
    rebufferMs: s.rebufferMs,
    rebufferRatio: denom > 0 ? s.rebufferMs / denom : 0,
    rebufferCount: s.rebufferCount,
    errorCount: s.errorCount,
    lastSeekMs: s.lastSeekMs,
    liveLatencySec: s.liveLatencySec,
    sdkLatencySec: s.sdkLatencySec,
  };
}
