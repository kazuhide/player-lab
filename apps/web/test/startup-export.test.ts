import { describe, expect, it } from "vitest";
import { createTrialResult } from "../src/startup/model";
import { unavailableTrial } from "../src/startup/runner";
import { createComparisonExport } from "../src/startup/export";

function entry() {
  return { run: 1, seed: 42, phase: "comparison" as const,
    measuredAt: "2026-11-01T08:00:00.000Z",
    environment: {
      browserFamily: { value: "chromium" as const, reason: null },
      browserMajorVersion: { value: 156, reason: null },
      osFamily: { value: "macos" as const, reason: null },
      logicalProcessorCount: { value: 10, reason: null },
      approximateDeviceMemoryGiB: { value: null, reason: "unavailable" as const },
      viewportWidthCssPixels: { value: 1440, reason: null },
      viewportHeightCssPixels: { value: 900, reason: null },
      devicePixelRatio: { value: 2, reason: null },
    },
    measurement: createTrialResult({ context: { engine: "hls", version: "1.7.4", contentId: "bbb-360p",
      profile: "startup", sdkMode: "on-demand", httpCache: "browser-managed" },
      status: "failure", failureCode: "deadline", selectionAtMs: 0, observedAtMs: { sdkImportStart: 0, sdkImportEnd: 12 } }),
    observations: unavailableTrial("deadline") };
}

describe("comparison result export", () => {
  it("separates save UTC from trial UTC and retains nested measurement schema 1", () => {
    const exported = createComparisonExport([entry()], "2026-11-01T08:30:00.000Z");
    expect(exported.schemaVersion).toBe(2);
    expect(exported.exportedAt).toBe("2026-11-01T08:30:00.000Z");
    expect(exported.trials[0]!.measuredAt).toBe("2026-11-01T08:00:00.000Z");
    expect(exported.trials[0]!.measurement.schemaVersion).toBe(1);
    expect(exported.trials[0]!.environment).toEqual(entry().environment);
  });

  it("does not retain raw environment strings or mutable metadata references", () => {
    const original = entry();
    const environment = { ...original.environment, rawUserAgent: "PRIVATE_ENV_CANARY", hostname: "PRIVATE_ENV_CANARY",
      browserFamily: { ...original.environment.browserFamily, raw: "PRIVATE_ENV_CANARY" } };
    const exported = createComparisonExport([{ ...original, environment }], "2026-11-01T08:30:00.000Z");
    environment.viewportWidthCssPixels.value = 320;
    expect(exported.trials[0]!.environment.viewportWidthCssPixels.value).toBe(1440);
    expect(JSON.stringify(exported)).not.toContain("PRIVATE_ENV_CANARY");
  });

  it("rejects malformed UTC, unknown reasons and invalid environment values", () => {
    expect(() => createComparisonExport([entry()], "2026-11-01")).toThrow();
    expect(() => createComparisonExport([{ ...entry(), measuredAt: "2026-02-30T00:00:00.000Z" }],
      "2026-11-01T08:30:00.000Z")).toThrow();
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const original = entry(); original.environment.logicalProcessorCount.value = value;
      expect(() => createComparisonExport([original], "2026-11-01T08:30:00.000Z")).toThrow();
    }
    const original = entry();
    expect(() => createComparisonExport([{ ...original, environment: { ...original.environment,
      browserFamily: { value: "PRIVATE_ENV_CANARY", reason: null } } } as unknown as ReturnType<typeof entry>],
    "2026-11-01T08:30:00.000Z")).toThrow();
    expect(() => createComparisonExport([{ ...original, environment: { ...original.environment,
      approximateDeviceMemoryGiB: { value: null, reason: "PRIVATE_ENV_CANARY" } } } as unknown as ReturnType<typeof entry>],
    "2026-11-01T08:30:00.000Z")).toThrow();
  });

  it("retains all outcomes and explicit missing measurements", () => {
    const exported = createComparisonExport([entry()], "2026-11-01T08:30:00.000Z");
    expect(exported.trials[0]!.measurement.status).toBe("failure");
    expect(exported.trials[0]!.measurement.offsetsMs.sdkImportStart).toBe(0);
    expect(exported.trials[0]!.measurement.intervalsMs.selectionToFirstFrameMs.valueMs).toBeNull();
    expect(exported.trials[0]!.statistics.video).toBeNull();
  });

  it("copies only known result fields and never exports credentials, URLs or SDK objects", () => {
    const original = entry();
    const canary = "PRIVATE_EXPORT_CANARY";
    const unsafe = { ...original, apiKey: canary, sourceUrl: `https://example.invalid/${canary}`,
      observations: { ...original.observations, metadata: { configuration: { key: canary }, rawPlayer: canary }, rawError: canary } };
    const text = JSON.stringify(createComparisonExport([unsafe as unknown as ReturnType<typeof entry>], "2026-11-01T08:30:00.000Z"));
    expect(text).not.toContain(canary);
    expect(text).not.toContain("https://");
    expect(text).not.toContain("metadata");
    expect(text).not.toContain("rawError");
  });

  it("preserves a measured negative JavaScript heap delta without treating it as total memory", () => {
    const original = entry(); original.observations.javascriptHeapDeltaBytes = -128;
    expect(createComparisonExport([original], "2026-11-01T08:30:00.000Z").trials[0]!.statistics.javascriptHeapDeltaBytes).toBe(-128);
  });

  it("rejects nonfinite statistics and invalid phase/sequence fields", () => {
    const original = entry(); original.observations.cleanupMs = Number.NaN;
    expect(() => createComparisonExport([original], "2026-11-01T08:30:00.000Z")).toThrow();
    expect(() => createComparisonExport([{ ...entry(), seed: -1 }], "2026-11-01T08:30:00.000Z")).toThrow();
    expect(() => createComparisonExport([{ ...entry(), run: 0 }], "2026-11-01T08:30:00.000Z")).toThrow();
    expect(() => createComparisonExport([{ ...entry(), phase: "arbitrary" as "comparison" }], "2026-11-01T08:30:00.000Z")).toThrow();
  });

  it("returns an independent snapshot and does not accept inconsistent model results", () => {
    const original = entry(); const exported = createComparisonExport([original], "2026-11-01T08:30:00.000Z");
    original.observations.cleanupMs = 99;
    expect(exported.trials[0]!.statistics.cleanupMs).toBeNull();
    const invalid = { ...original.measurement, offsetsMs: { ...original.measurement.offsetsMs, nativePlaying: 99 } };
    expect(() => createComparisonExport([{ ...entry(), measurement: invalid }], "2026-11-01T08:30:00.000Z")).toThrow();
  });
});
