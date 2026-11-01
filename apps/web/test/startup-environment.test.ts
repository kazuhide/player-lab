import { describe, expect, it } from "vitest";
import { captureEnvironment, parseEnvironment, parseUtc, utcFromEpochMs } from "../src/startup/environment";

const source = () => ({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) HeadlessChrome/156.0.1 Safari/537.36",
  hardwareConcurrency: 10, deviceMemory: 8, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2 });

describe("comparison environment snapshots", () => {
  it("keeps only coarse families and major version from a reported user agent", () => {
    for (const [ua, browser, major, os] of [
      [source().userAgent, "chromium", 156, "macos"],
      ["Mozilla/5.0 (Windows NT 10.0) Firefox/145.1 PRIVATE_ENV_CANARY", "firefox", 145, "windows"],
      ["Mozilla/5.0 (iPhone) Version/26.1 Mobile/15 Safari/604.1", "safari", 26, "ios"],
      ["Mozilla/5.0 (Linux; Android 16; PRIVATE_ENV_CANARY) Chrome/156.1", "chromium", 156, "android"],
    ] as const) {
      const value = captureEnvironment({ ...source(), userAgent: ua });
      expect(value.browserFamily.value).toBe(browser);
      expect(value.browserMajorVersion.value).toBe(major);
      expect(value.osFamily.value).toBe(os);
      expect(JSON.stringify(value)).not.toContain("PRIVATE_ENV_CANARY");
      expect(JSON.stringify(value)).not.toContain("Mozilla");
    }
  });

  it("records unsupported or unrecognized observations as null with fixed reasons", () => {
    const absent = captureEnvironment({});
    for (const observation of Object.values(absent)) expect(observation).toEqual({ value: null, reason: "unavailable" });
    const unknown = captureEnvironment({ userAgent: "PRIVATE_ENV_CANARY", hardwareConcurrency: 0,
      deviceMemory: Number.NaN, innerWidth: -1, innerHeight: Number.POSITIVE_INFINITY, devicePixelRatio: "secret" });
    for (const observation of Object.values(unknown)) expect(observation).toEqual({ value: null, reason: "unrecognized" });
  });

  it("bounds reported numbers without retaining arbitrary version digits", () => {
    const value = captureEnvironment({ userAgent: "Chrome/1234567890123456", hardwareConcurrency: 99999,
      deviceMemory: 1e20, innerWidth: 1e20, innerHeight: 1e20, devicePixelRatio: 1e20 });
    expect(value.browserFamily.value).toBe("chromium");
    for (const [field, observation] of Object.entries(value)) {
      if (field !== "browserFamily") expect(observation).toEqual({ value: null, reason: "unrecognized" });
    }
    const valid = captureEnvironment(source());
    for (const [field, value] of [["browserMajorVersion", 10000], ["logicalProcessorCount", 4097],
      ["approximateDeviceMemoryGiB", 65537], ["viewportWidthCssPixels", 100001],
      ["viewportHeightCssPixels", 100001], ["devicePixelRatio", 17]] as const) {
      expect(() => parseEnvironment({ ...valid, [field]: { value, reason: null } })).toThrow();
    }
  });

  it("holds independent immutable startup values when source values later change", () => {
    const input = source(); const before = captureEnvironment(input);
    input.innerWidth = 320; input.deviceMemory = 4;
    const after = captureEnvironment(input);
    expect(before.viewportWidthCssPixels.value).toBe(1440);
    expect(after.viewportWidthCssPixels.value).toBe(320);
    expect(before.approximateDeviceMemoryGiB.value).toBe(8);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.browserFamily)).toBe(true);
  });

  it("rebuilds the known export shape and rejects inconsistent observations", () => {
    const input = captureEnvironment(source());
    const safe = parseEnvironment({ ...input, hostname: "PRIVATE_ENV_CANARY",
      viewportWidthCssPixels: { ...input.viewportWidthCssPixels, url: "PRIVATE_ENV_CANARY" } });
    expect(safe).toEqual(input);
    expect(JSON.stringify(safe)).not.toContain("PRIVATE_ENV_CANARY");
    for (const observation of [{ value: 0, reason: null }, { value: 2, reason: "unavailable" },
      { value: null, reason: null }, { value: null, reason: "PRIVATE_ENV_CANARY" }]) {
      expect(() => parseEnvironment({ ...input, devicePixelRatio: observation })).toThrow();
    }
    expect(() => parseEnvironment({ ...input, browserMajorVersion: { value: 1.5, reason: null } })).toThrow();
  });
});

describe("comparison UTC timestamps", () => {
  it("derives measurement UTC from the existing selection epoch without resampling wall time", () => {
    expect(utcFromEpochMs(Date.parse("2026-11-01T08:00:00.123Z") + 0.75)).toBe("2026-11-01T08:00:00.123Z");
    expect(parseUtc("2026-11-01T08:30:00.000Z")).toBe("2026-11-01T08:30:00.000Z");
  });
  it("rejects noncanonical UTC and invalid clocks", () => {
    for (const value of ["2026-11-01", "2026-11-01T08:30:00+00:00", "2026-02-30T00:00:00.000Z", "PRIVATE_ENV_CANARY"]) {
      expect(() => parseUtc(value)).toThrow();
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) expect(() => utcFromEpochMs(value)).toThrow();
  });
});
