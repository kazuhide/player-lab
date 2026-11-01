import { describe, expect, it, vi } from "vitest";
import { SDK_VERSIONS, type EngineId } from "../src/startup/contract";
import {
  MAX_BLOCKS, MAX_RESULTS, STARTUP_MARKS, StartupModelError, compareCohort,
  createTrialResult, makeTrialOrder, measureInterval, parseTrialResult,
  summarizeDurations, summarizeTrials, tuningKey,
  type StartupMark, type TrialContext, type TrialInput,
} from "../src/startup/model";

const engines: readonly EngineId[] = ["web-x", "hls", "shaka"];
const metric = "selectionToNativePlayingMs";
function context(engine: EngineId = "hls"): TrialContext {
  return { engine, version: SDK_VERSIONS[engine], contentId: "bbb-360p", profile: "default",
    sdkMode: "on-demand", httpCache: "browser-managed" };
}
function input(engine: EngineId = "hls", value = 20): TrialInput {
  const observedAtMs: Partial<Record<StartupMark, number>> = {};
  for (const mark of STARTUP_MARKS) observedAtMs[mark] = 100 + value;
  return { context: context(engine), status: "success", failureCode: null, selectionAtMs: 100, observedAtMs };
}
const result = (engine: EngineId = "hls", value = 20) => createTrialResult(input(engine, value));
function cohort(count = 5) { return engines.flatMap((engine) => Array.from({ length: count }, (_, n) => result(engine, n * 10))); }

describe("startup marks and intervals", () => {
  it("keeps genuine zero offsets, zero intervals and zero-valued statistics", () => {
    const r = result("hls", 0);
    expect(r.offsetsMs.nativePlaying).toBe(0);
    expect(r.intervalsMs.selectionToNativePlayingMs).toEqual({ valueMs: 0, reason: null });
    expect(r.intervalsMs.playPromiseMs).toEqual({ valueMs: 0, reason: null });
    expect(summarizeDurations([0, 0, 0])).toEqual({ n: 3, medianMs: 0, p95Ms: 0 });
  });
  it("keeps a paused first compositor frame before play without inventing a zero interval", () => {
    const i = input();
    const r = createTrialResult({ ...i, observedAtMs: { ...i.observedAtMs, firstFrame: 105, playRequest: 120 } });
    expect(r.offsetsMs.firstFrame).toBe(5);
    expect(r.intervalsMs.selectionToFirstFrameMs).toEqual({ valueMs: 5, reason: null });
    expect(r.intervalsMs.playRequestToFirstFrameMs).toEqual({ valueMs: null, reason: "end-before-start" });
    expect(r.intervalsMs.playRequestToFirstMovingFrameMs).toEqual({ valueMs: 0, reason: null });
  });
  it("supports disclosed preloaded import offsets in either a common clock or already-relative form", () => {
    const i = input(); const ctx = { ...i.context, sdkMode: "preloaded" as const };
    const absolute = createTrialResult({ ...i, context: ctx, observedAtMs: { ...i.observedAtMs, sdkImportStart: 10, sdkImportEnd: 40 } });
    const relative = createTrialResult({ ...i, context: ctx, selectionAtMs: 0,
      observedAtMs: { sdkImportStart: -90, sdkImportEnd: -60, nativePlaying: 20 } });
    expect(absolute.offsetsMs.sdkImportStart).toBe(-90);
    expect(relative.offsetsMs.sdkImportEnd).toBe(-60);
    expect(absolute.intervalsMs.sdkImportMs).toEqual({ valueMs: 30, reason: null });
    expect(relative.intervalsMs.sdkImportMs).toEqual(absolute.intervalsMs.sdkImportMs);
  });
  it("does not accept negative offsets for on-demand imports or ordinary playback marks", () => {
    const i = input();
    expect(() => createTrialResult({ ...i, observedAtMs: { sdkImportStart: 99 } })).toThrow(StartupModelError);
    expect(() => createTrialResult({ ...i, context: { ...i.context, sdkMode: "preloaded" }, observedAtMs: { nativePlaying: 99 } })).toThrow(StartupModelError);
  });
  it("does not add overlapping SDK phases to the native selection-to-playing interval", () => {
    const r = createTrialResult({ ...input(), observedAtMs: { sdkImportStart: 100, sdkImportEnd: 120,
      constructorStart: 110, constructorEnd: 125, attachStart: 115, attachComplete: 130,
      loadStart: 131, loadComplete: 180, playRequest: 132, playResolved: 160, nativePlaying: 159 } });
    expect(r.intervalsMs.sdkImportMs.valueMs).toBe(20);
    expect(r.intervalsMs.constructorMs.valueMs).toBe(15);
    expect(r.intervalsMs.loadMs.valueMs).toBe(49);
    expect(r.intervalsMs.selectionToNativePlayingMs.valueMs).toBe(59);
  });
  it("never uses loadedData as a first-frame or moving-frame fallback", () => {
    const r = createTrialResult({ ...input(), observedAtMs: { loadedData: 110, nativePlaying: 120, advanced: 130 } });
    expect(r.intervalsMs.selectionToLoadedDataMs.valueMs).toBe(10);
    expect(r.offsetsMs.firstFrame).toBeNull(); expect(r.offsetsMs.firstMovingFrame).toBeNull();
    expect(r.intervalsMs.selectionToFirstFrameMs).toEqual({ valueMs: null, reason: "missing-end" });
  });
  it.each([
    [null, null, "missing-both"], [null, 0, "missing-start"], [0, null, "missing-end"], [2, 1, "end-before-start"],
  ] as const)("retains an explicit missing/invalid interval reason (%s,%s)", (start, end, reason) => {
    expect(measureInterval(start, end)).toEqual({ valueMs: null, reason });
  });
  it.each([NaN, Infinity, -Infinity])("rejects non-finite marks or interval endpoints (%s)", (value) => {
    expect(() => createTrialResult({ ...input(), observedAtMs: { nativePlaying: value } })).toThrow(StartupModelError);
    expect(() => measureInterval(value, 10)).toThrow(StartupModelError);
  });
});

