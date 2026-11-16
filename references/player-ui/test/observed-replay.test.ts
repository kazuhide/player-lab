import assert from "node:assert/strict";
import test from "node:test";
import { computeObservedReplay, inspectObservedReplay, type ObservedSample, type ObservedReplayInput } from "../src/observed-replay.ts";

const period = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:10:00.000Z" };
const sourceUrl = "https://example.com/demo/master.m3u8";
function row(sequenceNumber: number, state: string, start: number, end: number, extra: Partial<ObservedSample> = {}): ObservedSample {
  return { sequenceNumber, clientTime: Date.parse(period.start) + (sequenceNumber + 1) * 20_000,
    state, ad: 0, played: state === "playing" ? Math.max(0, end - start) : 0,
    seeked: state === "seeking" ? 100 : 0, videotimeStart: start, videotimeEnd: end,
    videoDuration: 10_000, videoId: "demo-video", sourceUrl, ...extra };
}
function input(...records: ObservedSample[][]): ObservedReplayInput {
  return { content: { id: "demo-content", revision: "v1", durationMs: 10_000 }, period: { ...period },
    videoId: "demo-video", sourceUrl, sessions: records.map((samples, index) =>
      ({ id: "record-" + index, expectedLastSequence: Math.max(...samples.map(sample => sample.sequenceNumber)), samples })) };
}
const rewind = () => [row(0, "playing", 0, 8_000), row(1, "seeking", 8_000, 4_000), row(2, "playing", 4_000, 8_000)];

test("API coverage stays observed and includes every eligible playback record in the denominator", () => {
  const value = input(rewind(), [row(0, "playing", 0, 2_000)]);
  const original = structuredClone(value);
  const result = computeObservedReplay(value);
  assert.equal(result.synthetic, false);
  assert.equal(result.metricVersion, "observed-replay-coverage-v1");
  assert.equal(result.sessionCount, 2);
  assert.deepEqual(result.points.map(point => [point.reach, point.replay, point.support]),
    [[1, 0, 2], [.5, 0, 1], [.5, .5, 1], [.5, .5, 1], [null, null, 0]]);
  assert.deepEqual(value, original);
  assert.ok(!JSON.stringify(result).includes("record-0") && !JSON.stringify(result).includes(sourceUrl));
});

test("quality fragments and repeated passes cannot invent extra viewers", () => {
  const natural = input([row(0, "playing", 0, 8_000)]);
  const fragmented = input([row(0, "playing", 0, 4_000), row(1, "qualitychange", 4_000, 4_000), row(2, "playing", 4_000, 8_000)]);
  assert.deepEqual(computeObservedReplay(fragmented).points, computeObservedReplay(natural).points);
  const repeated = rewind().concat(row(3, "seeking", 8_000, 4_000), row(4, "playing", 4_000, 8_000));
  assert.deepEqual(computeObservedReplay(input(repeated)).points, computeObservedReplay(input(rewind())).points);
});

test("a negative interrupted PLAYING range corroborates a target-only backward seek", () => {
  const records = [row(0, "playing", 0, 8_000), row(1, "pause", 8_000, 8_000),
    row(2, "playing", 8_000, 4_000, { played: 300 }), row(3, "qualitychange", 4_000, 4_000),
    row(4, "seeking", 4_000, 4_010, { seeked: 0 }), row(5, "playing", 4_010, 8_010)];
  const result = computeObservedReplay(input(records));
  assert.equal(result.points[2].replay, .995);
  assert.equal(result.points[3].replay, 1);
  assert.equal(result.points[4].reach, .005);
  assert.equal(result.points[4].replay, 0);
});

test("a positive interrupted PLAYING range cannot turn a forward jump into watched coverage", () => {
  const records = [row(0, "playing", 0, 2_000), row(1, "pause", 2_000, 2_000),
    row(2, "playing", 2_000, 8_000, { played: 300 }),
    row(3, "seeking", 8_000, 8_010), row(4, "playing", 8_010, 10_000)];
  const result = computeObservedReplay(input(records));
  assert.deepEqual(result.points.slice(1, 4).map(point => [point.reach, point.replay]), [[null, null], [null, null], [null, null]]);
  assert.equal(result.points[4].reach, .995);
  assert.ok(result.points.every(point => point.replay === null || point.replay === 0));
});

