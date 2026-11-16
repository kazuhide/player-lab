import assert from "node:assert/strict";
import test from "node:test";
import { validatePrivateQueryData } from "../src/query-incidence.ts";
import { validateSnapshot } from "../src/snapshot.ts";
import { createTimelineGeometry } from "../src/timeline-geometry.ts";
import type { EngagementSnapshot, TimelineSnapshot } from "../src/types.ts";

function queryData() {
  return {
    schemaVersion: 1,
    metricVersion: "watched-impression-incidence-v1",
    complete: true,
    content: { id: "example-video-v1", revision: "v1", durationMs: 6_000 },
    source: { hls: "https://example.com/video/master.m3u8" },
    period: { start: "2026-11-01T00:00:00.000Z", end: "2026-11-02T00:00:00.000Z" },
    generatedAt: "2026-11-02T00:00:00.000Z",
    sessionCount: 4,
    bucketWidthMs: 2_000,
    buckets: [
      { startMs: 0, endMs: 2_000, impressions: 4 },
      { startMs: 2_000, endMs: 4_000, impressions: 2 },
      { startMs: 4_000, endMs: 6_000, impressions: 0 },
    ],
  };
}

test("complete Query counts become incidence ratios without fabricating replay or synthetic data", () => {
  const result = validatePrivateQueryData(queryData());
  const snapshot: TimelineSnapshot = result.snapshot;
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.metricVersion, "watched-impression-incidence-v1");
  assert.equal(snapshot.synthetic, false);
  assert.equal(snapshot.sessionCount, 4);
  assert.deepEqual(snapshot.points.map(point => point.reach), [1, 0.5, 0]);
  assert.deepEqual(snapshot.points.map(point => point.support), [4, 2, 0]);
  assert.ok(snapshot.points.every(point => point.replay === null));
  assert.deepEqual(result.source, { hls: "https://example.com/video/master.m3u8" });
  assert.deepEqual(Object.keys(result).sort(), ["snapshot", "source"]);
  assert.equal("complete" in snapshot, false);
  assert.equal("buckets" in snapshot, false);
  assert.equal("source" in snapshot, false);
});

test("empty populations retain unavailable ratios rather than measured zeros", () => {
  const input = queryData();
  input.sessionCount = 0;
  for (const bucket of input.buckets) bucket.impressions = 0;
  const { snapshot } = validatePrivateQueryData(input);
  assert.equal(snapshot.sessionCount, 0);
  assert.ok(snapshot.points.every(point => point.reach === null && point.replay === null && point.support === 0));
  input.buckets[1].impressions = 1;
  assert.throws(() => validatePrivateQueryData(input));
});

test("known zero incidence remains observed in geometry while replay remains unavailable", () => {
  const input = queryData();
  const { snapshot } = validatePrivateQueryData(input);
  const watched = createTimelineGeometry(snapshot, "reach", 300, 50);
  assert.equal(watched.hasValues, true);
  const knownZero = watched.segments.flatMap(segment => segment.points).find(point => point.rawValue === 0);
  assert.ok(knownZero);
  assert.equal(snapshot.points[2].reach, 0);
  assert.deepEqual(createTimelineGeometry(snapshot, "replay", 300, 50).segments, []);
});

test("a complete timeline cannot account for fewer records than its eligible population", () => {
  for (const counts of [[0, 0, 0], [2, 1, 0]]) {
    const input = queryData();
    input.buckets.forEach((bucket, index) => { bucket.impressions = counts[index]; });
    assert.throws(() => validatePrivateQueryData(input), /population/);
  }
  const coherent = queryData();
  coherent.buckets[0].impressions = 2;
  coherent.buckets[1].impressions = 2;
  assert.deepEqual(validatePrivateQueryData(coherent).snapshot.points.map(point => point.reach), [0.5, 0.5, 0]);
});

test("the final partial bucket follows the actual content duration", () => {
  const input = queryData();
  input.content.durationMs = 5_000;
  input.buckets[2].endMs = 5_000;
  input.buckets[2].impressions = 1;
  const { snapshot } = validatePrivateQueryData(input);
  assert.deepEqual(snapshot.points[2], { startMs: 4_000, endMs: 5_000, support: 1, reach: 0.25, replay: null });
});

test("validation constructs independent output objects and preserves every input field", () => {
  const input = queryData();
  const original = structuredClone(input);
  const result = validatePrivateQueryData(input);
  assert.deepEqual(input, original);
  result.snapshot.content.id = "changed";
  result.snapshot.period.start = "2026-10-31T00:00:00.000Z";
  result.snapshot.points[0].support = 0;
  result.source.hls = "https://example.com/other.m3u8";
  assert.deepEqual(input, original);
});

