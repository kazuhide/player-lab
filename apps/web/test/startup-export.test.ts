import { describe, expect, it } from "vitest";
import { createTrialResult } from "../src/startup/model";
import { unavailableTrial } from "../src/startup/runner";
import { createComparisonExport } from "../src/startup/export";

function entry() {
  return { run: 1, seed: 42, phase: "comparison" as const,
    measurement: createTrialResult({ context: { engine: "hls", version: "1.7.4", contentId: "bbb-360p",
      profile: "startup", sdkMode: "on-demand", httpCache: "browser-managed" },
      status: "failure", failureCode: "deadline", selectionAtMs: 0, observedAtMs: { sdkImportStart: 0, sdkImportEnd: 12 } }),
    observations: unavailableTrial("deadline") };
}

describe("comparison result export", () => {
  it("retains all outcomes and explicit missing measurements", () => {
    const exported = createComparisonExport([entry()]);
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
    const text = JSON.stringify(createComparisonExport([unsafe as unknown as ReturnType<typeof entry>]));
    expect(text).not.toContain(canary);
    expect(text).not.toContain("https://");
    expect(text).not.toContain("metadata");
    expect(text).not.toContain("rawError");
  });

  it("preserves a measured negative JavaScript heap delta without treating it as total memory", () => {
    const original = entry(); original.observations.javascriptHeapDeltaBytes = -128;
    expect(createComparisonExport([original]).trials[0]!.statistics.javascriptHeapDeltaBytes).toBe(-128);
  });

  it("rejects nonfinite statistics and invalid phase/sequence fields", () => {
    const original = entry(); original.observations.cleanupMs = Number.NaN;
    expect(() => createComparisonExport([original])).toThrow();
    expect(() => createComparisonExport([{ ...entry(), seed: -1 }])).toThrow();
    expect(() => createComparisonExport([{ ...entry(), run: 0 }])).toThrow();
    expect(() => createComparisonExport([{ ...entry(), phase: "arbitrary" as "comparison" }])).toThrow();
  });

  it("returns an independent snapshot and does not accept inconsistent model results", () => {
    const original = entry(); const exported = createComparisonExport([original]);
    original.observations.cleanupMs = 99;
    expect(exported.trials[0]!.statistics.cleanupMs).toBeNull();
    const invalid = { ...original.measurement, offsetsMs: { ...original.measurement.offsetsMs, nativePlaying: 99 } };
    expect(() => createComparisonExport([{ ...entry(), measurement: invalid }])).toThrow();
  });
});
