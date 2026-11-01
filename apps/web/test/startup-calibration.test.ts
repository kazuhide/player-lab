import { describe, expect, it } from "vitest";
import { SDK_VERSIONS } from "../src/startup/contract";
import { createTrialResult, type TrialResult } from "../src/startup/model";
import { planScreening, selectStartupTuning } from "../src/startup/calibration";

// Synthetic durations exercise selection policy; they are not SDK measurements.
function screened(seed = 42): TrialResult[] {
  return planScreening(seed).map(({ engine, tuning }) => createTrialResult({
    context: { engine, version: SDK_VERSIONS[engine], contentId: "bbb-360p", profile: "startup",
      sdkMode: "on-demand", httpCache: "browser-managed", tuning },
    status: "success", failureCode: null, selectionAtMs: 0,
    observedAtMs: { nativePlaying: engine === "hls" ? tuning.hlsWorker ? 80 : 40
      : engine === "shaka" ? 60 - (tuning.shakaPrefetchLimit ?? 0) * 10 : 50 },
  }));
}

describe("startup configuration screening", () => {
  it("interleaves a complete balanced block cycle with every eligible candidate", () => {
    const plan = planScreening(42);
    expect(plan).toHaveLength(18);
    for (let index = 0; index < 18; index += 3) expect(new Set(plan.slice(index, index + 3).map((x) => x.engine)).size).toBe(3);
    expect(plan.filter((x) => x.engine === "web-x").every((x) => x.tuning.webXLoadControl === 2)).toBe(true);
    expect(plan.filter((x) => x.engine === "hls" && x.tuning.hlsWorker === false)).toHaveLength(3);
    for (const value of [0, 1, 2]) expect(plan.filter((x) => x.engine === "shaka" && x.tuning.shakaPrefetchLimit === value)).toHaveLength(2);
    expect(planScreening(42)).toEqual(plan);
  });

  it("chooses each engine using the fixed Playing metric before confirmation", () => {
    const choice = selectStartupTuning(screened());
    expect(choice.tuning).toEqual({ hlsWorker: false, shakaPrefetchLimit: 2, webXLoadControl: 2 });
    expect(choice.fallbackReasons).toEqual({});
  });

  it("does not hide failures to qualify a faster candidate", () => {
    const results = screened();
    const index = results.findIndex((x) => x.context.engine === "hls" && x.context.tuning.hlsWorker === false);
    const original = results[index]!;
    results[index] = createTrialResult({ context: original.context, status: "failure", failureCode: "sdk-error",
      selectionAtMs: 0, observedAtMs: { nativePlaying: 1 } });
    expect(selectStartupTuning(results).tuning.hlsWorker).toBe(true);
  });

  it("keeps defaults and reports incomplete screening instead of picking from a partial run", () => {
    const choice = selectStartupTuning(screened().slice(0, 3));
    expect(choice.tuning).toEqual({ hlsWorker: true, shakaPrefetchLimit: 0, webXLoadControl: 2 });
    expect(Object.keys(choice.fallbackReasons).sort()).toEqual(["hls", "shaka", "web-x"]);
  });

  it("does not replace a missing Playing measurement with an SDK or frame event", () => {
    const results = screened().map((result) => result.context.engine === "shaka"
      ? createTrialResult({ context: result.context, status: "success", failureCode: null,
        selectionAtMs: 0, observedAtMs: { firstFrame: 1, sdkReady: 2 } }) : result);
    const choice = selectStartupTuning(results);
    expect(choice.tuning.shakaPrefetchLimit).toBe(0);
    expect(choice.fallbackReasons.shaka).toBe("no-complete-candidate");
  });

  it("requires the full candidate set rather than six copies of one favorable candidate", () => {
    const results = screened();
    const favorable = results.find((result) => result.context.engine === "hls" && result.context.tuning.hlsWorker === false)!;
    const repeated = results.map((result) => result.context.engine === "hls" ? favorable : result);
    const choice = selectStartupTuning(repeated);
    expect(choice.tuning.hlsWorker).toBe(true);
    expect(choice.fallbackReasons.hls).toBe("incomplete-screening");
  });

  it("rejects cross-content and cross-version screening", () => {
    for (const patch of [{ contentId: "bbb-180p" as const }, { version: "0.0.1" }]) {
      const results = screened(); const original = results[0]!;
      results[0] = createTrialResult({ context: { ...original.context, ...patch }, status: "success",
        failureCode: null, selectionAtMs: 0, observedAtMs: { nativePlaying: 10 } });
      expect(() => selectStartupTuning(results)).toThrow();
    }
  });
});
