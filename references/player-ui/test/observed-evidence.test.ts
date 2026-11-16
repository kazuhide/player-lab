import assert from "node:assert/strict";
import test from "node:test";
import { observedEvidenceInput, validateObservedReplayEvidence, type ObservedReplayEvidence, type RawObservedSample } from "../src/observed-evidence.ts";
import type { ObservedReplaySnapshot } from "../src/types.ts";

const period = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:10:00.000Z" };
const sourceUrl = "https://example.com/demo/master.m3u8";
function row(sequence_number: number, state: string, videotime_start: number, videotime_end: number): RawObservedSample {
  return { sequence_number, client_time: Date.parse(period.start) + (sequence_number + 1) * 1_000,
    state, ad: 0, played: state === "playing" ? videotime_end - videotime_start : 0,
    seeked: state === "seeking" ? 103 : 0, videotime_start, videotime_end,
    video_duration: 9_000, video_id: "demo-video", m3u8_url: sourceUrl };
}
function evidence(): ObservedReplayEvidence {
  return { schemaVersion: 1, videoId: "demo-video", sourceUrl, mediaDurationMs: 9_005,
    sessions: [
      { id: "record-a", expectedLastSequence: 2, fetchedAt: "2026-01-01T00:11:00.123Z",
        response: { status: "SUCCESS", data: { result: [row(0, "playing", 0, 9_000), row(1, "seeking", 9_000, 4_000), row(2, "playing", 4_000, 9_005)] } } },
      { id: "record-b", expectedLastSequence: 0, fetchedAt: "2026-01-01T00:11:01.456Z",
        response: { status: "SUCCESS", data: { result: [row(0, "playing", 0, 4_000)] } } },
    ] };
}
function snapshot(): ObservedReplaySnapshot {
  return { schemaVersion: 1, metricVersion: "observed-replay-coverage-v1", synthetic: false,
    content: { id: "demo-content", revision: "v1", durationMs: 9_000 }, period: { ...period },
    generatedAt: "2026-01-01T01:00:00.000Z", sessionCount: 2, bucketWidthMs: 4_000, suggestedMode: "replay",
    points: [
      { startMs: 0, endMs: 4_000, reach: 1, replay: 0, support: 2 },
      { startMs: 4_000, endMs: 8_000, reach: .5, replay: .5, support: 1 },
      { startMs: 8_000, endMs: 9_000, reach: .5, replay: .5, support: 1 },
    ] };
}

test("API response excerpts retain exact raw values and map directly into the canonical input", () => {
  const value = evidence();
  const original = structuredClone(value);
  const result = validateObservedReplayEvidence(value, snapshot());
  assert.deepEqual(result, original);
  const input = observedEvidenceInput(result, snapshot());
  assert.deepEqual(input.content, snapshot().content);
  assert.deepEqual(input.period, period);
  assert.equal(input.mediaDurationMs, 9_005);
  assert.deepEqual(input.sessions[0], { id: "record-a", expectedLastSequence: 2, samples: [
    { sequenceNumber: 0, clientTime: Date.parse(period.start) + 1_000, state: "playing", ad: 0, played: 9_000,
      seeked: 0, videotimeStart: 0, videotimeEnd: 9_000, videoDuration: 9_000, videoId: "demo-video", sourceUrl },
    { sequenceNumber: 1, clientTime: Date.parse(period.start) + 2_000, state: "seeking", ad: 0, played: 0,
      seeked: 103, videotimeStart: 9_000, videotimeEnd: 4_000, videoDuration: 9_000, videoId: "demo-video", sourceUrl },
    { sequenceNumber: 2, clientTime: Date.parse(period.start) + 3_000, state: "playing", ad: 0, played: 5_005,
      seeked: 0, videotimeStart: 4_000, videotimeEnd: 9_005, videoDuration: 9_000, videoId: "demo-video", sourceUrl },
  ] });
  assert.deepEqual(value, original);
});

test("raw API retries and response ordering are preserved while canonical validation deduplicates them", () => {
  const value = evidence();
  const samples = value.sessions[0].response.data.result;
  value.sessions[0].response.data.result = [samples[2], samples[0], samples[1], structuredClone(samples[1])];
  assert.deepEqual(validateObservedReplayEvidence(value, snapshot()), value);
  assert.deepEqual(observedEvidenceInput(value, snapshot()).sessions[0].samples.map(sample => sample.sequenceNumber), [2, 0, 1, 1]);
});

