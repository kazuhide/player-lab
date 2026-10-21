import { expect, it, vi } from "vitest";
import type { PlayerAPI } from "bitmovin-player";
vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  PlayerEvent: { SourceLoaded: "sourceloaded", CueEnter: "cueenter", Error: "error" },
}));
import { createRuntimeMonitor } from "../src/runtimeObservation";

it("observes only public getters, retires callbacks, and distinguishes the release barrier", () => {
  const listeners = new Map<string, (event?: unknown) => void>();
  const player = { getCurrentTime: () => 5, getDuration: () => 60, isLive: () => false, isPlaying: () => true, isMuted: () => true,
    subtitles: { list: () => [{ id: "player-lab-external", lang: "en", enabled: true, url: "never-report-url" }] },
    on: vi.fn((name, fn) => listeners.set(name, fn)), off: vi.fn((name) => listeners.delete(name)),
    config: { key: "never-report-key" } };
  const monitor = createRuntimeMonitor();
  const owner = monitor.attach(player as unknown as PlayerAPI, () => 30);
  const sourceLoaded = listeners.get("sourceloaded")!;
  sourceLoaded();
  listeners.get("cueenter")!({ text: "never-report-cue" });
  monitor.sample();
  expect(monitor.report().owner).toMatchObject({ generation: 1, sourceLoaded: 1, cueEnter: 1,
    sample: { time: 5, duration: 60, decodedFrames: 30, externalSubtitleAvailable: true, externalSubtitleEnabled: true } });
  owner.retire();
  expect(monitor.report().retired).toEqual([{ generation: 1, releaseConfirmed: false }]);
  owner.released();
  expect(monitor.report().retired).toEqual([{ generation: 1, releaseConfirmed: true }]);
  sourceLoaded();
  expect(monitor.report().owner).toBeNull();
  expect(JSON.stringify(monitor.report())).not.toContain("never-report");
  expect(listeners.size).toBe(0);
});

it("reports only the allowlisted applied scalar settings", () => {
  const monitor = createRuntimeMonitor();
  monitor.appState({ dvrAllowed: false, logCount: 3, sourceType: "hls", startOffset: 1,
    autoplay: true, startupMuted: true, videoForwardBuffer: 8, audioForwardBuffer: 8,
    maxVideoBitrate: 2500000, externalSubtitleConfigured: true });
  expect(monitor.report().app).toEqual({ dvrAllowed: false, logCount: 3, sourceType: "hls", startOffset: 1,
    autoplay: true, startupMuted: true, videoForwardBuffer: 8, audioForwardBuffer: 8,
    maxVideoBitrate: 2500000, externalSubtitleConfigured: true });
});

it("waits for SourceLoaded before reading and keeps later getter failures fatal", () => {
  const listeners = new Map<string, () => void>();
  const list = vi.fn(() => { throw new Error("source not ready"); });
  const player = { subtitles: { list }, on: vi.fn((name, fn) => listeners.set(name, fn)), off: vi.fn() };
  const monitor = createRuntimeMonitor();
  monitor.attach(player as unknown as PlayerAPI, () => 0);
  monitor.sample();
  expect(list).not.toHaveBeenCalled();
  expect(monitor.report().owner).toMatchObject({ sourceLoaded: 0, readFailures: 0, sample: null });
  listeners.get("sourceloaded")!();
  monitor.sample();
  expect(list).toHaveBeenCalledOnce();
  expect(monitor.report().owner).toMatchObject({ sourceLoaded: 1, readFailures: 1, sample: null });
});
