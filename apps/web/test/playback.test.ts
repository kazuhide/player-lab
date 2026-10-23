import { describe, expect, it } from "vitest";
import {
  behindLive,
  clampToDuration,
  clampToWindow,
  isAtLiveEdge,
  liveLatencySeconds,
  seekProgress,
  windowDuration,
} from "../src/playback/window";
import { deriveTimelineState, detectLiveToVod, isLiveStream, type PlayerSnapshot } from "../src/playback/state";

describe("window math", () => {
  it("clamps into the window and snaps positives to the edge", () => {
    expect(clampToWindow(-500, -300)).toBe(-300);
    expect(clampToWindow(-100, -300)).toBe(-100);
    expect(clampToWindow(5, -300)).toBe(0);
    expect(clampToWindow(-100, 0)).toBe(0);
    expect(clampToWindow(Number.NaN, -300)).toBe(0);
  });
  it("detects the live edge", () => {
    expect(isAtLiveEdge(-0.5)).toBe(true);
    expect(isAtLiveEdge(-2)).toBe(false);
    expect(isAtLiveEdge(Number.NaN)).toBe(false);
  });
  it("derives window / behind-live / progress", () => {
    expect(windowDuration(-300)).toBe(300);
    expect(windowDuration(0)).toBe(0);
    expect(behindLive(-60)).toBe(60);
    expect(seekProgress(-150, -300)).toBe(0.5);
    expect(seekProgress(0, 0)).toBe(1);
  });
  it("clamps VOD seek targets into [0, duration]", () => {
    expect(clampToDuration(50, 120)).toBe(50); // inside
    expect(clampToDuration(-10, 120)).toBe(0); // below start → 0
    expect(clampToDuration(200, 120)).toBe(120); // past end → duration
    expect(clampToDuration(200, Number.POSITIVE_INFINITY)).toBe(200); // live/unknown → no upper clamp
    expect(clampToDuration(Number.NaN, 120)).toBe(0);
  });
});

const live: PlayerSnapshot = {
  isLive: true,
  duration: Number.POSITIVE_INFINITY,
  maxTimeShift: -300,
  timeShift: 0,
  currentTime: 1000,
};

describe("playback timing state", () => {
  it("reports live-dvr at the edge", () => {
    const s = deriveTimelineState(live, { timeShiftEnabled: true });
    expect(s.mode).toBe("live-dvr");
    expect(s.dvrAvailable).toBe(true);
    expect(s.atLiveEdge).toBe(true);
    expect(s.windowDuration).toBe(300);
  });
  it("is live-no-dvr when DVR is forbidden by config", () => {
    expect(deriveTimelineState(live, { timeShiftEnabled: false }).mode).toBe("live-no-dvr");
  });
  it("is live-no-dvr when the HLS window has not settled", () => {
    expect(deriveTimelineState({ ...live, maxTimeShift: 0 }, { timeShiftEnabled: true }).dvrAvailable).toBe(false);
  });
  it("classifies VOD by finite duration and detects live->VOD", () => {
    expect(isLiveStream({ ...live, duration: 3600 })).toBe(false);
    expect(detectLiveToVod(live, { ...live, duration: 3600 })).toBe(true);
    expect(detectLiveToVod(live, live)).toBe(false);
  });
});

describe("live latency (wall-clock)", () => {
  const wall = 1_700_000_000; // a plausible Unix timestamp (seconds)

  it("is now − playback wall-clock, and is non-zero at the edge", () => {
    expect(liveLatencySeconds(wall, wall + 12)).toBe(12); // ~12s inherent latency at the edge
    expect(liveLatencySeconds(wall, wall + 72)).toBe(72); // scrubbed ~60s back ⇒ latency grows
  });

  it("returns null when the stream carries no wall clock (relative/absent absolute time)", () => {
    expect(liveLatencySeconds(12.3, Date.now() / 1000)).toBeNull(); // small relative number, not a Unix ts
    expect(liveLatencySeconds(0, Date.now() / 1000)).toBeNull();
    expect(liveLatencySeconds(Number.NaN, Date.now() / 1000)).toBeNull();
  });

  it("rejects implausible values (negative, or device-clock skew)", () => {
    expect(liveLatencySeconds(wall + 5, wall)).toBeNull(); // now before playback ⇒ negative
    expect(liveLatencySeconds(wall, wall + 90_000)).toBeNull(); // >= 24h ⇒ skewed clock
  });
});