describe("bounded public result schema", () => {
  it("round-trips a copied result, retaining exact explicit false/zero tuning settings", () => {
    const i = input(); const tuning = { hlsWorker: false, shakaPrefetchLimit: 0 as const, webXLoadControl: 2 as const };
    const r = createTrialResult({ ...i, context: { ...i.context, tuning } });
    const restored = parseTrialResult(JSON.parse(JSON.stringify(r)) as unknown);
    expect(restored).toEqual(r); expect(restored.context.tuning).toEqual(tuning);
    Reflect.set(tuning, "hlsWorker", true); expect(r.context.tuning.hlsWorker).toBe(false);
    expect(tuningKey({})).not.toBe(tuningKey({ hlsWorker: false }));
    expect(tuningKey({})).not.toBe(tuningKey({ shakaPrefetchLimit: 0 }));
    expect(tuningKey({ shakaPrefetchLimit: 0 })).not.toBe(tuningKey({ shakaPrefetchLimit: 1 }));
  });
  it.each([0, 2, "1"])("rejects unknown schema version %s", (schemaVersion) => {
    expect(() => parseTrialResult({ ...result(), schemaVersion })).toThrow(StartupModelError);
  });
  it("rejects arbitrary extra data rather than copying URLs, credentials or SDK objects", () => {
    const r = result();
    expect(() => parseTrialResult({ ...r, url: "https://private.invalid/?token=secret" })).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...r, context: { ...r.context, headers: { Authorization: "secret" } } })).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...r, context: { ...r.context, tuning: { apiKey: "secret" } } })).toThrow(StartupModelError);
    expect(() => parseTrialResult(Object.assign(new Date(), r))).toThrow(StartupModelError);
    try { parseTrialResult({ ...r, privateLicense: "never-echo-this-secret" }); } catch (error) {
      expect(String(error)).not.toContain("never-echo-this-secret");
    }
  });
  it.each([
    { engine: "other" }, { contentId: "https://private.invalid" }, { version: "token-or-URL" },
    { sdkMode: "cold" }, { httpCache: "warm" }, { profile: "fastest" },
    { tuning: { hlsWorker: "true" } }, { tuning: { shakaPrefetchLimit: 3 } },
    { tuning: { webXLoadControl: -1 } },
  ])("rejects unsupported context values %j", (patch) => {
    const r = result(); expect(() => parseTrialResult({ ...r, context: { ...r.context, ...patch } })).toThrow(StartupModelError);
  });
  it("rejects inconsistent outcomes and arbitrary failure/error text", () => {
    const r = result();
    expect(() => parseTrialResult({ ...r, status: "success", failureCode: "load-failed" })).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...r, status: "failure", failureCode: null })).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...r, status: "failure", failureCode: "raw SDK URL or error" })).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...r, status: "cancelled", failureCode: "aborted" })).not.toThrow();
  });
  it("rejects tampered, negative or non-finite duration fields instead of dropping them", () => {
    const r = result();
    for (const valueMs of [-1, NaN, Infinity, 999]) {
      expect(() => parseTrialResult({ ...r, intervalsMs: { ...r.intervalsMs, [metric]: { valueMs, reason: null } } })).toThrow(StartupModelError);
    }
    expect(() => parseTrialResult({ ...r, intervalsMs: { ...r.intervalsMs, [metric]: { valueMs: null, reason: "private error" } } })).toThrow(StartupModelError);
  });
  it("rejects hidden or symbol properties rather than accepting undeclared payloads", () => {
    const hidden = Object.defineProperty({ ...result() }, "privateRuntime", { value: "secret", enumerable: false });
    expect(() => parseTrialResult(hidden)).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...result(), [Symbol("runtime")]: { key: "secret" } })).toThrow(StartupModelError);
  });
  it("rejects unknown marks and prototype fields without leaking their values", () => {
    const r = result();
    expect(() => parseTrialResult({ ...r, offsetsMs: { ...r.offsetsMs, streamURL: "secret" } })).toThrow(StartupModelError);
    expect(() => parseTrialResult({ ...r, context: { ...r.context, tuning: JSON.parse('{"__proto__":{"key":"secret"}}') as unknown } })).toThrow(StartupModelError);
  });
});

