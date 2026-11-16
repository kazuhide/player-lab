import { inspectObservedReplay, type Interval, type ObservedReplayInput } from "./observed-replay.ts";
import type { RawObservedSample } from "./observed-evidence.ts";
import { validateSourceURL } from "./query-incidence.ts";
import { validateContent, validateObservedReplaySnapshot, validatePeriod, validateSnapshot } from "./snapshot.ts";
import type { DemoContent, TimelineSnapshot } from "./types.ts";

export interface ViewerSection { id: string; title: { en: string; ja: string }; startMs: number; endMs: number }
export interface ViewerCatalog { content: DemoContent; chapters: ViewerSection[]; clips: ViewerSection[] }
export interface ViewerPreferences { audioLanguage: string | null; subtitleEnabled: boolean | null; subtitleLanguage: string | null }
export interface HighlightScore {
  id: string; score: number | null; support: number;
  decision: "selected" | "no-replay" | "unknown" | "overlap" | "budget";
}
export interface HighlightQueue {
  items: ViewerSection[]; totalMs: number; status: "ready" | "empty" | "unavailable" | "mismatch"; scores: HighlightScore[];
}
export interface ViewerHistorySample extends RawObservedSample {
  audio_language?: string | null; subtitle_enabled?: boolean | null; subtitle_language?: string | null;
}
/** Backend authorization must already restrict every included visit to the current viewer. */
export interface ViewerHistoryInput {
  schemaVersion: 1; synthetic: boolean; content: DemoContent; period: { start: string; end: string }; asOf: string;
  completeness: "complete" | "partial" | "unavailable"; videoId: string; sourceUrl: string;
  sessions: { id: string; expectedLastSequence: number; samples: ViewerHistorySample[] }[];
}
export interface ViewerHistory {
  content: DemoContent; asOf: string; synthetic: boolean; completeness: ViewerHistoryInput["completeness"];
  watchedRanges: Interval[]; unwatchedRanges: Interval[] | null; watchedMs: number; resumeMs: number | null;
  preferences: ViewerPreferences; status: "empty" | "in-progress" | "completed" | "partial" | "unavailable";
}
export interface ViewerChapterProgress {
  section: ViewerSection; watchedMs: number; status: "watched" | "partial" | "unwatched" | "unknown"; nextUnwatchedMs: number | null;
}
const RAW_FIELDS = ["sequence_number", "client_time", "state", "ad", "played", "seeked", "videotime_start", "videotime_end", "video_duration", "video_id", "m3u8_url"];
const PREFERENCE_FIELDS = ["audio_language", "subtitle_enabled", "subtitle_language"];
const UNKNOWN_PREFERENCES = (): ViewerPreferences => ({ audioLanguage: null, subtitleEnabled: null, subtitleLanguage: null });

function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("viewer data must contain objects");
  const result = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) throw new Error("unsupported or missing viewer fields");
  return result;
}
function integer(value: unknown, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("viewer value is outside supported bounds");
}
function text(value: unknown, max: number): void {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("invalid viewer text");
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("viewer timestamp must use UTC");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error("invalid viewer timestamp");
  return time;
}
function sameContent(a: DemoContent, b: DemoContent): boolean {
  return a.id === b.id && a.revision === b.revision && a.durationMs === b.durationMs;
}
function validateCatalog(catalog: ViewerCatalog): void {
  object(catalog, ["content", "chapters", "clips"]);
  validateContent(object(catalog.content, ["id", "revision", "durationMs"]));
  for (const sections of [catalog.chapters, catalog.clips]) {
    if (!Array.isArray(sections) || sections.length > 100) throw new Error("too many viewer sections");
    const ids = new Set<string>();
    for (const section of sections) {
      object(section, ["id", "title", "startMs", "endMs"]); text(section.id, 120);
      if (ids.has(section.id)) throw new Error("duplicate viewer section");
      ids.add(section.id);
      object(section.title, ["en", "ja"]); text(section.title.en, 120); text(section.title.ja, 120);
      integer(section.startMs, 0, catalog.content.durationMs); integer(section.endMs, section.startMs + 1, catalog.content.durationMs);
    }
  }
}
const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): number => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

