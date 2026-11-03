import { DEMO_SDK_VERSIONS, type DemoEngineId } from "./contract";
import type { BrowserMark, BrowserMarks } from "./runner";
import type { DemoSample, DemoSeek, DemoSource, DemoStartup } from "./demo-session";
import { parseDemoSource } from "./demo-contract";

export const DEMO_ENGINES: readonly DemoEngineId[] = ["web-x", "bitmovin-8", "hls", "shaka"];
export const ENGINE_NAMES: Record<DemoEngineId, string> = {
  "web-x": "Player Web X", "bitmovin-8": "Bitmovin Player 8", hls: "hls.js", shaka: "Shaka Player",
};

const permutations = (remaining: readonly DemoEngineId[]): DemoEngineId[][] => remaining.length === 0 ? [[]]
  : remaining.flatMap((engine, index) => permutations(remaining.filter((_, other) => other !== index))
    .map((tail) => [engine, ...tail]));
const DEMO_ORDERS = permutations(DEMO_ENGINES);

/** A fresh order per cohort; the advanced benchmark's historical schedule is separate. */
export function makeDemoTrialOrder(seed: number): DemoEngineId[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error("invalid-seed");
  return [...DEMO_ORDERS[seed % DEMO_ORDERS.length]!];
}
export interface DemoRecord {
  engine: DemoEngineId;
  startup: DemoStartup | null;
  seek: DemoSeek | null;
  samples: DemoSample[];
  phase: string;
  networkPhases?: { rateBytesPerSecond: number; deliveredBytes: number; controlled: boolean }[];
}

/** URLs stay in memory for playback and never become result labels or exports. */
export function customSource(input: string, format: "hls" | "dash"): DemoSource {
  const url = new URL(input.trim());
  return parseDemoSource({ url: url.href, format, custom: true, label: `Custom ${format.toUpperCase()}` },
    typeof location === "undefined" ? "https://localhost/" : location.href);
}

export function metricDuration(marks: BrowserMarks, start: BrowserMark, end: BrowserMark): number | null {
  const a = marks[start], b = marks[end];
  return typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

/** A target must leave playback room inside the actual seekable window. */
export function seekTarget(sample: Pick<DemoSample, "seekableStart" | "seekableEnd" | "mediaTime">): number | null {
  const { seekableStart: start, seekableEnd: end, mediaTime } = sample;
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 2) return null;
  if (start <= 40 && end >= 43 && Math.abs(mediaTime - 40) >= 1) return 40;
  const target = start + (end - start) * (mediaTime > start + (end - start) / 2 ? 0.3 : 0.7);
  return Math.max(start + 0.5, Math.min(end - 1, target));
}

/** Explicit primitive allowlist; SDK metadata and custom media addresses are private. */
export function safeDemoExport(records: readonly DemoRecord[], format: "hls" | "dash", custom: boolean, network = false) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: { format, kind: custom ? "custom" : "big-buck-bunny",
      renditions: custom ? "source-defined" : network ? "adaptive" : "fixed-360p" },
    method: "sequential-visible-playback",
    cache: "browser-managed",
    trials: records.map((record) => ({
      engine: record.engine, version: DEMO_SDK_VERSIONS[record.engine],
      startup: record.startup ? { status: record.startup.status, failureCode: record.startup.failureCode,
        marks: { ...record.startup.marks }, frameCallbackAvailable: record.startup.frameCallbackAvailable } : null,
      seek: record.seek ? { status: record.seek.status, failureCode: record.seek.failureCode,
        latencyMs: record.seek.latencyMs, targetSeconds: record.seek.targetSeconds, buffered: record.seek.buffered,
        frameCallbackAvailable: record.seek.frameCallbackAvailable } : null,
      samples: record.samples.map(({ elapsedMs, mediaTime, width, height, bufferSeconds, stalled, droppedFrames }) =>
        ({ elapsedMs, mediaTime, width, height, bufferSeconds, stalled, droppedFrames })),
      networkPhases: record.networkPhases?.map(({ rateBytesPerSecond, deliveredBytes, controlled }) =>
        ({ rateBytesPerSecond, deliveredBytes, controlled })) ?? [],
    })),
  };
}