describe("statistics and complete cohort comparisons", () => {
  it("uses median and nearest-rank p95 with explicit n, including empty and even-sized data", () => {
    expect(summarizeDurations([])).toEqual({ n: 0, medianMs: null, p95Ms: null });
    expect(summarizeDurations([3, 0, 2, 1])).toEqual({ n: 4, medianMs: 1.5, p95Ms: 3 });
    expect(summarizeDurations(Array.from({ length: 20 }, (_, n) => n + 1))).toEqual({ n: 20, medianMs: 10.5, p95Ms: 19 });
  });
  it.each([[1, -1, 2], [1, NaN], [1, Infinity], new Array<number>(2)].map((values) => [values] as const))("rejects invalid duration arrays without filtering %j", (values) => {
    expect(() => summarizeDurations(values)).toThrow(StartupModelError);
  });
  it("retains failures, cancellations, missing and invalid counts while summarizing successful valid values", () => {
    const a = result("hls", 0); const b = result("hls", 20);
    const failed = createTrialResult({ ...input("hls", 1), status: "failure", failureCode: "sdk-error" });
    const cancelled = createTrialResult({ ...input(), status: "cancelled", failureCode: "aborted", observedAtMs: {} });
    const missing = createTrialResult({ ...input(), observedAtMs: {} });
    const groups = summarizeTrials([a, b, failed, cancelled, missing], metric);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ total: 5, successCount: 3, failureCount: 1, cancelledCount: 1,
      missingCount: 2, n: 2, medianMs: 10, p95Ms: 20, failureCounts: { "sdk-error": 1, aborted: 1 } });
    const invalid = createTrialResult({ ...input(), observedAtMs: { playRequest: 130, firstFrame: 120 } });
    expect(summarizeTrials([invalid], "playRequestToFirstFrameMs")[0]).toMatchObject({ missingCount: 1, invalidIntervalCount: 1, n: 0 });
  });
  it.each([
    { version: "1.7.5" }, { contentId: "bbb-180p" }, { profile: "startup" },
    { sdkMode: "preloaded" }, { httpCache: "disabled" }, { httpCache: "unknown" },
    { tuning: { hlsWorker: false } }, { tuning: { shakaPrefetchLimit: 0 } },
    { tuning: { hlsWorker: true } }, { tuning: { shakaPrefetchLimit: 1 } }, { tuning: { webXLoadControl: 2 } },
  ] as const)("never mixes distinct context %j", (patch) => {
    const i = input(); const other = createTrialResult({ ...i, context: { ...i.context, ...patch } });
    expect(summarizeTrials([result(), other], metric)).toHaveLength(2);
  });
  it("keeps versions and engines separate and requires the exact disclosed version set", () => {
    expect(summarizeTrials([result("hls"), result("shaka")], metric)).toHaveLength(2);
    const rows = cohort();
    expect(compareCohort(rows, metric, { ...SDK_VERSIONS, hls: "1.7.5" })).toMatchObject({ kind: "unavailable", reason: "version-mismatch" });
    const old = createTrialResult({ ...input(), context: { ...context(), version: "1.7.3" } });
    expect(compareCohort([...rows, old], metric, SDK_VERSIONS)).toMatchObject({ kind: "unavailable", reason: "mixed-versions" });
  });
  it("labels a smallest median only for balanced complete three-engine cohorts with at least five each", () => {
    const rows = engines.flatMap((engine, index) => Array.from({ length: 5 }, () => result(engine, (index + 1) * 10)));
    expect(compareCohort(rows, metric, SDK_VERSIONS)).toMatchObject({ kind: "smallest-median", engines: ["web-x"], medianMs: 10, nPerEngine: 5 });
    expect(compareCohort(cohort(4), metric, SDK_VERSIONS)).toMatchObject({ kind: "unavailable", reason: "insufficient-samples" });
    expect(compareCohort(rows.filter((r) => r.context.engine !== "hls"), metric, SDK_VERSIONS)).toMatchObject({ kind: "unavailable", reason: "requires-all-engines" });
    expect(compareCohort([...rows, result("hls")], metric, SDK_VERSIONS)).toMatchObject({ kind: "unavailable", reason: "unbalanced" });
  });
  it("shows exact smallest-median ties explicitly without a global-fastest claim", () => {
    expect(compareCohort(cohort(), metric, SDK_VERSIONS)).toMatchObject({ kind: "tie", engines, medianMs: 20, nPerEngine: 5 });
    const rows = engines.flatMap((engine, n) => Array.from({ length: 5 }, () => result(engine, n === 2 ? 30 : 10)));
    expect(compareCohort(rows, metric, SDK_VERSIONS)).toMatchObject({ kind: "tie", engines: ["web-x", "hls"] });
    expect(JSON.stringify(compareCohort(rows, metric, SDK_VERSIONS))).not.toContain("fastest");
  });
  it.each(["failure", "cancelled", "missing"] as const)("does not label a median when a cohort contains %s", (status) => {
    const i = input(); const incomplete = status === "missing"
      ? createTrialResult({ ...i, observedAtMs: {} })
      : createTrialResult({ ...i, status, failureCode: status === "cancelled" ? "aborted" : "play-rejected" });
    expect(compareCohort([...cohort(), incomplete], metric, SDK_VERSIONS)).toMatchObject({ kind: "unavailable", reason: "incomplete" });
  });
  it("does not compare a different tuning or cache cohort even when each engine exists", () => {
    const rows = cohort(); const mixed = rows.map((r) => r.context.engine === "shaka"
      ? createTrialResult({ ...input("shaka"), context: { ...r.context, httpCache: "disabled" } }) : r);
    expect(compareCohort(mixed, metric, SDK_VERSIONS)).toMatchObject({ kind: "unavailable", reason: "mixed-cohorts" });
    expect(compareCohort([], metric, SDK_VERSIONS).kind).toBe("unavailable");
  });
  it("bounds result collection size before processing it", () => {
    expect(() => summarizeTrials(Array.from({ length: MAX_RESULTS + 1 }, () => result()), metric)).toThrow(StartupModelError);
  });
});

