import assert from "node:assert/strict";
import test from "node:test";
import { createTimelineGeometry } from "../src/timeline-geometry.ts";
import type { EngagementPoint, EngagementSnapshot } from "../src/types.ts";

function snapshot(values: (number | null)[], sessionCount = 20): EngagementSnapshot {
  return {
    schemaVersion: 1,
    metricVersion: "replay-coverage-v1",
    synthetic: true,
    content: { id: "fixture", revision: "r1", durationMs: values.length * 1000 },
    period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    generatedAt: "2026-01-02T00:00:00Z",
    sessionCount,
    bucketWidthMs: 1000,
    suggestedMode: "replay",
    points: values.map((replay, index): EngagementPoint => ({
      startMs: index * 1000,
      endMs: (index + 1) * 1000,
      replay,
      reach: replay === null ? null : 1,
      support: replay === null ? 0 : sessionCount,
    })),
  };
}

test("unknown buckets split the rendered curve instead of becoming measured valleys", () => {
  const result = createTimelineGeometry(snapshot([0.2, 0.6, null, 0.1]), "replay", 400, 50);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].startX, 0);
  assert.equal(result.segments[0].endX, 200);
  assert.equal(result.segments[1].startX, 300);
  assert.equal(result.segments[1].endX, 400);
});

test("no observed replay remains flat even when reach is positive", () => {
  const result = createTimelineGeometry(snapshot([0, 0, 0]), "replay", 300, 50);
  assert.equal(result.hasValues, true);
  assert.equal(result.hasPositiveValues, false);
  assert.equal(result.maximum, 0);
  assert.deepEqual(result.peaks, []);
  assert.ok(result.segments[0].points.every(point => point.y === result.baselineY));
});

test("smoothing is bounded, stronger for sparse observations and leaves the source untouched", () => {
  const source = snapshot([0, 1, 0], 1);
  const original = structuredClone(source);
  const sparse = createTimelineGeometry(source, "replay", 300, 50);
  const dense = createTimelineGeometry(snapshot([0, 1, 0], 100), "replay", 300, 50);
  const sparseValues = sparse.segments[0].points.map(point => point.value);
  const denseValues = dense.segments[0].points.map(point => point.value);
  assert.ok(sparseValues.every(value => value >= 0 && value <= 1));
  assert.ok(sparseValues[1] < denseValues[1]);
  assert.ok(sparseValues[0] > denseValues[0]);
  assert.deepEqual(source, original);
  assert.equal(sparse.peaks.length, 1);
  assert.equal(sparse.peaks[0].x, 150);
  assert.equal(sparse.peaks[0].rawValue, 1);
});

test("a constant nonzero distribution does not invent a peak", () => {
  const result = createTimelineGeometry(snapshot([0.4, 0.4, 0.4]), "replay", 300, 50);
  assert.equal(result.hasPositiveValues, true);
  assert.deepEqual(result.peaks, []);
});

test("coverage normalization preserves absolute rates on a shared zero-to-one scale", () => {
  const height = 50;
  for (const rate of [0.4, 0.8]) {
    const source = snapshot([rate, rate, rate]);
    const result = createTimelineGeometry(source, "replay", 300, height, "coverage");
    assert.equal(result.maximum, rate, "the reported maximum remains the measured maximum");
    for (const point of result.segments[0].points) {
      const heightFraction = (result.baselineY - point.y) / (height - 3);
      assert.ok(Math.abs(heightFraction - rate) < 0.000001, `${rate} coverage must occupy ${rate * 100}% of the available height`);
    }
    const relative = createTimelineGeometry(source, "replay", 300, height);
    assert.ok(relative.segments[0].points.every(point => Math.abs(point.y - 2) < 0.000001), "the existing within-video graph still fills its available height");
  }
});

test("coverage normalization uses the same vertical scale for reach and replay", () => {
  const source = snapshot([0.1, 0.6, 0.2, 0.4]);
  for (const point of source.points) point.reach = point.replay;
  assert.deepEqual(
    createTimelineGeometry(source, "reach", 400, 50, "coverage"),
    createTimelineGeometry(source, "replay", 400, 50, "coverage"),
  );
});

