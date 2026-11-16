import assert from "node:assert/strict";
import test from "node:test";
import { validatePrivateData } from "../src/private-data.ts";
import type { ObservedReplayEvidence } from "../src/observed-evidence.ts";
import type { EngagementSnapshot, ObservedReplaySnapshot } from "../src/types.ts";

function snapshot(): EngagementSnapshot {
  return {
    schemaVersion: 1, metricVersion: "replay-coverage-v1", synthetic: true,
    content: { id: "demo-video", revision: "demo-v1", durationMs: 6_000 },
    period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" },
    generatedAt: "2026-01-02T00:00:00.000Z",
    sessionCount: 4, bucketWidthMs: 2_000, suggestedMode: "replay",
    points: [
      { startMs: 0, endMs: 2_000, support: 4, reach: 1, replay: 0.5 },
      { startMs: 2_000, endMs: 4_000, support: 2, reach: 0.5, replay: 0 },
      { startMs: 4_000, endMs: 6_000, support: 0, reach: null, replay: null },
    ],
  };
}

function pack() {
  return {
    schemaVersion: 1, kind: "synthetic-live-demo",
    source: { hls: "/__private/media/master.m3u8" },
    profiles: [
      { id: "focused", title: { en: "Focused replay", ja: "集中" }, snapshot: snapshot() },
      { id: "diffuse", title: { en: "Diffuse replay", ja: "分散" }, snapshot: snapshot() },
    ],
  };
}

function query() {
  const sample = snapshot();
  return {
    schemaVersion: 1, metricVersion: "watched-impression-incidence-v1", complete: true,
    content: sample.content, period: sample.period, generatedAt: sample.generatedAt,
    source: { hls: "https://example.com/video.m3u8" },
    sessionCount: 4, bucketWidthMs: 2_000,
    buckets: [
      { startMs: 0, endMs: 2_000, impressions: 4 },
      { startMs: 2_000, endMs: 4_000, impressions: 2 },
      { startMs: 4_000, endMs: 6_000, impressions: 0 },
    ],
  };
}

function observedPack() {
  const sourceUrl = "https://example.com/demo/master.m3u8";
  const row = (sequence_number: number, state: string, videotime_start: number, videotime_end: number) => ({
    sequence_number, client_time: Date.parse("2026-01-01T00:00:00.000Z") + (sequence_number + 1) * 1_000,
    state, ad: 0, played: state === "playing" ? videotime_end - videotime_start : 0,
    seeked: state === "seeking" ? 100 : 0, videotime_start, videotime_end,
    video_duration: 6_000, video_id: "demo-video", m3u8_url: sourceUrl,
  });
  const evidence: ObservedReplayEvidence = { schemaVersion: 1, videoId: "demo-video", sourceUrl, sessions: [
    { id: "record-a", expectedLastSequence: 2, fetchedAt: "2026-01-02T00:01:00.000Z", response: { status: "SUCCESS", data: { result: [
      row(0, "playing", 0, 4_000), row(1, "seeking", 4_000, 2_000), row(2, "playing", 2_000, 4_000),
    ] } } },
    { id: "record-b", expectedLastSequence: 0, fetchedAt: "2026-01-02T00:01:00.000Z", response: { status: "SUCCESS", data: { result: [row(0, "playing", 0, 2_000)] } } },
  ] };
  const observed: ObservedReplaySnapshot = { ...snapshot(), metricVersion: "observed-replay-coverage-v1", synthetic: false, sessionCount: 2,
    points: [
      { startMs: 0, endMs: 2_000, support: 2, reach: 1, replay: 0 },
      { startMs: 2_000, endMs: 4_000, support: 1, reach: .5, replay: .5 },
      { startMs: 4_000, endMs: 6_000, support: 0, reach: null, replay: null },
    ] };
  return { ...pack(), kind: "observability-replay-demo", profiles: [{ id: "focused", title: { en: "Focused replay", ja: "集中" }, snapshot: observed, evidence }] };
}

