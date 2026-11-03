import { describe, expect, it } from "vitest";
import { DEMO_SDK_VERSIONS } from "../src/startup/contract";
import { customSource, metricDuration, seekTarget, safeDemoExport, type DemoRecord } from "../src/startup/demo-results";

describe("interactive comparison boundaries", () => {
  it("accepts HLS/DASH URLs without placing credentials in labels or exports", () => {
    const source = customSource("https://media.example/video.mpd?token=private", "dash");
    expect(source).toMatchObject({ format: "dash", custom: true, label: "Custom DASH" });
    expect(source.url).toContain("token=private");
    expect(JSON.stringify(safeDemoExport([], "dash", true))).not.toContain("private");
    for (const url of ["javascript:alert(1)", "file:///private/video.m3u8", "https://user:secret@example.test/a", "bad URL"]) {
      expect(() => customSource(url, "hls")).toThrow();
    }
  });

  it("does not turn missing, reversed or invalid marks into zero-valued bars", () => {
    expect(metricDuration({ constructorStart: 10, constructorEnd: 16 }, "constructorStart", "constructorEnd")).toBe(6);
    expect(metricDuration({}, "constructorStart", "constructorEnd")).toBeNull();
    expect(metricDuration({ constructorStart: 16, constructorEnd: 10 }, "constructorStart", "constructorEnd")).toBeNull();
    expect(metricDuration({ constructorStart: 10, constructorEnd: NaN }, "constructorStart", "constructorEnd")).toBeNull();
  });

  it("exports all four engine versions and v8 measurements without SDK metadata", () => {
    const records: DemoRecord[] = (["web-x", "bitmovin-8", "hls", "shaka"] as const).map((engine) => ({
      engine, phase: "complete", samples: [],
      startup: { status: "success", failureCode: null, sdkCode: 1234, frameCallbackAvailable: true,
        marks: { constructorStart: 1, nativePlaying: 20, firstFrame: 24, firstMovingFrame: 40 },
        metadata: { engine, name: "Fixture player", version: DEMO_SDK_VERSIONS[engine],
          readyEvent: "ready", playingEvent: "playing", loadCompletion: "promise", attachCompletion: "synchronous-return",
          configuration: { source: "https://media.invalid/asset.m3u8?token=private", key: "private-key" },
          unavailable: {}, sampleLimitations: {} } },
      seek: { status: "success", failureCode: null, targetSeconds: 40, latencyMs: 25,
        buffered: false, frameCallbackAvailable: true },
    }));
    const exported = safeDemoExport(records, "hls", true);
    expect(exported.trials.map((trial) => trial.engine)).toEqual(["web-x", "bitmovin-8", "hls", "shaka"]);
    for (const trial of exported.trials) expect(trial.version).toBe(DEMO_SDK_VERSIONS[trial.engine]);
    expect(exported.trials[1]).toMatchObject({ engine: "bitmovin-8", startup: {
      status: "success", marks: { firstMovingFrame: 40 },
    }, seek: { status: "success", targetSeconds: 40, latencyMs: 25 } });
    expect(JSON.stringify(exported)).not.toMatch(/https?:|private|metadata|sdkCode/);
    records[1]!.startup!.marks.firstMovingFrame = 999;
    expect(exported.trials[1]!.startup!.marks.firstMovingFrame).toBe(40);
  });

  it("uses 40 seconds for the default clip and stays inside a live or short seekable range", () => {
    expect(seekTarget({ seekableStart: 0, seekableEnd: 60, mediaTime: 3 })).toBe(40);
    const short = seekTarget({ seekableStart: 0, seekableEnd: 9, mediaTime: 3 });
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThan(9);
    const live = seekTarget({ seekableStart: 1700000000, seekableEnd: 1700000040, mediaTime: 1700000038 });
    expect(live).toBeGreaterThan(1700000000);
    expect(live).toBeLessThan(1700000040);
    expect(seekTarget({ seekableStart: null, seekableEnd: null, mediaTime: 3 })).toBeNull();
  });
});
