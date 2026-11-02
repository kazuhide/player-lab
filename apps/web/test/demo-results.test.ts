import { describe, expect, it } from "vitest";
import { customSource, metricDuration, seekTarget, safeDemoExport } from "../src/startup/demo-results";

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
