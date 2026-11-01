import type { AdapterMark, EngineId, FailureCode, StartupProfile, StartupTuning } from "./contract";

export const MAX_RESULTS = 3600;
export const MAX_BLOCKS = 120;
const ENGINES = ["web-x", "hls", "shaka"] as const satisfies readonly EngineId[];
export const STARTUP_MARKS = Object.freeze([
  "sdkImportStart", "sdkImportEnd", "constructorStart", "constructorEnd",
  "attachStart", "attachComplete", "loadStart", "loadComplete", "playRequest", "playResolved",
  "sdkReady", "sdkPlaying", "loadedData", "nativePlaying", "firstFrame", "firstMovingFrame", "advanced",
] as const satisfies readonly (AdapterMark | "sdkImportStart" | "sdkImportEnd" | "loadedData" | "nativePlaying" | "firstFrame" | "firstMovingFrame" | "advanced")[]);
export type StartupMark = typeof STARTUP_MARKS[number];
export type ContentId = "bbb-360p" | "bbb-180p";
export type SDKMode = "on-demand" | "preloaded";
export type HTTPCache = "disabled" | "browser-managed" | "unknown";
export type TrialStatus = "success" | "failure" | "cancelled";

const INTERVALS = {
  sdkImportMs: ["sdkImportStart", "sdkImportEnd"],
  constructorMs: ["constructorStart", "constructorEnd"],
  attachMs: ["attachStart", "attachComplete"],
  loadMs: ["loadStart", "loadComplete"],
  playPromiseMs: ["playRequest", "playResolved"],
  selectionToPlayRequestMs: ["selection", "playRequest"],
  selectionToSdkReadyMs: ["selection", "sdkReady"],
  selectionToSdkPlayingMs: ["selection", "sdkPlaying"],
  selectionToLoadedDataMs: ["selection", "loadedData"],
  selectionToNativePlayingMs: ["selection", "nativePlaying"],
  selectionToFirstFrameMs: ["selection", "firstFrame"],
  selectionToFirstMovingFrameMs: ["selection", "firstMovingFrame"],
  selectionToAdvancedMs: ["selection", "advanced"],
  playRequestToNativePlayingMs: ["playRequest", "nativePlaying"],
  playRequestToFirstFrameMs: ["playRequest", "firstFrame"],
  playRequestToFirstMovingFrameMs: ["playRequest", "firstMovingFrame"],
  playRequestToAdvancedMs: ["playRequest", "advanced"],
} as const satisfies Readonly<Record<string, readonly [StartupMark | "selection", StartupMark | "selection"]>>;
export type Metric = keyof typeof INTERVALS;
export const INTERVAL_METRICS: readonly Metric[] = Object.freeze(Object.keys(INTERVALS) as Metric[]);
const REASONS = ["missing-start", "missing-end", "missing-both", "end-before-start"] as const;
export type IntervalReason = typeof REASONS[number];
export type Measurement = { readonly valueMs: number; readonly reason: null }
  | { readonly valueMs: null; readonly reason: IntervalReason };
export type MarkOffsets = Readonly<Record<StartupMark, number | null>>;
export type Intervals = Readonly<Record<Metric, Measurement>>;

export interface TrialContext {
  readonly engine: EngineId;
  readonly version: string;
  readonly contentId: ContentId;
  readonly profile: StartupProfile;
  /** Module residency before selection, independent of HTTP cache state. */
  readonly sdkMode: SDKMode;
  /** disabled requires external control; browser-managed does not establish a warm cache. */
  readonly httpCache: HTTPCache;
  readonly tuning?: StartupTuning;
}
export interface ResultContext extends TrialContext { readonly tuning: Readonly<StartupTuning> }
export interface TrialInput {
  readonly context: TrialContext;
  /** The runner validates actual playback; timestamps alone do not establish success. */
  readonly status: TrialStatus;
  readonly failureCode: FailureCode | null;
  readonly selectionAtMs: number;
  /** Common-clock readings; selectionAtMs=0 also accepts already-relative readings. */
  readonly observedAtMs: Readonly<Partial<Record<StartupMark, number>>>;
}
export interface TrialResult {
  readonly schemaVersion: 1;
  readonly context: ResultContext;
  readonly status: TrialStatus;
  readonly failureCode: FailureCode | null;
  readonly offsetsMs: MarkOffsets;
  readonly intervalsMs: Intervals;
}
export type ModelErrorCode = "invalid-schema" | "invalid-context" | "invalid-outcome"
  | "invalid-mark" | "invalid-duration" | "inconsistent-result" | "too-many-results" | "invalid-order-options";
