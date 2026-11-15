import assert from "node:assert/strict";
import test from "node:test";
import { computeEngagement } from "../src/engagement.ts";
import { validateSnapshot, validateManifest } from "../src/snapshot.ts";
import type { AnalyticsSample, DemoExport } from "../src/types.ts";

const start = Date.parse("2026-01-01T00:00:00.000Z");
function sample(id: string, sequence: number, from: number, to: number, overrides: Partial<AnalyticsSample> = {}): AnalyticsSample {
  return { impressionId: id, sequenceNumber: sequence, time: start + sequence * 10_000,
    videoId: "bbb-demo", videoDuration: 60_000, videotimeStart: from, videotimeEnd: to,
    played: to - from, state: "playing", ad: 0, ...overrides };
}
function fixture(samples: AnalyticsSample[], durationMs = 60_000): DemoExport {
  return { schemaVersion: 1, synthetic: true, content: { id: "bbb-demo", revision: "fixture-v1", durationMs },
    period: { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() },
    samples: samples.map((s) => ({ ...s, videoDuration: durationMs })) };
}
function seek(id: string, sequence: number, from: number, to: number): AnalyticsSample {
  return sample(id, sequence, from, to, { state: "seeking", played: 0 });
}

test("reach and replay use all eligible sessions, including those that never reach the bucket", () => {
  const result = computeEngagement(fixture([sample("a", 1, 0, 10_000), seek("a", 2, 10_000, 6_000), sample("a", 3, 6_000, 10_000), sample("b", 1, 0, 4_000)]));
  assert.equal(result.sessionCount, 2);
  assert.deepEqual(result.points[0], { startMs: 0, endMs: 2_000, reach: 1, replay: 0, support: 2 });
  assert.deepEqual(result.points[3], { startMs: 6_000, endMs: 8_000, reach: .5, replay: .5, support: 1 });
  assert.equal(result.suggestedMode, "replay");
  assert.deepEqual(result.points[7], { startMs: 14_000, endMs: 16_000, reach: null, replay: null, support: 0 });
});

test("natural and quality-fragmented playback have identical coverage", () => {
  const original = computeEngagement(fixture([sample("a", 1, 0, 12_000)]));
  const split = computeEngagement(fixture([sample("a", 1, 0, 3_000, { videoBitrate: 500_000 }),
    sample("a", 2, 2_500, 7_000, { videoBitrate: 1_000_000 }), sample("a", 3, 7_000, 12_000)]));
  assert.deepEqual(split, original);
  assert.equal(split.suggestedMode, "reach");
});

test("many repeated passes by one session contribute at most one replay share", () => {
  const result = computeEngagement(fixture([sample("a", 1, 0, 10_000), seek("a", 2, 10_000, 0), sample("a", 3, 0, 10_000),
    seek("a", 4, 10_000, 0), sample("a", 5, 0, 10_000), sample("b", 1, 0, 10_000)]));
  assert.equal(result.points[1].replay, .5);
  assert.equal(result.points[1].reach, 1);
  assert.equal(result.points[1].support, 2);
});

test("partial coverage divides by the actual final bucket length", () => {
  const result = computeEngagement(fixture([sample("a", 1, 4_500, 5_500), seek("a", 2, 5_500, 5_000), sample("a", 3, 5_000, 5_500)], 5_500));
  assert.equal(result.points.length, 3);
  assert.equal(result.points[2].reach, 2 / 3);
  assert.equal(result.points[2].replay, 1 / 3);
  assert.equal(result.points[2].endMs, 5_500);
});

test("sample gaps and seek jumps do not become watched coverage", () => {
  const result = computeEngagement(fixture([sample("a", 1, 0, 2_000), sample("a", 2, 2_000, 20_000, { state: "seeking", played: 0 }),
    sample("a", 3, 20_000, 22_000)]));
  assert.equal(result.points[5].reach, null);
  assert.equal(result.points[10].reach, 1);
  assert.equal(result.points[10].replay, 0);
});

test("paused, seeking, buffering and ad-only sessions do not change the denominator", () => {
  const result = computeEngagement(fixture([sample("good", 1, 0, 2_000), sample("paused", 1, 0, 2_000, { state: "paused" }),
    sample("seek", 1, 0, 40_000, { state: "seeking", played: 0 }), sample("buffer", 1, 0, 2_000, { state: "buffering" }),
    sample("ad", 1, 0, 2_000, { ad: 1 })]));
  assert.equal(result.sessionCount, 1);
  assert.equal(result.points[0].reach, 1);
});

