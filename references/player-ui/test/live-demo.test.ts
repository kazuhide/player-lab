import assert from "node:assert/strict";
import test from "node:test";
import { createLiveDemoScenarios } from "../tools/live-demo.ts";
import { validateSnapshot } from "../src/snapshot.ts";

const content = { id: "example-live-window", revision: "fixture-v1", durationMs: 300_000 };
const period = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:10:00.000Z" };

test("live scenarios deterministically generate fresh synthetic playback records", () => {
  const scenarios = createLiveDemoScenarios(content, period);
  assert.deepEqual(scenarios, createLiveDemoScenarios(content, period));
  assert.deepEqual(scenarios.map(item => item.id), ["live-focused", "live-distributed", "live-sparse"]);
  for (const scenario of scenarios) {
    assert.equal(scenario.export.synthetic, true);
    assert.equal(scenario.snapshot.synthetic, true);
    assert.equal(validateSnapshot(scenario.snapshot).suggestedMode, "replay");
    assert.ok(scenario.snapshot.points.some(point => (point.replay ?? 0) > 0));
    assert.ok(scenario.export.samples.every(sample => sample.impressionId.startsWith("live-demo-")));
    for (const point of scenario.snapshot.points) {
      if (point.reach !== null && point.replay !== null) assert.ok(point.replay >= 0 && point.replay <= point.reach && point.reach <= 1);
    }
  }
});

test("concentrated replay produces localized peaks instead of rewarding ordinary reach", () => {
  const [focused, distributed] = createLiveDemoScenarios(content, period);
  const peak = (points: typeof focused.snapshot.points) => Math.max(...points.map(point => point.replay ?? 0));
  assert.ok(peak(focused.snapshot.points) > peak(distributed.snapshot.points) + .15);
  const distinctRewindOrigins = new Set(distributed.export.samples.filter(sample =>
    sample.state === "seeking" && sample.videotimeEnd < sample.videotimeStart).map(sample => sample.videotimeStart));
  assert.ok(distinctRewindOrigins.size >= 7);
  const strongest = focused.snapshot.points.toSorted((a, b) => (b.replay ?? 0) - (a.replay ?? 0))[0];
  assert.ok(strongest.startMs >= content.durationMs * .35 && strongest.startMs <= content.durationMs * .5);
  assert.ok(focused.snapshot.points.some(point => point.startMs > content.durationMs * .68 && (point.replay ?? 0) > .1));
});

test("live viewers join at different positions and restore the advancing live position after rewinding", () => {
  const [scenario] = createLiveDemoScenarios(content, period);
  const records = new Map<string, typeof scenario.export.samples>();
  for (const sample of scenario.export.samples) {
    const values = records.get(sample.impressionId) ?? [];
    values.push(sample);
    records.set(sample.impressionId, values);
  }
  const joins = new Set([...records.values()].map(samples => samples[0].videotimeStart));
  assert.ok(joins.size > 3);
  let backwards = 0, returns = 0;
  for (const samples of records.values()) {
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      if (sample.state !== "seeking") continue;
      assert.equal(sample.played, 0);
      if (sample.videotimeEnd < sample.videotimeStart) {
        backwards++;
        assert.ok(samples.slice(0, index).some(prior => prior.state === "playing" && prior.videotimeStart <= sample.videotimeEnd && prior.videotimeEnd > sample.videotimeEnd));
      } else {
        returns++;
        assert.ok(Math.abs(sample.videotimeEnd - (sample.time - Date.parse(period.start))) <= 1);
      }
    }
  }
  assert.ok(backwards > 0 && returns === backwards);
});

test("sparse live data preserves its small population without inventing extra observers", () => {
  const [focused, , sparse] = createLiveDemoScenarios(content, period);
  assert.ok(sparse.snapshot.sessionCount >= 3 && sparse.snapshot.sessionCount < focused.snapshot.sessionCount);
  assert.equal(new Set(sparse.export.samples.map(sample => sample.impressionId)).size, sparse.snapshot.sessionCount);
  assert.equal(sparse.snapshot.points.length, 150);
  assert.ok(sparse.snapshot.points.every(point => point.support <= sparse.snapshot.sessionCount));
});

test("unsupported live-demo durations and reporting windows are rejected", () => {
  assert.throws(() => createLiveDemoScenarios({ ...content, durationMs: 5_000 }, period));
  assert.throws(() => createLiveDemoScenarios(content, { ...period, end: "2026-01-01T00:01:00.000Z" }));
});
