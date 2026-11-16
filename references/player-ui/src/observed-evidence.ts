import { computeObservedReplay, type ObservedReplayInput } from "./observed-replay.ts";
import { validateSourceURL } from "./query-incidence.ts";
import { validateObservedReplaySnapshot } from "./snapshot.ts";
import type { ObservedReplaySnapshot } from "./types.ts";

/** Original API field names and values; this excerpt intentionally omits all other fields. */
export interface RawObservedSample {
  sequence_number: number;
  client_time: number;
  state: string;
  ad: number;
  played: number;
  seeked: number;
  videotime_start: number;
  videotime_end: number;
  video_duration: number;
  video_id: string;
  m3u8_url: string;
}

export interface ObservedReplayEvidence {
  schemaVersion: 1;
  videoId: string;
  sourceUrl: string;
  mediaDurationMs?: number;
  sessions: {
    id: string;
    /** Final sequence from the collection receipt, independently of the returned samples. */
    expectedLastSequence: number;
    fetchedAt: string;
    response: { status: "SUCCESS"; data: { result: RawObservedSample[] } };
  }[];
}

const RAW_FIELDS = ["sequence_number", "client_time", "state", "ad", "played", "seeked", "videotime_start", "videotime_end", "video_duration", "video_id", "m3u8_url"] as const;

function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("observed evidence must contain objects");
  const result = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error("observed evidence has unsupported or missing fields");
  }
  return result;
}

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("observed evidence fetchedAt must be a UTC timestamp");
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new Error("observed evidence fetchedAt is invalid");
  return result;
}

/** Maps original API values without deriving, rounding, sorting or discarding returned samples. */
export function observedEvidenceInput(evidence: ObservedReplayEvidence, snapshot: ObservedReplaySnapshot): ObservedReplayInput {
  return {
    content: { ...snapshot.content }, period: { ...snapshot.period }, videoId: evidence.videoId, sourceUrl: evidence.sourceUrl,
    ...(evidence.mediaDurationMs === undefined ? {} : { mediaDurationMs: evidence.mediaDurationMs }),
    sessions: evidence.sessions.map(session => ({ id: session.id, expectedLastSequence: session.expectedLastSequence,
      samples: session.response.data.result.map(sample => ({
        sequenceNumber: sample.sequence_number, clientTime: sample.client_time, state: sample.state,
        ad: sample.ad, played: sample.played, seeked: sample.seeked,
        videotimeStart: sample.videotime_start, videotimeEnd: sample.videotime_end,
        videoDuration: sample.video_duration, videoId: sample.video_id, sourceUrl: sample.m3u8_url,
      })),
    })),
  };
}

/** An API label alone is insufficient: the complete excerpts must reproduce the supplied graph. */
export function validateObservedReplayEvidence(value: unknown, snapshot: ObservedReplaySnapshot): ObservedReplayEvidence {
  validateObservedReplaySnapshot(snapshot);
  const evidence = object(value, ["schemaVersion", "videoId", "sourceUrl", "sessions"], ["mediaDurationMs"]);
  if (evidence.schemaVersion !== 1) throw new Error("unsupported observed evidence version");
  validateSourceURL(evidence.sourceUrl);
  if (Object.hasOwn(evidence, "mediaDurationMs") && typeof evidence.mediaDurationMs !== "number") throw new Error("invalid observed evidence media duration");
  if (!Array.isArray(evidence.sessions) || evidence.sessions.length > 1_000) throw new Error("observed evidence session count exceeds supported bounds");
  let sampleCount = 0;
  for (const value of evidence.sessions) {
    const session = object(value, ["id", "expectedLastSequence", "fetchedAt", "response"]);
    const fetchedAt = timestamp(session.fetchedAt);
    const response = object(session.response, ["status", "data"]);
    if (response.status !== "SUCCESS") throw new Error("observed evidence response must be successful");
    const data = object(response.data, ["result"]);
    if (!Array.isArray(data.result) || (sampleCount += data.result.length) > 100_000) throw new Error("observed evidence sample count exceeds supported bounds");
    for (const value of data.result) {
      const sample = object(value, RAW_FIELDS);
      if (typeof sample.client_time === "number" && sample.client_time > fetchedAt) throw new Error("observed evidence was fetched before its samples");
    }
  }
  const result = evidence as unknown as ObservedReplayEvidence;
  const canonical = computeObservedReplay(observedEvidenceInput(result, snapshot), snapshot.bucketWidthMs);
  const fields = ["schemaVersion", "metricVersion", "synthetic", "sessionCount", "bucketWidthMs", "suggestedMode"] as const;
  const contentFields = ["id", "revision", "durationMs"] as const;
  const pointFields = ["startMs", "endMs", "reach", "replay", "support"] as const;
  if (fields.some(key => canonical[key] !== snapshot[key]) ||
    contentFields.some(key => canonical.content[key] !== snapshot.content[key]) ||
    canonical.period.start !== snapshot.period.start || canonical.period.end !== snapshot.period.end ||
    canonical.points.length !== snapshot.points.length ||
    canonical.points.some((point, index) => pointFields.some(key => point[key] !== snapshot.points[index][key]))) {
    throw new Error("observed evidence does not reproduce the snapshot");
  }
  return result;
}
