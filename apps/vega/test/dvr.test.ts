import { describe, expect, it } from "vitest";
import { behindLive, clampToWindow, isAtLiveEdge, seekProgress, windowDuration } from "../src/dvr/window";
import { deriveDvrState, detectLiveToVod, isLiveStream, type PlayerSnapshot } from "../src/dvr/state";

const live = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  isLive: true,
  duration: Infinity,
  maxTimeShift: -300,
  timeShift: 0,
  currentTime: 0,
  ...over,
});

describe("clampToWindow", () => {
  it("clamps beyond the window to the lower bound", () => {
    expect(clampToWindow(-500, -300)).toBe(-300);
  });
  it("clamps a positive offset to the live edge", () => {
    expect(clampToWindow(30, -300)).toBe(0);
  });
  it("keeps an in-window offset", () => {
    expect(clampToWindow(-120, -300)).toBe(-120);
  });
  it("stays at edge when timeshift unavailable", () => {
    expect(clampToWindow(-50, 0)).toBe(0);
  });
});

describe("live edge / window / behind", () => {
  it("detects the live edge within epsilon", () => {
    expect(isAtLiveEdge(-0.5)).toBe(true);
    expect(isAtLiveEdge(-30)).toBe(false);
  });
  it("derives window, behind-live and progress", () => {
    expect(windowDuration(-300)).toBe(300);
    expect(behindLive(-45)).toBe(45);
    expect(seekProgress(-150, -300)).toBeCloseTo(0.5);
  });
});

describe("deriveDvrState", () => {
  it("live + dvr enabled → live-dvr", () => {
    const s = deriveDvrState(live({ timeShift: -60 }), { timeShiftEnabled: true });
    expect(s.mode).toBe("live-dvr");
    expect(s.dvrAvailable).toBe(true);
    expect(s.behindLive).toBe(60);
    expect(s.atLiveEdge).toBe(false);
  });
  it("live + dvr disabled → live-no-dvr", () => {
    const s = deriveDvrState(live(), { timeShiftEnabled: false });
    expect(s.mode).toBe("live-no-dvr");
    expect(s.dvrAvailable).toBe(false);
  });
  it("finite duration → vod", () => {
    const s = deriveDvrState(live({ duration: 210, maxTimeShift: 0 }), { timeShiftEnabled: true });
    expect(s.mode).toBe("vod");
    expect(s.isLive).toBe(false);
  });
});

describe("live↔VOD classification (§9)", () => {
  it("Infinity/0/NaN duration ⇒ live", () => {
    expect(isLiveStream(live({ duration: Infinity }))).toBe(true);
    expect(isLiveStream(live({ duration: 0 }))).toBe(true);
    expect(isLiveStream(live({ duration: NaN }))).toBe(true);
  });
  it("finite positive duration ⇒ vod", () => {
    expect(isLiveStream(live({ duration: 210 }))).toBe(false);
  });
  it("detectLiveToVod fires only on finalization", () => {
    expect(detectLiveToVod(live(), live({ duration: 210, maxTimeShift: 0 }))).toBe(true);
    expect(detectLiveToVod(live(), live())).toBe(false);
  });
});