test("zero played samples and empty input retain missing buckets", () => {
  for (const input of [fixture([]), fixture([sample("a", 1, 0, 2_000, { played: 0 })])]) {
    const result = computeEngagement(input);
    assert.equal(result.sessionCount, 0);
    assert.equal(result.suggestedMode, "empty");
    assert.ok(result.points.every((point) => point.reach === null && point.replay === null && point.support === 0));
  }
});

test("identical duplicates and shuffled complete records cannot inflate the graph", () => {
  const rows = [sample("a", 1, 0, 6_000), seek("a", 2, 6_000, 2_000), sample("a", 3, 2_000, 6_000), sample("b", 1, 0, 4_000)];
  assert.deepEqual(computeEngagement(fixture([...rows].reverse().concat({ ...rows[1] }))), computeEngagement(fixture(rows)));
});

test("unmarked backwards clocks cannot manufacture a replay", () => {
  assert.throws(() => computeEngagement(fixture([sample("a", 1, 10_000, 14_000), sample("a", 2, 2_000, 6_000)])), /seek|backward|clock/i);
});

test("a seek marker cannot authorize a later contradictory backwards clock", () => {
  assert.throws(() => computeEngagement(fixture([sample("a", 1, 0, 10_000), seek("a", 2, 10_000, 20_000), sample("a", 3, 2_000, 6_000)])), /seek|clock/i);
  assert.throws(() => computeEngagement(fixture([sample("a", 1, 0, 10_000), seek("a", 2, 4_000, 2_000), sample("a", 3, 2_000, 6_000)])), /seek|clock/i);
});

test("conflicting duplicate sequence records are rejected", () => {
  assert.throws(() => computeEngagement(fixture([sample("a", 1, 0, 2_000), sample("a", 1, 0, 3_000)])), /duplicate/i);
});

test("impossible positions, duration, clocks, identity and sequence values are rejected", () => {
  const mutations: Partial<AnalyticsSample>[] = [{ videotimeStart: -1 }, { videotimeEnd: 60_001 },
    { videotimeStart: 3_000, videotimeEnd: 2_000 }, { played: NaN }, { played: -1 }, { videoId: "another-video" },
    { impressionId: "" }, { sequenceNumber: 1.5 }, { time: Infinity }];
  for (const mutation of mutations) assert.throws(() => computeEngagement(fixture([sample("a", 1, 0, 2_000, mutation)])));
  const wrongDuration = fixture([sample("a", 1, 0, 2_000)]);
  wrongDuration.samples[0].videoDuration = 59_000;
  assert.throws(() => computeEngagement(wrongDuration), /duration/i);
  assert.throws(() => computeEngagement(fixture([sample("a", 1, 0, 2_000), sample("a", 2, 2_000, 4_000, { time: start + 5_000 })])), /clock|time/i);
});

test("invalid bin size, bounds and unlabelled real data are rejected", () => {
  for (const width of [0, NaN, -1, .5, 10]) assert.throws(() => computeEngagement(fixture([]), width));
  const invalid = fixture([]); invalid.synthetic = false as true;
  assert.throws(() => computeEngagement(invalid), /synthetic/i);
});

test("snapshot validation accepts output and rejects missing metrics or inconsistent support", () => {
  const result = computeEngagement(fixture([sample("a", 1, 0, 2_000)]));
  assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(result))), result);
  const altered = JSON.parse(JSON.stringify(result));
  delete altered.points[0].reach;
  assert.throws(() => validateSnapshot(altered));
  altered.points[0].reach = 1; altered.points[0].support = 0;
  assert.throws(() => validateSnapshot(altered));
});

test("snapshot validation rejects holes, identity leakage and unsupported versions", () => {
  const result = computeEngagement(fixture([sample("a", 1, 0, 2_000)]));
  assert.throws(() => validateSnapshot({ ...result, points: result.points.slice(1) }));
  assert.throws(() => validateSnapshot({ ...result, samples: [sample("private", 1, 0, 2_000)] }));
  assert.throws(() => validateSnapshot({ ...result, metricVersion: "other" }));
  assert.throws(() => validateSnapshot({ ...result, suggestedMode: "replay" }));
});

test("manifest validation restricts profile paths to local data files", () => {
  const manifest = { schemaVersion: 1, synthetic: true, content: fixture([]).content,
    profiles: [{ id: "empty", title: { en: "Empty", ja: "データなし" }, snapshot: "empty.snapshot.json", samples: "empty.samples.json" }] };
  assert.deepEqual(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, profiles: [{ ...manifest.profiles[0], snapshot: "https://example.com/private.json" }] }));
  assert.throws(() => validateManifest({ ...manifest, profiles: [{ ...manifest.profiles[0], samples: "../secret.json" }] }));
  assert.throws(() => validateManifest({ ...manifest, profiles: [{ ...manifest.profiles[0], snapshot: "empty.samples.json" }] }));
});