test("forward seeks, pause ranges and zero-played notifications do not fill gaps", () => {
  const records = [row(0, "playing", 0, 2_000), row(1, "pause", 2_000, 4_000),
    row(2, "playing", 4_000, 4_000, { played: 1 }), row(3, "seeking", 4_000, 8_000),
    row(4, "playing", 8_000, 10_000), row(5, "buffering", 10_000, 10_000)];
  assert.deepEqual(computeObservedReplay(input(records)).points.map(point => point.reach), [1, null, null, null, 1]);
});

test("the final partial bucket uses its actual length", () => {
  const value = input([row(0, "playing", 0, 9_000), row(1, "seeking", 9_000, 8_000), row(2, "playing", 8_000, 9_000)]);
  value.content.durationMs = 9_000;
  value.sessions[0].samples.forEach(sample => { sample.videoDuration = 9_000; });
  const result = computeObservedReplay(value, 4_000);
  assert.deepEqual(result.points[2], { startMs: 8_000, endMs: 9_000, reach: 1, replay: 1, support: 1 });
});

test("an evidenced terminal media-clock overrun is intersected without changing raw observations", () => {
  const value = { ...input([row(0, "playing", 0, 9_000), row(1, "seeking", 9_000, 8_000), row(2, "playing", 8_000, 9_005)]), mediaDurationMs: 9_005 };
  value.content.durationMs = 9_000;
  value.sessions[0].samples.forEach(sample => { sample.videoDuration = 9_000; });
  const original = structuredClone(value);
  const result = computeObservedReplay(value, 4_000);
  assert.deepEqual(result.points[2], { startMs: 8_000, endMs: 9_000, reach: 1, replay: 1, support: 1 });
  assert.deepEqual(value, original);
  assert.equal(result.content.durationMs, 9_000);
});

test("terminal clock intersection requires bounded evidence and cannot relax other positions", () => {
  const overrun = () => input([row(0, "playing", 0, 10_005)]);
  assert.throws(() => computeObservedReplay(overrun()));
  for (const mediaDurationMs of [9_999, 10_006, 10_005.5, Number.NaN, Infinity]) {
    assert.throws(() => computeObservedReplay({ ...overrun(), mediaDurationMs }));
  }
  const malformed = input([row(0, "playing", 0, 8_000)]);
  Object.assign(malformed, { mediaDurationMs: null });
  assert.throws(() => computeObservedReplay(malformed));
  assert.throws(() => computeObservedReplay({ ...overrun(), mediaDurationMs: 10_004 }));
  for (const records of [
    [row(0, "playing", 0, 10_005), row(1, "pause", 10_000, 10_000)],
    [row(0, "pause", 0, 10_005)],
    [row(0, "playing", 0, 10_005, { played: 0 })],
    [row(0, "playing", 0, 10_005, { seeked: 1 })],
    [row(0, "playing", 10_000, 10_005)],
    [row(0, "playing", 10_001, 10_005)],
    [row(0, "playing", 0, 10_006)],
    [row(0, "playing", 0, 10_005, { videoDuration: 10_001 })],
  ]) assert.throws(() => computeObservedReplay({ ...input(records), mediaDurationMs: 10_005 }));
});

test("identical retries and shuffled packets are deduplicated, with gaps and conflicts rejected", () => {
  const value = input(rewind());
  value.sessions[0].samples = [value.sessions[0].samples[2], value.sessions[0].samples[0], value.sessions[0].samples[1], structuredClone(value.sessions[0].samples[1])];
  assert.deepEqual(computeObservedReplay(value), computeObservedReplay(input(rewind())));
  for (const mutate of [
    (data: ObservedReplayInput) => { data.sessions[0].samples.shift(); },
    (data: ObservedReplayInput) => { data.sessions[0].samples.splice(1, 1); },
    (data: ObservedReplayInput) => { data.sessions[0].expectedLastSequence++; },
    (data: ObservedReplayInput) => { data.sessions[0].samples.push({ ...data.sessions[0].samples[1], seeked: 200 }); },
  ]) {
    const invalid = input(rewind()); mutate(invalid);
    assert.throws(() => computeObservedReplay(invalid));
  }
});