describe("balanced sequential order data", () => {
  it("uses every engine once per block, all six permutations per cycle and equal positions", () => {
    for (const seed of [0, 1, 2, 42, 0xffffffff]) {
      const blocks = makeTrialOrder(18, seed); expect(blocks).toHaveLength(18);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const part = blocks.slice(cycle * 6, cycle * 6 + 6);
        expect(new Set(part.map((block) => block.join(","))).size).toBe(6);
        for (const block of part) expect([...block].sort()).toEqual([...engines].sort());
        for (const engine of engines) for (let position = 0; position < 3; position += 1) {
          expect(part.filter((block) => block[position] === engine)).toHaveLength(2);
        }
      }
    }
  });
  it("reproduces seeded orders without ambient randomness or resource execution", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("No ambient randomness"); });
    try {
      expect(makeTrialOrder(12, 42)).toEqual(makeTrialOrder(12, 42));
      expect(makeTrialOrder(12, 42)).not.toEqual(makeTrialOrder(12, 43));
      expect(makeTrialOrder(1, 0)[0]).toHaveLength(3);
    } finally { random.mockRestore(); }
  });
  it.each([0, -1, 1.5, NaN, MAX_BLOCKS + 1])("rejects invalid block count %s", (blocks) => {
    expect(() => makeTrialOrder(blocks, 1)).toThrow(StartupModelError);
  });
  it.each([-1, 1.5, Infinity, 0x100000000])("rejects invalid uint32 seed %s", (seed) => {
    expect(() => makeTrialOrder(6, seed)).toThrow(StartupModelError);
  });
});