test("evidence must reproduce every bucket value and eligible-record count exactly", () => {
  for (const mutate of [
    (value: ObservedReplaySnapshot) => { value.points[0].reach = .99; },
    (value: ObservedReplaySnapshot) => { value.points[1].replay = .49; },
    (value: ObservedReplaySnapshot) => { value.points[0].support = 1; value.points[0].reach = .5; },
    (value: ObservedReplaySnapshot) => { value.sessionCount = 3; value.points[0].reach = 2 / 3; value.points[1].reach = 1 / 3; value.points[1].replay = 1 / 3; value.points[2].reach = 1 / 3; value.points[2].replay = 1 / 3; },
    (value: ObservedReplaySnapshot) => { value.points.forEach(point => { point.replay = 0; }); value.suggestedMode = "reach"; },
    (value: ObservedReplaySnapshot) => { value.content.durationMs = 9_001; value.points[2].endMs = 9_001; },
    (value: ObservedReplaySnapshot) => { value.period.start = "2026-01-01T00:00:02.000Z"; },
  ]) {
    const value = snapshot(); mutate(value);
    assert.throws(() => validateObservedReplayEvidence(evidence(), value));
  }
  assert.throws(() => validateObservedReplayEvidence(evidence(), { ...snapshot(), metricVersion: "replay-coverage-v1", synthetic: true } as unknown as ObservedReplaySnapshot));
});

test("the independent final sequence and raw content identity cannot be inferred from a partial response", () => {
  for (const mutate of [
    (value: ObservedReplayEvidence) => { value.sessions[0].expectedLastSequence = 3; },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result.pop(); },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result[0].video_id = "other-video"; },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result[0].video_duration = 8_999; },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result[0].m3u8_url = "https://example.com/other.m3u8"; },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result[0].ad = 1; },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result[0].client_time = Date.parse(period.end) + 1; },
    (value: ObservedReplayEvidence) => { value.sessions[1].id = value.sessions[0].id; },
  ]) {
    const value = evidence(); mutate(value);
    assert.throws(() => validateObservedReplayEvidence(value, snapshot()));
  }
});

test("evidence wrappers and raw samples reject additional metadata and missing fields", () => {
  for (const select of [
    (value: ObservedReplayEvidence) => value,
    (value: ObservedReplayEvidence) => value.sessions[0],
    (value: ObservedReplayEvidence) => value.sessions[0].response,
    (value: ObservedReplayEvidence) => value.sessions[0].response.data,
    (value: ObservedReplayEvidence) => value.sessions[0].response.data.result[0],
  ]) {
    const value = evidence();
    Object.assign(select(value), { user_id: "must-not-be-forwarded" });
    assert.throws(() => validateObservedReplayEvidence(value, snapshot()));
  }
  for (const key of Object.keys(evidence().sessions[0].response.data.result[0])) {
    const value = evidence();
    delete (value.sessions[0].response.data.result[0] as unknown as Record<string, unknown>)[key];
    assert.throws(() => validateObservedReplayEvidence(value, snapshot()), key);
  }
  assert.throws(() => validateObservedReplayEvidence({ ...evidence(), schemaVersion: 2 }, snapshot()));
  assert.throws(() => validateObservedReplayEvidence(null, snapshot()));
});

test("evidence collection metadata and response sizes have strict bounds", () => {
  for (const mutate of [
    (value: ObservedReplayEvidence) => { value.videoId = "v".repeat(513); },
    (value: ObservedReplayEvidence) => { value.sourceUrl = "https://user:password@example.com/master.m3u8"; },
    (value: ObservedReplayEvidence) => { value.sessions[0].id = "r".repeat(121); },
    (value: ObservedReplayEvidence) => { value.sessions[0].expectedLastSequence = 100_000; },
    (value: ObservedReplayEvidence) => { value.sessions[0].fetchedAt = "2026-01-01T00:00:00Z"; },
    (value: ObservedReplayEvidence) => { value.sessions[0].fetchedAt = "2026-02-30T00:00:00.000Z"; },
    (value: ObservedReplayEvidence) => { value.sessions[0].fetchedAt = period.start; },
    (value: ObservedReplayEvidence) => { value.sessions = new Array(1_001).fill(value.sessions[0]); },
    (value: ObservedReplayEvidence) => { value.sessions[0].response.data.result = new Array(100_001).fill(value.sessions[0].response.data.result[0]); },
  ]) {
    const value = evidence(); mutate(value);
    assert.throws(() => validateObservedReplayEvidence(value, snapshot()));
  }
  const invalid = evidence();
  Object.assign(invalid.sessions[0].response, { status: "ERROR" });
  assert.throws(() => validateObservedReplayEvidence(invalid, snapshot()));
});