test("coverage normalization retains smoothing, missing gaps, raw measurements and logical peaks", () => {
  const source = snapshot([0, 0.6, null, 0.8, 0], 1);
  const original = structuredClone(source);
  const relative = createTimelineGeometry(source, "replay", 500, 50);
  const absolute = createTimelineGeometry(source, "replay", 500, 50, "coverage");
  assert.deepEqual(absolute.segments.map(segment => [segment.startX, segment.endX]), [[0, 200], [300, 500]]);
  const measurements = (points: { x: number; value: number; rawValue: number }[]) =>
    points.map(({ x, value, rawValue }) => ({ x, value, rawValue }));
  assert.deepEqual(absolute.segments.map(segment => measurements(segment.points)), relative.segments.map(segment => measurements(segment.points)));
  assert.deepEqual(measurements(absolute.peaks), measurements(relative.peaks));
  assert.deepEqual(source, original);
  const zero = createTimelineGeometry(snapshot([0, 0]), "replay", 200, 50, "coverage");
  assert.equal(zero.hasValues, true);
  assert.equal(zero.hasPositiveValues, false);
  assert.ok(zero.segments[0].points.every(point => point.y === zero.baselineY));
  assert.deepEqual(createTimelineGeometry(snapshot([null, null]), "replay", 200, 50, "coverage").segments, []);
});

test("omitting normalization preserves the explicit within-video geometry", () => {
  const source = snapshot([0.1, 0.5, null, 0.8, 0]);
  assert.deepEqual(
    createTimelineGeometry(source, "replay", 500, 50),
    createTimelineGeometry(source, "replay", 500, 50, "within-video"),
  );
});

test("bucket coordinates follow the content duration and actual partial final bucket", () => {
  const source = snapshot([0.2, 0.5, 0.3]);
  source.content.durationMs = 2500;
  source.points[2].endMs = 2500;
  const result = createTimelineGeometry(source, "replay", 500, 50);
  assert.equal(result.segments[0].endX, 500);
  assert.equal(result.segments[0].points[2].x, 450);
});

test("an omitted interval is a gap even without an explicit null bucket", () => {
  const source = snapshot([0.2, 0.4, 0.1]);
  source.points.splice(1, 1);
  assert.equal(createTimelineGeometry(source, "replay", 300, 50).segments.length, 2);
});

test("missing snapshots, invalid viewport sizes and invalid values produce no invented observations", () => {
  assert.equal(createTimelineGeometry(null, "replay", 300, 50).segments.length, 0);
  assert.equal(createTimelineGeometry(snapshot([0.5]), "replay", 0, 50).segments.length, 0);
  assert.equal(createTimelineGeometry(snapshot([Number.NaN, -0.1, 1.2]), "replay", 300, 50).segments.length, 0);
});

test("the drawn curve has continuous slopes and cannot overshoot adjacent values", () => {
  const source = snapshot([0, 0.1, 0.9, 0.3, 0, 0.6, 0.2, 0]);
  const original = structuredClone(source);
  const result = createTimelineGeometry(source, "replay", 800, 30);
  const tokens = result.segments[0].linePath.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)!;
  assert.equal(tokens.shift(), "M");
  let start = [Number(tokens.shift()), Number(tokens.shift())];
  let previousSlope: number | undefined;
  let count = 0;
  while (tokens.length) {
    assert.equal(tokens.shift(), "C", "the silhouette must be a smooth curve rather than a polygon");
    const controls = Array.from({ length: 3 }, () => [Number(tokens.shift()), Number(tokens.shift())]);
    const [first, second, end] = controls;
    const incoming = (first[1] - start[1]) / (first[0] - start[0]);
    if (previousSlope !== undefined) assert.ok(Math.abs(incoming - previousSlope) < 0.001, "joins must not introduce visible corners");
    previousSlope = (end[1] - second[1]) / (end[0] - second[0]);
    for (let step = 0; step <= 20; step++) {
      const t = step / 20;
      const y = (1 - t) ** 3 * start[1] + 3 * (1 - t) ** 2 * t * first[1] + 3 * (1 - t) * t ** 2 * second[1] + t ** 3 * end[1];
      assert.ok(y >= Math.min(start[1], end[1]) - 0.000001 && y <= Math.max(start[1], end[1]) + 0.000001, "smoothing must not invent peaks or negative coverage");
    }
    start = end;
    count++;
  }
  assert.ok(count >= source.points.length);
  assert.deepEqual(source, original);
});