test("missing, reordered or contradictory content clocks are rejected", () => {
  for (const records of [
    [row(0, "playing", 0, 8_000), row(1, "playing", 2_000, 4_000)],
    [row(0, "playing", 4_000, 8_000), row(1, "playing", 0, 10_000)],
    [row(0, "playing", 0, 8_000), row(1, "pause", 8_000, 4_000)],
    [row(0, "playing", 8_000, 4_000, { played: 200 })],
    [row(0, "playing", 8_000, 4_000, { played: 200 }), row(1, "seeking", 5_000, 6_000), row(2, "playing", 6_000, 8_000)],
    [row(0, "playing", 0, 8_000), row(1, "pause", 4_000, 4_000)],
    [row(0, "playing", 0, 8_000), row(1, "seeking", 7_000, 4_000), row(2, "playing", 4_000, 6_000)],
    [row(0, "playing", 0, 8_000), row(1, "seeking", 8_000, 4_000), row(2, "playing", 3_000, 6_000)],
    [row(0, "playing", 0, 4_000), row(1, "playing", 4_000, 8_000, { clientTime: Date.parse(period.start) })],
  ]) assert.throws(() => computeObservedReplay(input(records)));
});

test("API identity, advertising, numeric and field boundaries are strict", () => {
  for (const change of [
    { videoId: "other" }, { videoDuration: 9_999 }, { sourceUrl: "https://example.com/other.m3u8" },
    { ad: 1 }, { ad: 2 }, { clientTime: Number.NaN }, { sequenceNumber: -1 },
    { videotimeEnd: 10_001 }, { videotimeStart: -1 }, { played: -1 }, { seeked: -1 },
  ]) assert.throws(() => computeObservedReplay(input([{ ...row(0, "playing", 0, 4_000), ...change }])));
  const missing = input(rewind());
  delete (missing.sessions[0].samples[0] as Partial<ObservedSample>).clientTime;
  assert.throws(() => computeObservedReplay(missing));
  const identifying = input(rewind());
  Object.assign(identifying.sessions[0].samples[0], { userId: "must-not-be-forwarded" });
  assert.throws(() => computeObservedReplay(identifying));
  const duplicate = input(rewind(), rewind()); duplicate.sessions[1].id = duplicate.sessions[0].id;
  assert.throws(() => computeObservedReplay(duplicate));
});

test("startup-only records and empty inputs retain unavailable coverage", () => {
  const empty = computeObservedReplay(input([row(0, "startup", 0, 0)]));
  assert.equal(empty.sessionCount, 0);
  assert.equal(empty.suggestedMode, "empty");
  assert.ok(empty.points.every(point => point.reach === null && point.replay === null));
  assert.deepEqual(computeObservedReplay(input()).points, empty.points);
});

test("ambiguous-only records, collection bounds and out-of-period samples are rejected", () => {
  assert.throws(() => computeObservedReplay(input([row(0, "playing", 0, 8_000), row(1, "seeking", 8_000, 9_000)])));
  const manySessions = input(rewind());
  manySessions.sessions = new Array(1_001).fill(manySessions.sessions[0]);
  assert.throws(() => computeObservedReplay(manySessions));
  const manySamples = input(rewind());
  manySamples.sessions[0].samples = new Array(100_001).fill(row(0, "playing", 0, 8_000));
  assert.throws(() => computeObservedReplay(manySamples));
  assert.throws(() => computeObservedReplay(input(rewind()), 1));
  assert.throws(() => computeObservedReplay(input([row(0, "playing", 0, 8_000, { clientTime: Date.parse(period.end) + 1 })])));
});

test("inspection exposes canonical passes and per-record unions that reconcile every graph bucket", () => {
  const value = input(rewind(), [row(0, "playing", 0, 1_500)], [row(0, "startup", 0, 0)]);
  const original = structuredClone(value);
  const inspection = inspectObservedReplay(value, 3_000);
  assert.deepEqual(inspection.snapshot, computeObservedReplay(value, 3_000));
  assert.equal(inspection.records.length, 3);
  assert.equal(inspection.snapshot.sessionCount, 2);
  assert.deepEqual(inspection.records[0], { id: "record-0", samples: [
    { sequenceNumber: 0, passIndex: 0, reason: "played", countedRange: [0, 8_000], seekOriginMs: null, seekTargetMs: null },
    { sequenceNumber: 1, passIndex: 1, reason: "seek-backward", countedRange: null, seekOriginMs: 8_000, seekTargetMs: 4_000 },
    { sequenceNumber: 2, passIndex: 1, reason: "played", countedRange: [4_000, 8_000], seekOriginMs: null, seekTargetMs: null },
  ], passes: [[[0, 8_000]], [[4_000, 8_000]]], reach: [[0, 8_000]], replay: [[4_000, 8_000]] });
  assert.deepEqual(inspection.records[2].reach, []);
  for (const point of inspection.snapshot.points) {
    const overlap = (ranges: [number, number][]) => ranges.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, point.endMs) - Math.max(start, point.startMs)), 0);
    const reached = inspection.records.map(record => overlap(record.reach));
    const replayed = inspection.records.map(record => overlap(record.replay));
    const support = reached.filter(ms => ms > 0).length;
    const denominator: number = (point.endMs - point.startMs) * inspection.snapshot.sessionCount;
    assert.equal(point.support, support);
    assert.equal(point.reach, support ? reached.reduce((a, b) => a + b, 0) / denominator : null);
    assert.equal(point.replay, support ? replayed.reduce((a, b) => a + b, 0) / denominator : null);
  }
  assert.deepEqual(value, original);
});