export class StartupModelError extends Error {
  constructor(readonly code: ModelErrorCode) { super(`Invalid startup measurement (${code}).`); this.name = "StartupModelError"; }
}
const FAILURE_CODES = {
  unsupported: true, "initialization-failed": true, "configuration-rejected": true,
  "load-failed": true, "play-rejected": true, "sdk-error": true, "media-error": true,
  aborted: true, deadline: true, "cleanup-failed": true, "invalid-playback": true,
} as const satisfies Readonly<Record<FailureCode, true>>;
function invalid(code: ModelErrorCode): never { throw new StartupModelError(code); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("invalid-schema");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid("invalid-schema");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], required = allowed) {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key))
      || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) invalid("invalid-schema");
}
function choice<T extends string>(value: unknown, options: readonly T[], code: ModelErrorCode): T {
  if (typeof value !== "string" || !options.includes(value as T)) return invalid(code);
  return value as T;
}
function number(value: unknown, code: ModelErrorCode): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return invalid(code);
  return value === 0 ? 0 : value;
}
function duration(value: unknown): number {
  const result = number(value, "invalid-duration");
  return result < 0 ? invalid("invalid-duration") : result;
}
function version(value: unknown): string {
  if (typeof value !== "string" || value.length > 64
      || !/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value)) return invalid("invalid-context");
  return value;
}
function parseTuning(value: unknown): Readonly<StartupTuning> {
  if (value === undefined) return Object.freeze({});
  const fields = record(value); keys(fields, ["hlsWorker", "shakaPrefetchLimit", "webXLoadControl"], []);
  const result: { hlsWorker?: boolean; shakaPrefetchLimit?: 0 | 1 | 2; webXLoadControl?: 0 | 1 | 2 } = {};
  if (Object.prototype.hasOwnProperty.call(fields, "hlsWorker")) {
    if (typeof fields.hlsWorker !== "boolean") return invalid("invalid-context");
    result.hlsWorker = fields.hlsWorker;
  }
  for (const key of ["shakaPrefetchLimit", "webXLoadControl"] as const) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    const v = fields[key];
    if (v !== 0 && v !== 1 && v !== 2) return invalid("invalid-context");
    result[key] = v;
  }
  return Object.freeze(result);
}
function parseContext(value: unknown): ResultContext {
  const fields = record(value);
  keys(fields, ["engine", "version", "contentId", "profile", "sdkMode", "httpCache", "tuning"],
    ["engine", "version", "contentId", "profile", "sdkMode", "httpCache"]);
  return Object.freeze({
    engine: choice(fields.engine, ENGINES, "invalid-context"), version: version(fields.version),
    contentId: choice(fields.contentId, ["bbb-360p", "bbb-180p"] as const, "invalid-context"),
    profile: choice(fields.profile, ["default", "startup"] as const, "invalid-context"),
    sdkMode: choice(fields.sdkMode, ["on-demand", "preloaded"] as const, "invalid-context"),
    httpCache: choice(fields.httpCache, ["disabled", "browser-managed", "unknown"] as const, "invalid-context"),
    tuning: parseTuning(fields.tuning),
  });
}
export function tuningKey(tuning: StartupTuning): string {
  const t = parseTuning(tuning);
  return `hls=${t.hlsWorker === undefined ? "unset" : t.hlsWorker ? "1" : "0"};shaka=${t.shakaPrefetchLimit ?? "unset"};web-x=${t.webXLoadControl ?? "unset"}`;
}
function cohortKey(context: ResultContext): string {
  return JSON.stringify([context.contentId, context.profile, context.sdkMode, context.httpCache, tuningKey(context.tuning)]);
}
function outcome(status: unknown, failureCode: unknown): { status: TrialStatus; failureCode: FailureCode | null } {
  const result = choice(status, ["success", "failure", "cancelled"] as const, "invalid-outcome");
  if (result === "success") {
    if (failureCode !== null) return invalid("invalid-outcome");
    return { status: result, failureCode: null };
  }
  if (typeof failureCode !== "string" || !Object.prototype.hasOwnProperty.call(FAILURE_CODES, failureCode)) return invalid("invalid-outcome");
  return { status: result, failureCode: failureCode as FailureCode };
}
function offset(value: unknown, mark: StartupMark, mode: SDKMode): number | null {
  if (value === null) return null;
  const result = number(value, "invalid-mark");
  if (result < 0 && (mode !== "preloaded" || (mark !== "sdkImportStart" && mark !== "sdkImportEnd"))) return invalid("invalid-mark");
  return result;
}
function offsetsFrom(value: unknown, mode: SDKMode): MarkOffsets {
  const fields = record(value); keys(fields, STARTUP_MARKS);
  const result = {} as Record<StartupMark, number | null>;
  for (const mark of STARTUP_MARKS) result[mark] = offset(fields[mark], mark, mode);
  return Object.freeze(result);
}
export function measureInterval(start: number | null, end: number | null): Measurement {
  if (start !== null) number(start, "invalid-duration");
  if (end !== null) number(end, "invalid-duration");
  if (start === null || end === null) return Object.freeze({ valueMs: null,
    reason: start === null && end === null ? "missing-both" : start === null ? "missing-start" : "missing-end" });
  if (end < start) return Object.freeze({ valueMs: null, reason: "end-before-start" });
  return Object.freeze({ valueMs: duration(end - start), reason: null });
}
function intervalsFor(offsets: MarkOffsets): Intervals {
  const result = {} as Record<Metric, Measurement>;
  for (const metric of INTERVAL_METRICS) {
    const [start, end] = INTERVALS[metric];
    result[metric] = measureInterval(start === "selection" ? 0 : offsets[start], offsets[end]);
  }
  return Object.freeze(result);
}
export function createTrialResult(input: TrialInput): TrialResult {
  const fields = record(input);
  keys(fields, ["context", "status", "failureCode", "selectionAtMs", "observedAtMs"]);
  const context = parseContext(fields.context);
  const selection = duration(fields.selectionAtMs);
  const observed = record(fields.observedAtMs); keys(observed, STARTUP_MARKS, []);
  const offsets = {} as Record<StartupMark, number | null>;
  for (const mark of STARTUP_MARKS) {
    offsets[mark] = observed[mark] === undefined ? null
      : offset(number(observed[mark], "invalid-mark") - selection, mark, context.sdkMode);
  }
  const offsetsMs = Object.freeze(offsets);
  return Object.freeze({ schemaVersion: 1, context, ...outcome(fields.status, fields.failureCode),
    offsetsMs, intervalsMs: intervalsFor(offsetsMs) });
}
/** Validate exported input and recompute intervals; no arbitrary SDK/user fields survive. */
export function parseTrialResult(value: unknown): TrialResult {
  const fields = record(value);
  keys(fields, ["schemaVersion", "context", "status", "failureCode", "offsetsMs", "intervalsMs"]);
  if (fields.schemaVersion !== 1) return invalid("invalid-schema");
  const context = parseContext(fields.context); const offsetsMs = offsetsFrom(fields.offsetsMs, context.sdkMode);
  const intervalsMs = intervalsFor(offsetsMs); const supplied = record(fields.intervalsMs);
  keys(supplied, INTERVAL_METRICS);
  for (const metric of INTERVAL_METRICS) {
    const item = record(supplied[metric]); keys(item, ["valueMs", "reason"]);
    if (item.valueMs !== null) duration(item.valueMs);
    else choice(item.reason, REASONS, "invalid-duration");
    if (item.valueMs !== intervalsMs[metric].valueMs || item.reason !== intervalsMs[metric].reason) return invalid("inconsistent-result");
  }
  return Object.freeze({ schemaVersion: 1, context, ...outcome(fields.status, fields.failureCode), offsetsMs, intervalsMs });
}

