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
