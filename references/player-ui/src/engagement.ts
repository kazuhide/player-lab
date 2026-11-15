import { validateBucketWidth, validateContent, validatePeriod, validateSnapshot } from "./snapshot.ts";
import type { AnalyticsSample, DemoExport, EngagementSnapshot } from "./types.ts";

type Interval = [start: number, end: number];
const SAMPLE_FIELDS = ["impressionId", "sequenceNumber", "time", "videoId", "videoDuration", "videotimeStart", "videotimeEnd", "played", "state", "ad", "videoBitrate", "videoPlaybackWidth", "videoPlaybackHeight"] as const;

function safeInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`invalid ${label}`);
  return value;
}

function validateSample(value: unknown, input: DemoExport): AnalyticsSample {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("sample must be an object");
  const sample = value as AnalyticsSample;
  if (Object.keys(sample).some((key) => !SAMPLE_FIELDS.includes(key as typeof SAMPLE_FIELDS[number]))) throw new Error("unsupported sample fields");
  if (typeof sample.impressionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(sample.impressionId)) throw new Error("invalid impression identity");
  if (sample.videoId !== input.content.id) throw new Error("sample content identity does not match");
  if (sample.videoDuration !== input.content.durationMs) throw new Error("sample duration does not match content revision");
  safeInteger(sample.sequenceNumber, 1, 1_000_000, "sample sequence");
  safeInteger(sample.time, Date.parse(input.period.start), Date.parse(input.period.end), "sample time");
  safeInteger(sample.videotimeStart, 0, input.content.durationMs, "sample start");
  safeInteger(sample.videotimeEnd, 0, input.content.durationMs, "sample end");
  safeInteger(sample.played, 0, 86_400_000, "played duration");
  if (typeof sample.state !== "string" || sample.state.length === 0 || sample.state.length > 40) throw new Error("invalid sample state");
  safeInteger(sample.ad, 0, 2, "ad flag");
  if (sample.videotimeEnd < sample.videotimeStart && (sample.state !== "seeking" || sample.played !== 0)) throw new Error("backwards range requires an explicit zero-played seek");
  for (const key of ["videoBitrate", "videoPlaybackWidth", "videoPlaybackHeight"] as const) if (sample[key] !== undefined) safeInteger(sample[key], 0, Number.MAX_SAFE_INTEGER, key);
  return sample;
}

function merged(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of intervals.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

/** Each pass is merged before counting overlap, so rendition changes cannot create replay. */
function coverage(passes: Interval[][]): { reach: Interval[]; replay: Interval[] } {
  const changes = new Map<number, number>();
  for (const pass of passes) for (const [start, end] of merged(pass)) {
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

function addCoverage(intervals: Interval[], target: number[], width: number, duration: number): void {
  for (const [start, end] of intervals) {
    const first = Math.floor(start / width);
    const last = Math.min(target.length - 1, Math.ceil(end / width) - 1);
    for (let index = first; index <= last; index++) target[index] += Math.max(0, Math.min(end, (index + 1) * width, duration) - Math.max(start, index * width));
  }
}

export function computeEngagement(input: DemoExport, bucketWidthMs = 2_000): EngagementSnapshot {
  if (!input || input.schemaVersion !== 1 || input.synthetic !== true) throw new Error("only versioned synthetic demo data is supported");
  if (Object.keys(input).some((key) => !["schemaVersion", "synthetic", "content", "period", "samples"].includes(key))) throw new Error("unsupported export fields");
  const content = validateContent(input.content);
  const period = validatePeriod(input.period);
  const width = validateBucketWidth(bucketWidthMs, content.durationMs);
  if (!Array.isArray(input.samples) || input.samples.length > 100_000) throw new Error("sample count exceeds supported bounds");
  const sessions = new Map<string, Map<number, AnalyticsSample>>();
  for (const value of input.samples) {
    const sample = validateSample(value, input);
    let records = sessions.get(sample.impressionId);
    if (!records) {
      if (sessions.size >= 1_000) throw new Error("session count exceeds supported bounds");
      records = new Map(); sessions.set(sample.impressionId, records);
    }
    const previous = records.get(sample.sequenceNumber);
    if (previous && SAMPLE_FIELDS.some((key) => previous[key] !== sample[key])) throw new Error("conflicting duplicate sample sequence");
    records.set(sample.sequenceNumber, sample);
  }
  const count = Math.ceil(content.durationMs / width);
  const reachMs = new Array<number>(count).fill(0);
  const replayMs = new Array<number>(count).fill(0);
  const support = new Array<number>(count).fill(0);
  let sessionCount = 0;
  for (const records of sessions.values()) {
    const passes: Interval[][] = [[]];
    let lastTime = -Infinity;
    let lastInterval: Interval | undefined;
    let seekTarget: number | undefined;
    for (const sample of [...records.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
      if (sample.time < lastTime) throw new Error("sample wall clock decreases in sequence order");
      lastTime = sample.time;
      if (sample.ad !== 0) continue;
      if (sample.state === "seeking" && sample.played === 0) {
        if (lastInterval && sample.videotimeStart < lastInterval[1]) throw new Error("seek origin contradicts the preceding playback clock");
        if (sample.videotimeEnd < sample.videotimeStart) passes.push([]);
        seekTarget = sample.videotimeEnd;
        lastInterval = undefined;
        continue;
      }
      if (sample.state !== "playing" || sample.played <= 0 || sample.videotimeEnd === sample.videotimeStart) continue;
      const interval: Interval = [sample.videotimeStart, sample.videotimeEnd];
      if (seekTarget !== undefined && interval[0] < seekTarget) throw new Error("playback clock precedes the explicit seek target");
      if (lastInterval && (interval[0] < lastInterval[0] || interval[1] < lastInterval[1])) throw new Error("backwards content clock requires an explicit seek marker");
      passes.at(-1)!.push(interval);
      lastInterval = interval;
      seekTarget = undefined;
    }
    const intervals = coverage(passes);
    if (intervals.reach.length === 0) continue;
    sessionCount++;
    const sessionReach = new Array<number>(count).fill(0);
    addCoverage(intervals.reach, sessionReach, width, content.durationMs);
    addCoverage(intervals.replay, replayMs, width, content.durationMs);
    sessionReach.forEach((value, index) => {
      reachMs[index] += value;
      if (value > 0) support[index]++;
    });
  }
  const points = reachMs.map((length, index) => {
    const startMs = index * width;
    const endMs = Math.min(startMs + width, content.durationMs);
    const denominator = (endMs - startMs) * sessionCount;
    return { startMs, endMs, reach: support[index] ? length / denominator : null,
      replay: support[index] ? replayMs[index] / denominator : null, support: support[index] };
  });
  return validateSnapshot({ schemaVersion: 1, metricVersion: "replay-coverage-v1", synthetic: true,
    content, period, generatedAt: period.end, sessionCount, bucketWidthMs: width,
    suggestedMode: points.some((point) => (point.replay ?? 0) > 0) ? "replay" : sessionCount ? "reach" : "empty", points });
}