test("private inputs distinguish authored live scenarios from real Query counts", () => {
  const input = pack();
  const original = structuredClone(input);
  const result = validatePrivateData(input);
  assert.equal(result.kind, "synthetic-live-demo");
  if (result.kind !== "synthetic-live-demo") assert.fail("scenario pack lost its explicit kind");
  assert.equal(result.profiles.length, 2);
  assert.equal(result.profiles[0].snapshot.synthetic, true);
  assert.equal(result.profiles[0].snapshot.points[0].replay, 0.5);
  assert.deepEqual(input, original);
  assert.deepEqual(result.source, input.source);
  const real = validatePrivateData(query());
  assert.equal(real.kind, "query");
  if (real.kind !== "query") assert.fail("Query counts became synthetic data");
  assert.equal(real.snapshot.synthetic, false);
  assert.ok(real.snapshot.points.every(point => point.replay === null));
});

test("Observability demo profiles preserve API-derived replay without becoming authored fixtures", () => {
  const input = {
    ...pack(), kind: "observability-replay-demo",
    profiles: pack().profiles.map(profile => ({
      ...profile, snapshot: { ...profile.snapshot, metricVersion: "observed-replay-coverage-v1", synthetic: false },
    })),
  };
  const original = structuredClone(input);
  const result = validatePrivateData(input);
  assert.equal(result.kind, "observability-replay-demo");
  if (result.kind !== "observability-replay-demo") assert.fail("API demo lost its origin");
  assert.equal(result.profiles[0].snapshot.synthetic, false);
  assert.equal(result.profiles[0].snapshot.points[0].replay, .5);
  assert.deepEqual(input, original);
  assert.throws(() => validatePrivateData({ ...input, kind: "synthetic-live-demo" }));
  assert.throws(() => validatePrivateData({ ...pack(), kind: "observability-replay-demo" }));
  const mixed = structuredClone(input);
  mixed.profiles[1].snapshot.content.revision = "other-revision";
  assert.throws(() => validatePrivateData(mixed));
  Object.assign(input.profiles[0].snapshot, { apiKey: "not-a-snapshot-field" });
  assert.throws(() => validatePrivateData(input));
});

test("observed demo profiles may include original API excerpts only when they reproduce their snapshot", () => {
  const input = observedPack();
  const original = structuredClone(input);
  const result = validatePrivateData(input);
  assert.equal(result.kind, "observability-replay-demo");
  if (result.kind !== "observability-replay-demo") assert.fail("API demo lost its origin");
  assert.deepEqual(result.profiles[0].evidence, input.profiles[0].evidence);
  assert.deepEqual(input, original);
  const missing = structuredClone(input);
  delete (missing.profiles[0] as Partial<typeof missing.profiles[0]>).evidence;
  const old = validatePrivateData(missing);
  assert.equal(old.kind, "observability-replay-demo");
  if (old.kind !== "observability-replay-demo") assert.fail("legacy observed profile lost its origin");
  assert.ok(!Object.hasOwn(old.profiles[0], "evidence"));
  input.profiles[0].snapshot.points[1].replay = .49;
  assert.throws(() => validatePrivateData(input));
});

test("evidence cannot cross the authored, Query-only or top-level private-data boundaries", () => {
  const evidence = observedPack().profiles[0].evidence;
  const synthetic = pack();
  Object.assign(synthetic.profiles[0], { evidence });
  assert.throws(() => validatePrivateData(synthetic));
  assert.throws(() => validatePrivateData({ ...query(), evidence }));
  assert.throws(() => validatePrivateData({ ...observedPack(), evidence }));
  const invalid = observedPack();
  Object.assign(invalid.profiles[0].evidence.sessions[0].response.data.result[0], { user_id: "must-not-be-forwarded" });
  assert.throws(() => validatePrivateData(invalid));
});