/** Scores only authored CMS boundaries; coverage is not a claim about editorial importance. */
export function selectHighlights(snapshot: TimelineSnapshot | null, catalog: ViewerCatalog, budgetMs = 20_000): HighlightQueue {
  validateCatalog(catalog); integer(budgetMs, 0, 86_400_000);
  const result: HighlightQueue = { items: [], totalMs: 0, status: "unavailable", scores: [] };
  if (!snapshot) return result;
  if (!sameContent(snapshot.content, catalog.content)) return { ...result, status: "mismatch" };
  if (snapshot.metricVersion === "watched-impression-incidence-v1") return result;
  if (snapshot.synthetic) validateSnapshot(snapshot); else validateObservedReplaySnapshot(snapshot);
  result.scores = catalog.clips.map(clip => {
    const points = snapshot.points.filter(point => overlap(clip, point) > 0);
    const unknown = points.some(point => point.replay === null || point.support === 0);
    const score = unknown ? null : points.reduce((sum, point) => sum + overlap(clip, point) * point.replay!, 0) / (clip.endMs - clip.startMs);
    return { id: clip.id, score, support: Math.min(...points.map(point => point.support)), decision: score === null ? "unknown" : "no-replay" };
  });
  for (const score of result.scores.filter(score => score.score !== null && score.score > 0)
    .toSorted((a, b) => b.score! - a.score! || catalog.clips.find(clip => clip.id === a.id)!.startMs - catalog.clips.find(clip => clip.id === b.id)!.startMs || a.id.localeCompare(b.id))) {
    const clip = catalog.clips.find(clip => clip.id === score.id)!;
    if (result.items.some(item => overlap(item, clip) > 0)) score.decision = "overlap";
    else if (result.totalMs + clip.endMs - clip.startMs > budgetMs) score.decision = "budget";
    else { result.items.push(clip); result.totalMs += clip.endMs - clip.startMs; score.decision = "selected"; }
  }
  result.items.sort((a, b) => a.startMs - b.startMs);
  result.status = result.items.length ? "ready" : result.scores.some(score => score.score !== null) ? "empty" : "unavailable";
  return result;
}

function union(ranges: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of ranges.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else result.push([start, end]);
  }
  return result;
}
function complement(ranges: Interval[], duration: number): Interval[] {
  const result: Interval[] = [];
  let start = 0;
  for (const [from, to] of ranges) { if (from > start) result.push([start, from]); start = to; }
  if (start < duration) result.push([start, duration]);
  return result;
}
interface TimedValue<T> { time: number; visit: string; sequence: number; value: T }
function latest<T>(values: TimedValue<T>[], fallback: T): T {
  if (!values.length) return fallback;
  const time = Math.max(...values.map(value => value.time));
  const visits = new Map<string, TimedValue<T>>();
  for (const value of values.filter(value => value.time === time)) {
    if (!visits.has(value.visit) || visits.get(value.visit)!.sequence < value.sequence) visits.set(value.visit, value);
  }
  const newest = [...visits.values()];
  // Equal client clocks across visits do not establish a total order.
  return newest.every(value => JSON.stringify(value.value) === JSON.stringify(newest[0].value)) ? newest[0].value : fallback;
}