export interface DurationSummary { readonly n: number; readonly medianMs: number | null; readonly p95Ms: number | null }
/** p95 uses nearest rank: ceil(0.95*n), with a one-based rank. */
export function summarizeDurations(values: readonly number[]): DurationSummary {
  if (!Array.isArray(values) || values.length > MAX_RESULTS) return invalid("too-many-results");
  const sorted = Array.from(values, duration).sort((a, b) => a - b); const n = sorted.length;
  if (n === 0) return Object.freeze({ n, medianMs: null, p95Ms: null });
  const lower = sorted[Math.floor((n - 1) / 2)]!; const upper = sorted[Math.floor(n / 2)]!;
  return Object.freeze({ n, medianMs: lower + (upper - lower) / 2, p95Ms: sorted[Math.ceil(0.95 * n) - 1]! });
}
/** n counts successful, nonmissing selected values; outcome/null counts retain every trial. */
export interface GroupSummary extends DurationSummary {
  readonly groupKey: string;
  readonly cohortKey: string;
  readonly context: ResultContext;
  readonly metric: Metric;
  readonly total: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly cancelledCount: number;
  /** Selected-metric null count across all statuses; invalid intervals are a subset. */
  readonly missingCount: number;
  readonly invalidIntervalCount: number;
  readonly missingReasons: Readonly<Partial<Record<IntervalReason, number>>>;
  readonly failureCounts: Readonly<Partial<Record<FailureCode, number>>>;
}
export function summarizeTrials(results: readonly TrialResult[], metric: Metric): readonly GroupSummary[] {
  choice(metric, INTERVAL_METRICS, "invalid-schema");
  if (!Array.isArray(results) || results.length > MAX_RESULTS) return invalid("too-many-results");
  type MutableGroup = { context: ResultContext; cohortKey: string; total: number; successCount: number;
    failureCount: number; cancelledCount: number; missingCount: number; invalidIntervalCount: number;
    missingReasons: Partial<Record<IntervalReason, number>>; failureCounts: Partial<Record<FailureCode, number>>; values: number[] };
  const groups = new Map<string, MutableGroup>();
  for (const raw of results) {
    const result = parseTrialResult(raw); const cohort = cohortKey(result.context);
    const key = JSON.stringify([result.context.engine, result.context.version, cohort]);
    const group = groups.get(key) ?? { context: result.context, cohortKey: cohort, total: 0, successCount: 0,
      failureCount: 0, cancelledCount: 0, missingCount: 0, invalidIntervalCount: 0, missingReasons: {}, failureCounts: {}, values: [] };
    group.total += 1;
    if (result.status === "success") group.successCount += 1;
    else if (result.status === "failure") group.failureCount += 1;
    else group.cancelledCount += 1;
    if (result.failureCode !== null) group.failureCounts[result.failureCode] = (group.failureCounts[result.failureCode] ?? 0) + 1;
    const value = result.intervalsMs[metric];
    if (value.valueMs === null) {
      group.missingCount += 1; group.missingReasons[value.reason] = (group.missingReasons[value.reason] ?? 0) + 1;
      if (value.reason === "end-before-start") group.invalidIntervalCount += 1;
    } else if (result.status === "success") group.values.push(value.valueMs);
    groups.set(key, group);
  }
  return Object.freeze([...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([groupKey, g]) => Object.freeze({
    groupKey, cohortKey: g.cohortKey, context: g.context, metric, total: g.total,
    successCount: g.successCount, failureCount: g.failureCount, cancelledCount: g.cancelledCount,
    missingCount: g.missingCount, invalidIntervalCount: g.invalidIntervalCount,
    missingReasons: Object.freeze({ ...g.missingReasons }), failureCounts: Object.freeze({ ...g.failureCounts }),
    ...summarizeDurations(g.values),
  })));
}
export type ComparisonReason = "requires-all-engines" | "mixed-cohorts" | "mixed-versions"
  | "version-mismatch" | "incomplete" | "insufficient-samples" | "unbalanced";