test("inspection explains target carry, interrupted packets and resolved backward seek origins", () => {
  const value = input([row(0, "playing", 0, 8_000), row(1, "pause", 8_000, 8_000),
    row(2, "playing", 8_000, 4_000, { played: 300 }), row(3, "qualitychange", 4_000, 4_000),
    row(4, "seeking", 4_000, 4_010, { seeked: 0 }), row(5, "playing", 4_010, 8_010)]);
  const result = inspectObservedReplay(value);
  assert.deepEqual(result.snapshot, computeObservedReplay(value));
  assert.deepEqual(result.records[0].samples.map(sample => [sample.reason, sample.passIndex]), [
    ["played", 0], ["not-playing", 0], ["ambiguous-before-seek", 0], ["carried-seek-target", 0], ["seek-backward", 1], ["played", 1],
  ]);
  assert.deepEqual(result.records[0].samples[4], { sequenceNumber: 4, passIndex: 1, reason: "seek-backward", countedRange: null, seekOriginMs: 8_000, seekTargetMs: 4_010 });
  assert.ok(result.records[0].samples.slice(1, 5).every(sample => sample.countedRange === null));
  assert.deepEqual(result.records[0].passes, [[[0, 8_000]], [[4_010, 8_010]]]);
});

test("inspection distinguishes forward gaps and notifications without inventing a new pass", () => {
  const value = input([row(0, "startup", 0, 0), row(1, "playing", 0, 2_000), row(2, "pause", 2_000, 2_000),
    row(3, "playing", 2_000, 8_000, { played: 300 }), row(4, "seeking", 8_000, 8_010),
    row(5, "playing", 8_010, 8_010, { played: 1 }), row(6, "playing", 8_010, 10_000)]);
  const result = inspectObservedReplay(value);
  assert.deepEqual(result.snapshot, computeObservedReplay(value));
  assert.deepEqual(result.records[0].samples.map(sample => sample.reason), ["not-playing", "played", "not-playing", "ambiguous-before-seek", "seek-forward", "no-played-range", "played"]);
  assert.ok(result.records[0].samples.every(sample => sample.passIndex === 0));
  assert.deepEqual(result.records[0].reach, [[0, 2_000], [8_010, 10_000]]);
  assert.deepEqual(result.records[0].replay, []);
});

test("inspection deduplicates retries, preserves clipped raw ends and retains strict validation", () => {
  const value = input(rewind());
  const canonical = inspectObservedReplay(value);
  value.sessions[0].samples = [value.sessions[0].samples[2], value.sessions[0].samples[0], value.sessions[0].samples[1], structuredClone(value.sessions[0].samples[1])];
  assert.deepEqual(inspectObservedReplay(value), canonical);
  const terminal = { ...input([row(0, "playing", 0, 10_005)]), mediaDurationMs: 10_005 };
  const original = structuredClone(terminal);
  const result = inspectObservedReplay(terminal);
  assert.deepEqual(result.records[0].samples[0].countedRange, [0, 10_000]);
  assert.deepEqual(result.records[0].reach, [[0, 10_000]]);
  assert.deepEqual(terminal, original);
  const gap = input(rewind()); gap.sessions[0].samples.splice(1, 1);
  assert.throws(() => inspectObservedReplay(gap));
  assert.throws(() => inspectObservedReplay(input([row(0, "playing", 0, 10_005)])));
  assert.deepEqual(inspectObservedReplay(input()).records, []);
});