test("private scenarios require explicit versions, bounded unique profiles and translated titles", () => {
  for (const value of [null, undefined, [], 0, "pack"]) assert.throws(() => validatePrivateData(value));
  for (const key of Object.keys(pack())) {
    const input: Record<string, unknown> = pack();
    delete input[key];
    assert.throws(() => validatePrivateData(input), key);
  }
  for (const mutation of [
    (input: ReturnType<typeof pack>) => { input.schemaVersion = 2; },
    (input: ReturnType<typeof pack>) => { input.kind = "real-live"; },
    (input: ReturnType<typeof pack>) => { input.profiles = []; },
    (input: ReturnType<typeof pack>) => { input.profiles = Array.from({ length: 6 }, (_, index) => ({ ...input.profiles[0], id: "profile-" + index })); },
    (input: ReturnType<typeof pack>) => { input.profiles[1].id = input.profiles[0].id; },
    (input: ReturnType<typeof pack>) => { input.profiles[0].id = "../profile"; },
    (input: ReturnType<typeof pack>) => { input.profiles[0].title.en = " ".repeat(2); },
    (input: ReturnType<typeof pack>) => { input.profiles[0].title.ja = "a".repeat(121); },
    (input: ReturnType<typeof pack>) => { delete (input.profiles[0].title as Partial<{ en: string }>).en; },
  ]) {
    const input = pack();
    mutation(input);
    assert.throws(() => validatePrivateData(input));
  }
});

test("all scenario profiles describe the same video revision and observation period", () => {
  for (const mutation of [
    (value: EngagementSnapshot) => { value.content.id = "other"; },
    (value: EngagementSnapshot) => { value.content.revision = "other"; },
    (value: EngagementSnapshot) => { value.content.durationMs = 5_000; value.points[2].endMs = 5_000; },
    (value: EngagementSnapshot) => { value.period.start = "2025-12-31T00:00:00.000Z"; },
    (value: EngagementSnapshot) => { value.period.end = "2026-01-01T23:00:00.000Z"; },
    (value: EngagementSnapshot) => { value.generatedAt = "2026-01-02T01:00:00.000Z"; },
  ]) {
    const input = pack();
    mutation(input.profiles[1].snapshot);
    assert.throws(() => validatePrivateData(input));
  }
});

test("scenario snapshots cannot relabel real data or bypass existing coverage validation", () => {
  for (const mutation of [
    (value: Record<string, unknown>) => { value.synthetic = false; },
    (value: Record<string, unknown>) => { value.metricVersion = "watched-impression-incidence-v1"; },
    (value: Record<string, unknown>) => { value.sessionCount = 0; },
    (value: Record<string, unknown>) => { value.suggestedMode = "reach"; },
    (value: Record<string, unknown>) => { value.points = []; },
  ]) {
    const input = pack();
    mutation(input.profiles[0].snapshot as unknown as Record<string, unknown>);
    assert.throws(() => validatePrivateData(input));
  }
  assert.throws(() => validatePrivateData({ ...query(), kind: "synthetic-live-demo" }));
});

test("private scenario boundaries reject credentials and unrelated identifying fields", () => {
  for (const select of [
    (input: ReturnType<typeof pack>) => input,
    (input: ReturnType<typeof pack>) => input.source,
    (input: ReturnType<typeof pack>) => input.profiles[0],
    (input: ReturnType<typeof pack>) => input.profiles[0].title,
    (input: ReturnType<typeof pack>) => input.profiles[0].snapshot,
    (input: ReturnType<typeof pack>) => input.profiles[0].snapshot.content,
    (input: ReturnType<typeof pack>) => input.profiles[0].snapshot.period,
    (input: ReturnType<typeof pack>) => input.profiles[0].snapshot.points[0],
  ]) {
    const input = pack();
    Object.assign(select(input), { userId: "not-a-demo-field" });
    assert.throws(() => validatePrivateData(input));
  }
  for (const hls of ["https://user:password@example.com/master.m3u8", "http://example.com/master.m3u8", "/__private/media/other.m3u8", "/__private/media/master.m3u8?key=x"]) {
    const input = pack();
    input.source.hls = hls;
    assert.throws(() => validatePrivateData(input));
  }
  const remote = pack();
  remote.source.hls = "https://example.com/master.m3u8";
  assert.equal(validatePrivateData(remote).source.hls, remote.source.hls);
});
