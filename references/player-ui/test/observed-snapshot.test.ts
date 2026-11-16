import assert from "node:assert/strict";
import test from "node:test";
import { validateObservedReplaySnapshot, validateSnapshot } from "../src/snapshot.ts";

function observed() {
  return {
    schemaVersion: 1, metricVersion: "observed-replay-coverage-v1", synthetic: false,
    content: { id: "demo-video", revision: "demo-v1", durationMs: 6_000 },
    period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" },
    generatedAt: "2026-01-02T00:00:00.000Z",
    sessionCount: 4, bucketWidthMs: 2_000, suggestedMode: "replay",
    points: [
      { startMs: 0, endMs: 2_000, support: 4, reach: 1, replay: .5 },
      { startMs: 2_000, endMs: 4_000, support: 2, reach: .5, replay: 0 },
      { startMs: 4_000, endMs: 6_000, support: 0, reach: null, replay: null },
    ],
  };
}

test("observed replay snapshots retain their measured provenance and original values", () => {
  const input = observed();
  const original = structuredClone(input);
  const result = validateObservedReplaySnapshot(input);
  assert.equal(result.synthetic, false);
  assert.equal(result.metricVersion, "observed-replay-coverage-v1");
  assert.equal(result.points[0].replay, .5);
  assert.deepEqual(input, original);
  assert.throws(() => validateSnapshot(input), /synthetic/);
});

test("observed and authored coverage versions cannot be interchanged", () => {
  const authored = { ...observed(), metricVersion: "replay-coverage-v1", synthetic: true };
  assert.equal(validateSnapshot(authored).synthetic, true);
  assert.throws(() => validateObservedReplaySnapshot(authored));
  assert.throws(() => validateObservedReplaySnapshot({ ...observed(), synthetic: true }));
  assert.throws(() => validateObservedReplaySnapshot({ ...observed(), metricVersion: "replay-coverage-v1" }));
  assert.throws(() => validateSnapshot({ ...authored, synthetic: false }));
});

test("observed coverage keeps the existing timeline, support and missing-data constraints", () => {
  for (const mutate of [
    (input: ReturnType<typeof observed>) => { input.points[0].replay = 1.1; },
    (input: ReturnType<typeof observed>) => { input.points[1].reach = .75; },
    (input: ReturnType<typeof observed>) => { input.points[2].replay = 0; },
    (input: ReturnType<typeof observed>) => { input.points[1].startMs = 2_001; },
    (input: ReturnType<typeof observed>) => { input.sessionCount = 0; },
    (input: ReturnType<typeof observed>) => { input.suggestedMode = "reach"; },
    (input: ReturnType<typeof observed>) => { input.generatedAt = "2026-01-01T00:00:00.000Z"; },
    (input: ReturnType<typeof observed>) => { Object.assign(input.points[0], { userId: "unexpected" }); },
  ]) {
    const input = observed();
    mutate(input);
    assert.throws(() => validateObservedReplaySnapshot(input));
  }
});