export type MedianComparison = { readonly kind: "unavailable"; readonly reason: ComparisonReason }
  | { readonly kind: "smallest-median" | "tie"; readonly metric: Metric; readonly cohortKey: string;
      readonly versions: Readonly<Record<EngineId, string>>; readonly engines: readonly EngineId[];
      readonly medianMs: number; readonly nPerEngine: number };
/** A local cohort label, never a claim about globally fastest playback. */
export function compareCohort(results: readonly TrialResult[], metric: Metric,
  expectedVersions: Readonly<Record<EngineId, string>>): MedianComparison {
  const supplied = record(expectedVersions); keys(supplied, ENGINES);
  const versions = Object.freeze({ "web-x": version(supplied["web-x"]), hls: version(supplied.hls), shaka: version(supplied.shaka) });
  const groups = summarizeTrials(results, metric);
  const unavailable = (reason: ComparisonReason): MedianComparison => Object.freeze({ kind: "unavailable", reason });
  if (new Set(groups.map((g) => g.cohortKey)).size > 1) return unavailable("mixed-cohorts");
  if (new Set(groups.map((g) => g.context.engine)).size !== groups.length) return unavailable("mixed-versions");
  if (groups.length !== 3) return unavailable("requires-all-engines");
  if (groups.some((g) => g.context.version !== versions[g.context.engine])) return unavailable("version-mismatch");
  if (groups.some((g) => g.failureCount !== 0 || g.cancelledCount !== 0 || g.missingCount !== 0 || g.n !== g.total)) return unavailable("incomplete");
  if (groups.some((g) => g.n < 5)) return unavailable("insufficient-samples");
  const n = groups[0]!.n;
  if (groups.some((g) => g.n !== n)) return unavailable("unbalanced");
  const minimum = Math.min(...groups.map((g) => g.medianMs!));
  const engines = ENGINES.filter((engine) => groups.some((g) => g.context.engine === engine && g.medianMs === minimum));
  return Object.freeze({ kind: engines.length > 1 ? "tie" : "smallest-median", metric,
    cohortKey: groups[0]!.cohortKey, versions, engines: Object.freeze(engines), medianMs: minimum, nPerEngine: n });
}

export type TrialBlock = readonly [EngineId, EngineId, EngineId];
const PERMUTATIONS: readonly TrialBlock[] = [
  ["web-x", "hls", "shaka"], ["hls", "shaka", "web-x"], ["shaka", "web-x", "hls"],
  ["shaka", "hls", "web-x"], ["hls", "web-x", "shaka"], ["web-x", "shaka", "hls"],
];
/** Returns sequential order data only; it never creates or starts a player. */
export function makeTrialOrder(blockCount: number, seed: number): readonly TrialBlock[] {
  if (!Number.isInteger(blockCount) || blockCount < 1 || blockCount > MAX_BLOCKS
      || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return invalid("invalid-order-options");
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  const blocks: TrialBlock[] = [];
  while (blocks.length < blockCount) {
    const cycle = [...PERMUTATIONS];
    for (let i = cycle.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1)); const value = cycle[i]!;
      cycle[i] = cycle[j]!; cycle[j] = value;
    }
    for (const block of cycle) {
      blocks.push(Object.freeze([block[0], block[1], block[2]]));
      if (blocks.length === blockCount) break;
    }
  }
  return Object.freeze(blocks);
}
