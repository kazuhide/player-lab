import { describe, expect, it } from "vitest";
import { formatBehindLive, formatDuration, formatWallClock } from "../src/format";

describe("formatDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatDuration(12)).toBe("12s");
    expect(formatDuration(65)).toBe("1m 05s");
    expect(formatDuration(3725)).toBe("1h 02m");
  });
  it("floors fractional and absorbs non-finite input", () => {
    expect(formatDuration(12.9)).toBe("12s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
  });
});

describe("formatBehindLive", () => {
  it("shows LIVE within epsilon", () => {
    expect(formatBehindLive(0)).toBe("LIVE");
    expect(formatBehindLive(-0.5)).toBe("LIVE");
  });
  it("shows the behind-live offset", () => {
    expect(formatBehindLive(-12)).toBe("-12s behind");
    expect(formatBehindLive(-65)).toBe("-1m 05s behind");
  });
  it("honors custom epsilon and label", () => {
    expect(formatBehindLive(-2, { epsilon: 3 })).toBe("LIVE");
    expect(formatBehindLive(-12, { liveLabel: "● LIVE", negativePrefix: "−" })).toBe("−12s behind");
  });
});

describe("formatWallClock", () => {
  it("formats UTC HH:MM:SS deterministically", () => {
    expect(formatWallClock(1_700_000_000, { utc: true })).toBe("22:13:20");
  });
  it("can drop seconds", () => {
    expect(formatWallClock(1_700_000_000, { utc: true, withSeconds: false })).toBe("22:13");
  });
  it("renders a placeholder for non-finite input", () => {
    expect(formatWallClock(Number.NaN)).toBe("--:--:--");
  });
});
