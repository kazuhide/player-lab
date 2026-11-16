import assert from "node:assert/strict";
import test from "node:test";
import { chapterProgress, deriveViewerHistory, selectHighlights, type ViewerCatalog, type ViewerHistoryInput, type ViewerHistorySample, type ViewerSection } from "../src/viewer-data.ts";
import { VIEWER_CATALOG, VIEWER_HISTORY_EXAMPLES } from "../src/viewer-fixtures.ts";
import type { EngagementSnapshot, TimelineSnapshot } from "../src/types.ts";

const content = { id: "example", revision: "v1", durationMs: 6_000 };
const period = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" };
const sourceUrl = "https://example.com/master.m3u8";
function section(id: string, startMs: number, endMs: number): ViewerSection {
  return { id, title: { en: id, ja: id }, startMs, endMs };
}
function catalog(): ViewerCatalog {
  return { content: { ...content }, chapters: [section("a", 0, 2_000), section("b", 2_000, 4_000), section("c", 4_000, 6_000)],
    clips: [section("late", 4_000, 6_000), section("early", 0, 2_000), section("overlap", 1_000, 3_000)] };
}
function snapshot(): EngagementSnapshot {
  return { schemaVersion: 1, metricVersion: "replay-coverage-v1", synthetic: true, content: { ...content }, period: { ...period }, generatedAt: period.end,
    sessionCount: 4, bucketWidthMs: 2_000, suggestedMode: "replay", points: [
      { startMs: 0, endMs: 2_000, support: 4, reach: 1, replay: .6 },
      { startMs: 2_000, endMs: 4_000, support: 2, reach: .5, replay: .2 },
      { startMs: 4_000, endMs: 6_000, support: 4, reach: 1, replay: .8 },
    ] };
}
function row(sequence_number: number, state: string, start: number, end: number, extra: Partial<ViewerHistorySample> = {}): ViewerHistorySample {
  return { sequence_number, client_time: Date.parse(period.start) + (sequence_number + 1) * 10_000, state, ad: 0,
    played: state === "playing" ? Math.max(0, end - start) : 0, seeked: state === "seeking" ? 100 : 0,
    videotime_start: start, videotime_end: end, video_duration: content.durationMs, video_id: content.id, m3u8_url: sourceUrl, ...extra };
}
function history(...samples: ViewerHistorySample[][]): ViewerHistoryInput {
  return { schemaVersion: 1, synthetic: true, content: { ...content }, period: { ...period }, asOf: period.end,
    completeness: "complete", videoId: content.id, sourceUrl,
    sessions: samples.map((samples, index) => ({ id: "example-visit-" + index, expectedLastSequence: Math.max(...samples.map(sample => sample.sequence_number)), samples })) };
}

test("highlight scores use exact bucket overlap, enforce the budget and return content order", () => {
  const original = snapshot();
  const result = selectHighlights(original, catalog(), 4_000);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.items.map(item => item.id), ["early", "late"]);
  assert.equal(result.totalMs, 4_000);
  assert.equal(result.scores.find(score => score.id === "overlap")?.score, .4);
  assert.equal(result.scores.find(score => score.id === "overlap")?.decision, "overlap");
  assert.deepEqual(original, snapshot());
  assert.deepEqual(selectHighlights(snapshot(), catalog(), 2_000).items.map(item => item.id), ["late"]);
  assert.equal(selectHighlights(snapshot(), catalog(), 1_000).totalMs, 0);
});

test("unknown, zero replay, Query-only and mismatched content cannot become highlights", () => {
  const unknown = snapshot(); unknown.points[2] = { ...unknown.points[2], reach: null, replay: null, support: 0 };
  assert.equal(selectHighlights(unknown, catalog()).scores[0].decision, "unknown");
  const zero = snapshot(); zero.points.forEach(point => { point.replay = 0; }); zero.suggestedMode = "reach";
  assert.equal(selectHighlights(zero, catalog()).status, "empty");
  assert.equal(selectHighlights(null, catalog()).status, "unavailable");
  assert.equal(selectHighlights({ ...snapshot(), content: { ...content, revision: "other" } }, catalog()).status, "mismatch");
  const query = { ...snapshot(), synthetic: false, metricVersion: "watched-impression-incidence-v1", points: snapshot().points.map(point => ({ ...point, replay: null })) } as unknown as TimelineSnapshot;
  assert.equal(selectHighlights(query, catalog()).status, "unavailable");
});

