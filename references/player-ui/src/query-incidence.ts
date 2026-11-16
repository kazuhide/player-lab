import { validateBucketWidth, validateContent, validatePeriod } from "./snapshot.ts";
import type { QueryIncidenceSnapshot } from "./types.ts";

const MAX_COUNT = 1_000_000_000;
const MAX_SOURCE_LENGTH = 8_192;

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    throw new Error(`${label} has unsupported or missing fields`);
  }
  return result;
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) {
    throw new Error(`${label} is outside its supported range`);
  }
  return value;
}

function generationTime(value: unknown, periodEnd: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("generatedAt must be a UTC timestamp");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value || timestamp < Date.parse(periodEnd)) {
    throw new Error("generatedAt must be valid and no earlier than the period end");
  }
  return value;
}

function sourceURL(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SOURCE_LENGTH) {
    throw new Error("source URL is outside its supported size");
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("source URL must be a valid HTTPS address"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("source URL must use HTTPS without embedded credentials");
  }
  return value;
}

/** Validates complete private Query results without changing the synthetic fixture contract. */
export function validatePrivateQueryData(value: unknown): { snapshot: QueryIncidenceSnapshot; source: { hls: string } } {
  const input = object(value, ["schemaVersion", "metricVersion", "complete", "content", "source", "period", "generatedAt", "sessionCount", "bucketWidthMs", "buckets"], "Query data");
  if (input.schemaVersion !== 1 || input.metricVersion !== "watched-impression-incidence-v1" || input.complete !== true) {
    throw new Error("unsupported or incomplete Query data version");
  }
  const content = validateContent(object(input.content, ["id", "revision", "durationMs"], "content"));
  const period = validatePeriod(object(input.period, ["start", "end"], "period"));
  const generatedAt = generationTime(input.generatedAt, period.end);
  const source = object(input.source, ["hls"], "source");
  const hls = sourceURL(source.hls);
  const sessionCount = count(input.sessionCount, "session count");
  const bucketWidthMs = validateBucketWidth(input.bucketWidthMs, content.durationMs);
  if (!Array.isArray(input.buckets) || input.buckets.length !== Math.ceil(content.durationMs / bucketWidthMs)) {
    throw new Error("Query buckets must cover the complete content timeline");
  }
  const points = Array.from(input.buckets, (value, index) => {
    const bucket = object(value, ["startMs", "endMs", "impressions"], "Query bucket");
    const startMs = index * bucketWidthMs;
    const endMs = Math.min(startMs + bucketWidthMs, content.durationMs);
    if (bucket.startMs !== startMs || bucket.endMs !== endMs) throw new Error("Query bucket boundaries are inconsistent");
    const impressions = count(bucket.impressions, "bucket impression count");
    if (impressions > sessionCount) throw new Error("bucket impression count exceeds its population");
    return { startMs, endMs, support: impressions, reach: sessionCount > 0 ? impressions / sessionCount : null, replay: null };
  });
  if (points.reduce((total, point) => total + point.support, 0) < sessionCount) {
    throw new Error("Query intervals do not account for their complete eligible population");
  }
  return {
    snapshot: {
      schemaVersion: 1, metricVersion: "watched-impression-incidence-v1", synthetic: false,
      content: { id: content.id, revision: content.revision, durationMs: content.durationMs },
      period: { start: period.start, end: period.end }, generatedAt, sessionCount, bucketWidthMs, points,
    },
    source: { hls },
  };
}
