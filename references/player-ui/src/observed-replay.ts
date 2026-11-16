import { validateBucketWidth, validateContent, validateObservedReplaySnapshot, validatePeriod } from "./snapshot.ts";
import type { DemoContent, ObservedReplaySnapshot } from "./types.ts";

/** An allowlisted projection of one collected Observability sample, without personal metadata. */
export interface ObservedSample {
  sequenceNumber: number;
  clientTime: number;
  state: string;
  ad: number;
  played: number;
  seeked: number;
  videotimeStart: number;
  videotimeEnd: number;
  videoDuration: number;
  videoId: string;
  sourceUrl: string;
}
export interface ObservedReplayInput {
  content: DemoContent;
  period: { start: string; end: string };
  videoId: string;
  sourceUrl: string;
  /** Independently measured media-element duration, rounded down to integer milliseconds. */
  mediaDurationMs?: number;
  sessions: { id: string; expectedLastSequence: number; samples: ObservedSample[] }[];
}
export type Interval = [start: number, end: number];
export type ObservedSampleReason = "played" | "seek-backward" | "seek-forward" | "ambiguous-before-seek" | "carried-seek-target" | "not-playing" | "no-played-range";
export interface ObservedSampleTrace {
  sequenceNumber: number;
  /** Zero-based pass; a backward seek belongs to the new target pass. */
  passIndex: number;
  reason: ObservedSampleReason;
  countedRange: Interval | null;
  seekOriginMs: number | null;
  seekTargetMs: number | null;
}
export interface ObservedReplayRecordTrace {
  id: string;
  /** Complete, deduplicated sequence order. */
  samples: ObservedSampleTrace[];
  /** Counted fragments grouped by pass, before their within-pass union. */
  passes: Interval[][];
  reach: Interval[];
  replay: Interval[];
}
export interface ObservedReplayInspection {
  snapshot: ObservedReplaySnapshot;
  /** Includes ineligible startup-only records; use snapshot.sessionCount as the denominator. */
  records: ObservedReplayRecordTrace[];
}
const FIELDS = ["sequenceNumber", "clientTime", "state", "ad", "played", "seeked", "videotimeStart", "videotimeEnd", "videoDuration", "videoId", "sourceUrl"] as const;
// The tested media/API endpoint clocks differ by 5 ms; this is not a general SDK tolerance.
const MAX_TERMINAL_CLOCK_DIFFERENCE_MS = 5;

function object(value: unknown, fields: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error("unsupported observed record fields");
}
function integer(value: unknown, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("observed value is outside its supported range");
}
function text(value: unknown, max: number): void {
  if (typeof value !== "string" || value.length < 1 || value.length > max) throw new Error("invalid observed identity or state");
}

