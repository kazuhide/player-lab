import type { DemoContent, DemoManifest, EngagementSnapshot } from "./types.ts";

const MAX_DURATION_MS = 86_400_000;
const MAX_POINTS = 2_000;

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) throw new Error(`${label} has unsupported fields`);
  return result;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is outside its supported range`);
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

export function validateContent(value: unknown): DemoContent {
  const content = object(value, ["id", "revision", "durationMs"], "content");
  identifier(content.id, "content id");
  identifier(content.revision, "content revision");
  integer(content.durationMs, 1, MAX_DURATION_MS, "content duration");
  return content as unknown as DemoContent;
}

export function validatePeriod(value: unknown): { start: string; end: string } {
  const period = object(value, ["start", "end"], "period");
  const start = timestamp(period.start, "period start");
  const end = timestamp(period.end, "period end");
  if (end <= start || end - start > 366 * MAX_DURATION_MS) throw new Error("period must be ordered and at most one year");
  return period as { start: string; end: string };
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error(`${label} must be a UTC timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} is invalid`);
  return parsed;
}

export function validateBucketWidth(value: unknown, duration: number): number {
  const width = integer(value, 1, MAX_DURATION_MS, "bucket width");
  if (Math.ceil(duration / width) > MAX_POINTS) throw new Error("bucket count exceeds the supported limit");
  return width;
}

export function validateSnapshot(value: unknown): EngagementSnapshot {
  const snapshot = object(value, ["schemaVersion", "metricVersion", "synthetic", "content", "period", "generatedAt", "sessionCount", "bucketWidthMs", "suggestedMode", "points"], "snapshot");
  if (snapshot.schemaVersion !== 1 || snapshot.metricVersion !== "replay-coverage-v1" || snapshot.synthetic !== true) throw new Error("unsupported synthetic snapshot version");
  const content = validateContent(snapshot.content);
  const period = validatePeriod(snapshot.period);
  if (timestamp(snapshot.generatedAt, "generatedAt") < Date.parse(period.end)) throw new Error("generatedAt precedes the sample period");
  const sessionCount = integer(snapshot.sessionCount, 0, 1_000, "session count");
  const width = validateBucketWidth(snapshot.bucketWidthMs, content.durationMs);
  if (!Array.isArray(snapshot.points) || snapshot.points.length !== Math.ceil(content.durationMs / width)) throw new Error("snapshot points must cover the complete content timeline");
  let hasReach = false;
  let hasReplay = false;
  snapshot.points.forEach((value, index) => {
    const point = object(value, ["startMs", "endMs", "replay", "reach", "support"], "point");
    if (point.startMs !== index * width || point.endMs !== Math.min((index + 1) * width, content.durationMs)) throw new Error("snapshot bucket boundaries are inconsistent");
    const support = integer(point.support, 0, sessionCount, "bucket support");
    if (support === 0) {
      if (point.replay !== null || point.reach !== null) throw new Error("unobserved buckets must contain null metrics");
      return;
    }
    if (typeof point.reach !== "number" || !Number.isFinite(point.reach) || point.reach <= 0 || point.reach > support / sessionCount + 1e-12) throw new Error("invalid reach coverage");
    if (typeof point.replay !== "number" || !Number.isFinite(point.replay) || point.replay < 0 || point.replay > point.reach + 1e-12) throw new Error("invalid replay coverage");
    hasReach = true;
    hasReplay ||= point.replay > 0;
  });
  const mode = hasReplay ? "replay" : hasReach ? "reach" : "empty";
  if (snapshot.suggestedMode !== mode || (sessionCount > 0) !== hasReach) throw new Error("snapshot mode or session count contradicts its metrics");
  return snapshot as unknown as EngagementSnapshot;
}

export function validateManifest(value: unknown): DemoManifest {
  const manifest = object(value, ["schemaVersion", "synthetic", "content", "profiles"], "manifest");
  if (manifest.schemaVersion !== 1 || manifest.synthetic !== true) throw new Error("unsupported synthetic manifest version");
  validateContent(manifest.content);
  if (!Array.isArray(manifest.profiles) || manifest.profiles.length < 1 || manifest.profiles.length > 10) throw new Error("invalid manifest profile count");
  const ids = new Set<string>();
  const paths = new Set<string>(["manifest.json"]);
  for (const item of manifest.profiles) {
    const profile = object(item, ["id", "title", "snapshot", "samples"], "profile");
    const id = identifier(profile.id, "profile id");
    if (ids.has(id)) throw new Error("duplicate profile id");
    ids.add(id);
    const title = object(profile.title, ["en", "ja"], "profile title");
    for (const language of ["en", "ja"]) if (typeof title[language] !== "string" || title[language].length < 1 || title[language].length > 120) throw new Error("invalid profile title");
    for (const key of ["snapshot", "samples"]) {
      const path = profile[key];
      if (typeof path !== "string" || !/^[a-z0-9][a-z0-9._/-]*\.json$/.test(path) || path.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error("profile paths must be local JSON data files");
      if (paths.has(path)) throw new Error("profile files must have unique paths");
      paths.add(path);
    }
  }
  return manifest as unknown as DemoManifest;
}