/** Consumes saved, authorized history; this function does not collect or persist current playback. */
export function deriveViewerHistory(input: ViewerHistoryInput): ViewerHistory {
  object(input, ["schemaVersion", "synthetic", "content", "period", "asOf", "completeness", "videoId", "sourceUrl", "sessions"]);
  if (input.schemaVersion !== 1 || typeof input.synthetic !== "boolean" || !["complete", "partial", "unavailable"].includes(input.completeness)) throw new Error("unsupported viewer history version");
  const content = validateContent(object(input.content, ["id", "revision", "durationMs"]));
  const period = validatePeriod(object(input.period, ["start", "end"]));
  if (timestamp(input.asOf) < Date.parse(period.end)) throw new Error("viewer history predates its reporting period");
  text(input.videoId, 512); validateSourceURL(input.sourceUrl); text(input.sourceUrl, 4_096);
  if (!Array.isArray(input.sessions) || input.sessions.length > 1_000 || (input.completeness === "unavailable" && input.sessions.length > 0)) throw new Error("invalid viewer history visits");
  const projected: ObservedReplayInput["sessions"] = [];
  const originals = new Map<string, ViewerHistorySample[]>();
  const settings: TimedValue<ViewerPreferences>[] = [];
  const resumes: TimedValue<number>[] = [];
  let sampleCount = 0;
  const ids = new Set<string>();
  for (const session of input.sessions) {
    object(session, ["id", "expectedLastSequence", "samples"]); text(session.id, 120); integer(session.expectedLastSequence, 0, 99_999);
    if (ids.has(session.id)) throw new Error("duplicate viewer visit");
    ids.add(session.id);
    if (!Array.isArray(session.samples) || (sampleCount += session.samples.length) > 100_000) throw new Error("too many viewer samples");
    const sequences = new Map<number, ViewerHistorySample>();
    for (const sample of session.samples) {
      object(sample, RAW_FIELDS, PREFERENCE_FIELDS);
      integer(sample.sequence_number, 0, session.expectedLastSequence); integer(sample.client_time, Date.parse(period.start), Date.parse(period.end));
      integer(sample.ad, 0, 2); text(sample.state, 40); text(sample.video_id, 512); text(sample.m3u8_url, 4_096);
      for (const value of [sample.played, sample.seeked, sample.videotime_start, sample.videotime_end, sample.video_duration]) integer(value, 0, 86_400_000);
      for (const key of ["audio_language", "subtitle_language"] as const) if (Object.hasOwn(sample, key) && sample[key] !== null) text(sample[key], 100);
      if (Object.hasOwn(sample, "subtitle_enabled") && sample.subtitle_enabled !== null && typeof sample.subtitle_enabled !== "boolean") throw new Error("subtitle_enabled must be boolean or null");
      const previous = sequences.get(sample.sequence_number);
      if (previous && [...RAW_FIELDS, ...PREFERENCE_FIELDS].some(key => previous[key as keyof ViewerHistorySample] !== sample[key as keyof ViewerHistorySample])) throw new Error("conflicting viewer sample retry");
      sequences.set(sample.sequence_number, sample);
    }
    if (sequences.size !== session.expectedLastSequence + 1) throw new Error("viewer sample sequence is incomplete");
    const ordered = [...sequences.values()].sort((a, b) => a.sequence_number - b.sequence_number);
    if (ordered.some((sample, index) => index > 0 && sample.client_time < ordered[index - 1].client_time)) throw new Error("viewer client clock decreases");
    const samples = ordered.filter(sample => sample.ad === 0);
    if (!samples.length) continue;
    originals.set(session.id, samples);
    // Original receipts are validated above and remain unchanged. These ordinals belong
    // only to the internal non-ad projection consumed by the canonical interval engine.
    projected.push({ id: session.id, expectedLastSequence: samples.length - 1, samples: samples.map((sample, index) => ({
      sequenceNumber: index, clientTime: sample.client_time, state: sample.state, ad: 0, played: sample.played, seeked: sample.seeked,
      videotimeStart: sample.videotime_start, videotimeEnd: sample.videotime_end, videoDuration: sample.video_duration,
      videoId: sample.video_id, sourceUrl: sample.m3u8_url,
    })) });
    for (const sample of samples) if (PREFERENCE_FIELDS.some(key => sample[key as keyof ViewerHistorySample] !== undefined && sample[key as keyof ViewerHistorySample] !== null)) {
      settings.push({ time: sample.client_time, visit: session.id, sequence: sample.sequence_number,
        value: { audioLanguage: sample.audio_language ?? null, subtitleEnabled: sample.subtitle_enabled ?? null, subtitleLanguage: sample.subtitle_language ?? null } });
    }
  }
  const inspection = inspectObservedReplay({ content, period, videoId: input.videoId, sourceUrl: input.sourceUrl, sessions: projected }, Math.max(2_000, Math.ceil(content.durationMs / 2_000)));
  for (const record of inspection.records) for (const trace of record.samples) if (trace.countedRange) {
    const sample = originals.get(record.id)![trace.sequenceNumber];
    resumes.push({ time: sample.client_time, visit: record.id, sequence: sample.sequence_number, value: trace.countedRange[1] });
  }
  // Per-visit ranges come directly from the canonical engine; only their cross-visit union is new.
  const watchedRanges = union(inspection.records.flatMap(record => record.reach));
  const watchedMs = watchedRanges.reduce((sum, [start, end]) => sum + end - start, 0);
  return { content: { ...content }, asOf: input.asOf, synthetic: input.synthetic, completeness: input.completeness,
    watchedRanges, unwatchedRanges: input.completeness === "complete" ? complement(watchedRanges, content.durationMs) : null,
    watchedMs, resumeMs: latest<number | null>(resumes, null), preferences: latest(settings, UNKNOWN_PREFERENCES()),
    status: input.completeness === "unavailable" ? "unavailable" : input.completeness === "partial" ? "partial" : watchedMs === content.durationMs ? "completed" : watchedMs ? "in-progress" : "empty" };
}

export function chapterProgress(history: ViewerHistory, catalog: ViewerCatalog): ViewerChapterProgress[] {
  validateCatalog(catalog);
  if (!sameContent(history.content, catalog.content)) return [];
  return catalog.chapters.map(section => {
    const watchedMs = history.watchedRanges.reduce((sum, [startMs, endMs]) => sum + overlap(section, { startMs, endMs }), 0);
    const next = history.unwatchedRanges?.find(([startMs, endMs]) => overlap(section, { startMs, endMs }) > 0);
    return { section, watchedMs, status: watchedMs === section.endMs - section.startMs ? "watched" : watchedMs ? "partial" : history.completeness === "complete" ? "unwatched" : "unknown",
      nextUnwatchedMs: next ? Math.max(section.startMs, next[0]) : null };
  });
}