function orderedSamples(session: ObservedReplayInput["sessions"][number], input: ObservedReplayInput, terminalEndLimit: number): ObservedSample[] {
  object(session, ["id", "expectedLastSequence", "samples"]);
  text(session.id, 120);
  integer(session.expectedLastSequence, 0, 99_999);
  if (!Array.isArray(session.samples)) throw new Error("observed samples must be an array");
  const records = new Map<number, ObservedSample>();
  for (const sample of session.samples) {
    object(sample, FIELDS);
    integer(sample.sequenceNumber, 0, session.expectedLastSequence);
    integer(sample.clientTime, Date.parse(input.period.start), Date.parse(input.period.end));
    integer(sample.videotimeStart, 0, input.content.durationMs);
    integer(sample.played, 0, 86_400_000);
    integer(sample.seeked, 0, 86_400_000);
    text(sample.state, 40);
    const terminalPlaying = sample.sequenceNumber === session.expectedLastSequence && sample.state === "playing" && sample.played > 0 && sample.seeked === 0 && sample.videotimeStart < input.content.durationMs;
    integer(sample.videotimeEnd, 0, terminalPlaying ? terminalEndLimit : input.content.durationMs);
    if (sample.ad !== 0 || sample.videoId !== input.videoId || sample.sourceUrl !== input.sourceUrl || sample.videoDuration !== input.content.durationMs) throw new Error("observed content identity or advertising does not match");
    const previous = records.get(sample.sequenceNumber);
    if (previous && FIELDS.some(key => previous[key] !== sample[key])) throw new Error("conflicting observed sequence retry");
    records.set(sample.sequenceNumber, sample);
  }
  if (records.size !== session.expectedLastSequence + 1) throw new Error("observed playback sequence is incomplete");
  const samples = [...records.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  if (samples.some((sample, index) => index > 0 && sample.clientTime < samples[index - 1].clientTime)) throw new Error("observed client clock decreases");
  return samples;
}

function passes(samples: ObservedSample[], duration: number, traces?: ObservedSampleTrace[]): Interval[][] {
  const excluded = new Map<number, "carried-seek-target" | "ambiguous-before-seek">();
  const origins = new Map<number, number>();
  for (let index = 0; index < samples.length; index++) {
    const seek = samples[index];
    if (seek.state !== "seeking") continue;
    let previous = index - 1;
    while (previous >= 0) {
      const sample = samples[previous];
      if (["seeking", "pause", "paused"].includes(sample.state) || sample.played !== 0 || sample.seeked !== 0 || sample.videotimeStart !== sample.videotimeEnd || ![seek.videotimeStart, seek.videotimeEnd].includes(sample.videotimeEnd)) break;
      excluded.set(previous--, "carried-seek-target");
    }
    const interrupted = samples[previous];
    if (interrupted?.state !== "playing") continue;
    const backwards = interrupted.videotimeEnd < interrupted.videotimeStart;
    if (backwards && [seek.videotimeStart, seek.videotimeEnd].includes(interrupted.videotimeEnd)) {
      origins.set(index, interrupted.videotimeStart);
      excluded.set(previous, "ambiguous-before-seek");
    } else if (!backwards && (seek.videotimeEnd >= seek.videotimeStart || interrupted.videotimeEnd === seek.videotimeEnd)) {
      // An interrupted PLAYING end can already contain the seek target; never count that jump.
      excluded.set(previous, "ambiguous-before-seek");
    }
  }
  const result: Interval[][] = [[]];
  let cursor = 0;
  let last: Interval | undefined;
  let target: number | undefined;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const decision: ObservedSampleTrace | undefined = traces ? { sequenceNumber: sample.sequenceNumber, passIndex: result.length - 1,
      reason: "not-playing", countedRange: null, seekOriginMs: null, seekTargetMs: null } : undefined;
    const excludedReason = excluded.get(index);
    if (excludedReason) {
      if (decision) { decision.reason = excludedReason; traces!.push(decision); }
      continue;
    }
    const [start, end] = [sample.videotimeStart, sample.videotimeEnd];
    if (sample.state === "seeking") {
      const origin = origins.get(index) ?? start;
      if (sample.played !== 0 || origin < cursor) throw new Error("seek origin contradicts the observed content clock");
      if (end < origin) result.push([]);
      target = end;
      cursor = end;
      last = undefined;
      if (decision) {
        decision.passIndex = result.length - 1;
        decision.reason = end < origin ? "seek-backward" : "seek-forward";
        decision.seekOriginMs = origin;
        decision.seekTargetMs = end;
        traces!.push(decision);
      }
      continue;
    }
    if (end < start || end < cursor) throw new Error("backwards content clock requires an explicit seek");
    if (sample.state === "playing" && sample.played > 0 && sample.seeked === 0 && end > start) {
      if ((target !== undefined && start < target) || (last && (start < last[0] || end < last[1]))) throw new Error("playing range contradicts the observed content clock");
      result.at(-1)!.push([start, Math.min(end, duration)]);
      last = [start, end];
      target = undefined;
      if (decision) { decision.reason = "played"; decision.countedRange = [start, Math.min(end, duration)]; }
    } else if (decision && sample.state === "playing") {
      decision.reason = "no-played-range";
    }
    cursor = end;
    if (decision) traces!.push(decision);
  }
  if (result.every(pass => pass.length === 0) && samples.some(sample => sample.state === "playing" && sample.played > 0 && sample.videotimeEnd !== sample.videotimeStart)) throw new Error("observed playing ranges are entirely ambiguous");
  return result;
}