test("catalogs and budgets reject duplicates, invalid ranges and unsupported metadata", () => {
  for (const mutate of [
    (value: ViewerCatalog) => { value.clips.push(structuredClone(value.clips[0])); },
    (value: ViewerCatalog) => { value.chapters[0].startMs = -1; },
    (value: ViewerCatalog) => { value.clips[0].endMs = 6_001; },
    (value: ViewerCatalog) => { value.clips[0].startMs = value.clips[0].endMs; },
    (value: ViewerCatalog) => { value.clips[0].title.en = " "; },
  ]) { const value = catalog(); mutate(value); assert.throws(() => selectHighlights(snapshot(), value)); }
  for (const budget of [-1, 1.5, Number.NaN, Infinity]) assert.throws(() => selectHighlights(snapshot(), catalog(), budget));
  assert.equal(selectHighlights(snapshot(), catalog(), 0).totalMs, 0);
});

test("saved history unions canonical played ranges and resumes at the latest valid endpoint, not the maximum", () => {
  const value = history([row(0, "playing", 0, 5_000), row(1, "pause", 5_000, 5_000),
    row(2, "seeking", 5_000, 1_000), row(3, "playing", 1_000, 2_000)]);
  const original = structuredClone(value);
  const result = deriveViewerHistory(value);
  assert.deepEqual(result.watchedRanges, [[0, 5_000]]);
  assert.deepEqual(result.unwatchedRanges, [[5_000, 6_000]]);
  assert.equal(result.watchedMs, 5_000);
  assert.equal(result.resumeMs, 2_000);
  assert.equal(result.status, "in-progress");
  assert.deepEqual(value, original);
  assert.deepEqual(chapterProgress(result, catalog()).map(chapter => [chapter.status, chapter.watchedMs, chapter.nextUnwatchedMs]),
    [["watched", 2_000, null], ["watched", 2_000, null], ["partial", 1_000, 5_000]]);
});

test("forward seeks and ambiguous interrupted playing packets never fill personal history gaps", () => {
  const result = deriveViewerHistory(history([row(0, "playing", 0, 1_000), row(1, "pause", 1_000, 1_000),
    row(2, "playing", 1_000, 4_000, { played: 200 }), row(3, "seeking", 4_000, 4_010), row(4, "playing", 4_010, 5_000)]));
  assert.deepEqual(result.watchedRanges, [[0, 1_000], [4_010, 5_000]]);
  assert.deepEqual(result.unwatchedRanges, [[1_000, 4_010], [5_000, 6_000]]);
  assert.equal(result.resumeMs, 5_000);
});

test("history retries deduplicate, visits union, and missing or conflicting sequence receipts fail", () => {
  const value = history([row(0, "playing", 0, 2_000)], [row(0, "playing", 1_000, 4_000, { client_time: Date.parse(period.start) + 50_000 })]);
  value.sessions[0].samples.push(structuredClone(value.sessions[0].samples[0]));
  assert.deepEqual(deriveViewerHistory(value).watchedRanges, [[0, 4_000]]);
  for (const mutate of [
    (value: ViewerHistoryInput) => { value.sessions[0].expectedLastSequence = 1; },
    (value: ViewerHistoryInput) => { value.sessions[0].samples[1].played = 500; },
    (value: ViewerHistoryInput) => { value.sessions[1].id = value.sessions[0].id; },
  ]) { const invalid = structuredClone(value); mutate(invalid); assert.throws(() => deriveViewerHistory(invalid)); }
});

test("partial and unavailable history preserve unknown sections while complete empty and completed histories remain distinct", () => {
  const partial = deriveViewerHistory({ ...history([row(0, "playing", 0, 2_000)]), completeness: "partial" });
  assert.equal(partial.status, "partial");
  assert.equal(partial.unwatchedRanges, null);
  assert.deepEqual(chapterProgress(partial, catalog()).map(chapter => chapter.status), ["watched", "unknown", "unknown"]);
  assert.ok(chapterProgress(partial, catalog()).every(chapter => chapter.nextUnwatchedMs === null));
  const empty = deriveViewerHistory(history());
  assert.equal(empty.status, "empty"); assert.equal(empty.resumeMs, null);
  assert.deepEqual(empty.unwatchedRanges, [[0, 6_000]]);
  const unavailable = deriveViewerHistory({ ...history(), completeness: "unavailable" });
  assert.equal(unavailable.status, "unavailable"); assert.equal(unavailable.unwatchedRanges, null);
  assert.equal(deriveViewerHistory(history([row(0, "playing", 0, 6_000)])).status, "completed");
  assert.deepEqual(chapterProgress(empty, { ...catalog(), content: { ...content, revision: "other" } }), []);
});