test("missing, duplicate, reordered or discontinuous buckets cannot look complete", () => {
  const mutations = [
    (input: ReturnType<typeof queryData>) => { input.buckets.pop(); },
    (input: ReturnType<typeof queryData>) => { delete input.buckets[1]; },
    (input: ReturnType<typeof queryData>) => { input.buckets[1] = { ...input.buckets[0] }; },
    (input: ReturnType<typeof queryData>) => { [input.buckets[0], input.buckets[1]] = [input.buckets[1], input.buckets[0]]; },
    (input: ReturnType<typeof queryData>) => { input.buckets[1].startMs += 1; },
    (input: ReturnType<typeof queryData>) => { input.buckets[2].endMs += 1; },
  ];
  for (const mutate of mutations) {
    const input = queryData();
    mutate(input);
    assert.throws(() => validatePrivateQueryData(input));
  }
});

test("population and bucket counts are bounded safe integers and each bucket cannot exceed its population", () => {
  for (const count of [-1, 1.5, 1_000_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const input = queryData();
    input.sessionCount = count;
    assert.throws(() => validatePrivateQueryData(input));
  }
  for (const count of [-1, 0.5, 5, 1_000_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const input = queryData();
    input.buckets[0].impressions = count;
    assert.throws(() => validatePrivateQueryData(input));
  }
  const input = queryData();
  input.sessionCount = 1_000_000_000;
  input.buckets[0].impressions = input.sessionCount;
  assert.equal(validatePrivateQueryData(input).snapshot.points[0].reach, 1);
});

test("only the versioned complete input contract is accepted", () => {
  for (const key of Object.keys(queryData())) {
    const input = { ...queryData() } as Record<string, unknown>;
    delete input[key];
    assert.throws(() => validatePrivateQueryData(input), `missing ${key} must be rejected`);
  }
  for (const override of [{ schemaVersion: 2 }, { metricVersion: "replay-coverage-v1" }, { complete: false }, { complete: "true" }]) {
    assert.throws(() => validatePrivateQueryData({ ...queryData(), ...override }));
  }
  for (const input of [null, undefined, [], "data", 1]) assert.throws(() => validatePrivateQueryData(input));
});

test("secret fields, request headers and unrelated metadata are rejected at every object boundary", () => {
  for (const key of ["apiKey", "licenseKey", "headers", "token", "synthetic"]) {
    assert.throws(() => validatePrivateQueryData({ ...queryData(), [key]: "placeholder" }));
  }
  for (const key of ["headers", "apiKey", "cookies"]) {
    const input = queryData();
    Object.assign(input.source, { [key]: "placeholder" });
    assert.throws(() => validatePrivateQueryData(input));
  }
  for (const boundary of ["content", "period"] as const) {
    const input = queryData();
    Object.assign(input[boundary], { token: "placeholder" });
    assert.throws(() => validatePrivateQueryData(input));
  }
  const input = queryData();
  Object.assign(input.buckets[0], { headers: {} });
  assert.throws(() => validatePrivateQueryData(input));
});

test("source URLs require bounded HTTPS addresses without embedded credentials", () => {
  for (const hls of [
    "http://example.com/master.m3u8", "javascript:alert(1)", "data:text/plain,video", "not a URL",
    "https://user:password@example.com/master.m3u8", "https://user@example.com/master.m3u8",
    `https://example.com/${"a".repeat(8_192)}`,
  ]) {
    const input = queryData();
    input.source.hls = hls;
    assert.throws(() => validatePrivateQueryData(input));
  }
});

test("invalid periods, stale generation timestamps and unsupported bucket widths are rejected", () => {
  const stale = queryData();
  stale.generatedAt = "2026-11-01T23:59:59.999Z";
  assert.throws(() => validatePrivateQueryData(stale));
  for (const generatedAt of ["2026-02-30T00:00:00.000Z", "2026-11-02T00:00:00", "invalid"]) {
    assert.throws(() => validatePrivateQueryData({ ...queryData(), generatedAt }));
  }
  const reversed = queryData();
  reversed.period.end = reversed.period.start;
  assert.throws(() => validatePrivateQueryData(reversed));
  assert.throws(() => validatePrivateQueryData({ ...queryData(), bucketWidthMs: 0 }));
  const excessive = queryData();
  excessive.content.durationMs = 4_002_000;
  assert.throws(() => validatePrivateQueryData(excessive), /bucket count/);
});

test("the existing synthetic snapshot validator retains its separate trust boundary", () => {
  const input = queryData();
  const synthetic: EngagementSnapshot = {
    schemaVersion: 1, metricVersion: "replay-coverage-v1", synthetic: true,
    content: input.content, period: input.period, generatedAt: input.generatedAt,
    sessionCount: 4, bucketWidthMs: 2_000, suggestedMode: "replay",
    points: [
      { startMs: 0, endMs: 2_000, support: 4, reach: 1, replay: 0.5 },
      { startMs: 2_000, endMs: 4_000, support: 2, reach: 0.5, replay: 0 },
      { startMs: 4_000, endMs: 6_000, support: 0, reach: null, replay: null },
    ],
  };
  assert.equal(validateSnapshot(synthetic), synthetic);
  assert.throws(() => validateSnapshot({ ...synthetic, synthetic: false }), /synthetic/);
  assert.throws(() => validateSnapshot(validatePrivateQueryData(input).snapshot), /synthetic/);
});