function merged(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of intervals.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
function coverage(playbackPasses: Interval[][]): { reach: Interval[]; replay: Interval[] } {
  const changes = new Map<number, number>();
  for (const pass of playbackPasses) for (const [start, end] of merged(pass)) {
    changes.set(start, (changes.get(start) ?? 0) + 1);
    changes.set(end, (changes.get(end) ?? 0) - 1);
  }
  const reach: Interval[] = [];
  const replay: Interval[] = [];
  let previous = 0;
  let active = 0;
  for (const [position, delta] of [...changes].sort((a, b) => a[0] - b[0])) {
    if (position > previous && active > 0) reach.push([previous, position]);
    if (position > previous && active > 1) replay.push([previous, position]);
    active += delta;
    previous = position;
  }
  return { reach: merged(reach), replay: merged(replay) };
}
function add(intervals: Interval[], values: number[], width: number): void {
  for (const [start, end] of intervals) for (let index = Math.floor(start / width); index < Math.ceil(end / width); index++) {
    values[index] += Math.min(end, (index + 1) * width) - Math.max(start, index * width);
  }
}

function aggregateObservedReplay(input: ObservedReplayInput, bucketWidthMs: number, records?: ObservedReplayRecordTrace[]): ObservedReplaySnapshot {
  object(input, ["content", "period", "videoId", "sourceUrl", "mediaDurationMs", "sessions"]);
  const content = validateContent(input.content);
  const period = validatePeriod(input.period);
  const width = validateBucketWidth(bucketWidthMs, content.durationMs);
  text(input.videoId, 512);
  text(input.sourceUrl, 4_096);
  const terminalEndLimit = input.mediaDurationMs === undefined ? content.durationMs : input.mediaDurationMs;
  integer(terminalEndLimit, content.durationMs, content.durationMs + MAX_TERMINAL_CLOCK_DIFFERENCE_MS);
  if (!Array.isArray(input.sessions) || input.sessions.length > 1_000) throw new Error("observed session count exceeds supported bounds");
  let sampleCount = 0;
  const ids = new Set<string>();
  const count = Math.ceil(content.durationMs / width);
  const reachMs = new Array<number>(count).fill(0);
  const replayMs = new Array<number>(count).fill(0);
  const support = new Array<number>(count).fill(0);
  let sessionCount = 0;
  for (const session of input.sessions) {
    if (!Array.isArray(session?.samples) || (sampleCount += session.samples.length) > 100_000) throw new Error("observed sample count exceeds supported bounds");
    const samples = orderedSamples(session, input, terminalEndLimit);
    if (ids.has(session.id)) throw new Error("duplicate observed playback identity");
    ids.add(session.id);
    const sampleTraces: ObservedSampleTrace[] | undefined = records ? [] : undefined;
    const playbackPasses = passes(samples, content.durationMs, sampleTraces);
    const intervals = coverage(playbackPasses);
    if (records) records.push({ id: session.id, samples: sampleTraces!, passes: playbackPasses, reach: intervals.reach, replay: intervals.replay });
    if (intervals.reach.length === 0) continue;
    sessionCount++;
    const lengths = new Array<number>(count).fill(0);
    add(intervals.reach, lengths, width);
    add(intervals.replay, replayMs, width);
    lengths.forEach((length, index) => { reachMs[index] += length; if (length > 0) support[index]++; });
  }
  const points = reachMs.map((length, index) => {
    const startMs = index * width;
    const endMs = Math.min(startMs + width, content.durationMs);
    const denominator = (endMs - startMs) * sessionCount;
    return { startMs, endMs, reach: support[index] ? length / denominator : null,
      replay: support[index] ? replayMs[index] / denominator : null, support: support[index] };
  });
  return validateObservedReplaySnapshot({ schemaVersion: 1, metricVersion: "observed-replay-coverage-v1", synthetic: false,
    content, period, generatedAt: period.end, sessionCount, bucketWidthMs: width,
    suggestedMode: points.some(point => (point.replay ?? 0) > 0) ? "replay" : sessionCount ? "reach" : "empty", points });
}

/** Only complete, consistently identified non-ad playback records can contribute observed coverage. */
export function computeObservedReplay(input: ObservedReplayInput, bucketWidthMs = 2_000): ObservedReplaySnapshot {
  return aggregateObservedReplay(input, bucketWidthMs);
}

/** Explains the same calculation without allocating traces during ordinary computation. */
export function inspectObservedReplay(input: ObservedReplayInput, bucketWidthMs = 2_000): ObservedReplayInspection {
  const records: ObservedReplayRecordTrace[] = [];
  const snapshot = aggregateObservedReplay(input, bucketWidthMs, records);
  return { snapshot, records };
}