test("latest non-ad settings preserve captions off and missing fields without inferring browser preferences", () => {
  const result = deriveViewerHistory(history([row(0, "playing", 0, 2_000, { audio_language: "en", subtitle_enabled: true, subtitle_language: "ja" }),
    row(1, "pause", 2_000, 2_000, { audio_language: "en", subtitle_enabled: false, subtitle_language: null }),
    row(2, "playing", 0, 1_000, { ad: 2, audio_language: "fr", subtitle_enabled: true, subtitle_language: "fr" })]));
  assert.deepEqual(result.preferences, { audioLanguage: "en", subtitleEnabled: false, subtitleLanguage: null });
  assert.deepEqual(result.watchedRanges, [[0, 2_000]]);
  assert.equal(result.resumeMs, 2_000);
  const unknown = deriveViewerHistory(history([row(0, "playing", 0, 2_000)]));
  assert.deepEqual(unknown.preferences, { audioLanguage: null, subtitleEnabled: null, subtitleLanguage: null });
});

test("ad packets between content samples do not leave sequence gaps or change the original receipts", () => {
  const value = history([row(0, "playing", 0, 2_000), row(1, "playing", 0, 1_000, { ad: 1 }), row(2, "playing", 2_000, 4_000)]);
  const original = structuredClone(value);
  assert.deepEqual(deriveViewerHistory(value).watchedRanges, [[0, 4_000]]);
  assert.equal(deriveViewerHistory(value).resumeMs, 4_000);
  assert.deepEqual(value, original);
  assert.deepEqual(value.sessions[0].samples.map(sample => sample.sequence_number), [0, 1, 2]);
});

test("equal client clocks across visits cannot invent the latest resume or setting", () => {
  const value = history([row(0, "playing", 0, 2_000, { subtitle_enabled: false })], [row(0, "playing", 0, 4_000, { subtitle_enabled: true, subtitle_language: "ja" })]);
  const result = deriveViewerHistory(value);
  assert.equal(result.resumeMs, null);
  assert.deepEqual(result.preferences, { audioLanguage: null, subtitleEnabled: null, subtitleLanguage: null });
  assert.deepEqual(result.watchedRanges, [[0, 4_000]]);
});

test("history inputs reject invalid bounds, unsupported fields, metadata and ambiguous setting types", () => {
  for (const mutate of [
    (value: ViewerHistoryInput) => { value.content.durationMs = -1; },
    (value: ViewerHistoryInput) => { value.asOf = period.start; },
    (value: ViewerHistoryInput) => { value.sessions[0].samples[0].videotime_end = 6_001; },
    (value: ViewerHistoryInput) => { value.sessions[0].samples[0].video_id = "another"; },
    (value: ViewerHistoryInput) => { Object.assign(value.sessions[0].samples[0], { subtitle_enabled: "false" }); },
    (value: ViewerHistoryInput) => { Object.assign(value, { custom_user_id: "not-a-browser-field" }); },
    (value: ViewerHistoryInput) => { Object.assign(value.sessions[0].samples[0], { language: "ja" }); },
  ]) { const value = history([row(0, "playing", 0, 2_000)]); mutate(value); assert.throws(() => deriveViewerHistory(value)); }
});

test("public examples use matching content, isolated synthetic inputs and reproducible empty/settings states", () => {
  assert.equal(VIEWER_CATALOG.content.id, "bbb-60s");
  assert.equal(VIEWER_CATALOG.content.revision, "bbb-60s-demo-v1");
  assert.equal(VIEWER_CATALOG.content.durationMs, 60_000);
  assert.equal(new Set(VIEWER_HISTORY_EXAMPLES.map(example => example.id)).size, VIEWER_HISTORY_EXAMPLES.length);
  for (const example of VIEWER_HISTORY_EXAMPLES) {
    assert.equal(example.input.synthetic, true);
    assert.deepEqual(example.input.content, VIEWER_CATALOG.content);
    assert.ok(example.title.en && example.title.ja);
    assert.doesNotThrow(() => deriveViewerHistory(example.input));
  }
  const find = (id: string) => deriveViewerHistory(VIEWER_HISTORY_EXAMPLES.find(example => example.id === id)!.input);
  assert.equal(find("first").status, "empty");
  assert.equal(find("completed").status, "completed");
  assert.equal(find("captions-off").preferences.subtitleEnabled, false);
  assert.equal(find("unknown-settings").preferences.subtitleEnabled, null);
});
