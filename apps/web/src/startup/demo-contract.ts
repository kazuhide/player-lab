import type { AdapterMetadata, EngineId, FailureCode, StartupProfile, StartupTuning } from "./contract";
import type { BrowserMarks } from "./runner";
import type { DemoNetworkStatus } from "./demo-network";

export type { DemoNetworkStatus } from "./demo-network";
export interface DemoSource {
  readonly url: string;
  readonly format: "hls" | "dash";
  readonly label: string;
  readonly custom: boolean;
}
export interface DemoSample {
  readonly elapsedMs: number;
  readonly mediaTime: number;
  readonly width: number;
  readonly height: number;
  readonly bufferSeconds: number;
  readonly stalled: boolean;
  readonly paused: boolean;
  readonly droppedFrames: number | null;
  readonly durationSeconds: number | null;
  readonly seekableStart: number | null;
  readonly seekableEnd: number | null;
  readonly network?: DemoNetworkStatus;
}
export interface DemoStartup {
  readonly status: "success" | "failure" | "cancelled";
  readonly failureCode: FailureCode | null;
  readonly sdkCode: number | null;
  readonly marks: BrowserMarks;
  readonly metadata: AdapterMetadata | null;
  readonly frameCallbackAvailable: boolean;
}
export interface DemoSeek {
  readonly status: "success" | "failure" | "cancelled";
  readonly failureCode: FailureCode | null;
  readonly latencyMs: number | null;
  readonly targetSeconds: number;
  readonly buffered: boolean;
  readonly frameCallbackAvailable: boolean;
}
export interface DemoStartOptions {
  readonly source: DemoSource;
  readonly signal: AbortSignal;
  readonly profile?: StartupProfile;
  readonly tuning?: StartupTuning;
  readonly selectedAt?: number;
}
export interface DemoOptions {
  readonly engine: EngineId;
  readonly container: HTMLElement;
  readonly onSample?: (sample: DemoSample) => void;
}
export const DEMO_STARTUP_TIMEOUT_MS = 30_000;
export const DEMO_SEEK_TIMEOUT_MS = 10_000;
export const DEMO_CLEANUP_TIMEOUT_MS = 5_000;
export const DEMO_SAMPLE_INTERVAL_MS = 250;
export const MAX_DEMO_SAMPLES = 600;

/** URL and labels are runner input only, never measurement or error fields. */
export function parseDemoSource(value: unknown, base: string): DemoSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("configuration-rejected");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !["url", "format", "label", "custom"].includes(key))
    || typeof source.url !== "string" || source.url.length > 4096
    || (source.format !== "hls" && source.format !== "dash")
    || typeof source.label !== "string" || Array.from(source.label).length > 120
    || typeof source.custom !== "boolean") throw new Error("configuration-rejected");
  let url: URL;
  try { url = new URL(source.url, base); } catch { throw new Error("configuration-rejected"); }
  const origin = new URL(base);
  if (url.username || url.password || url.hash
    || (url.protocol !== "https:" && !(origin.protocol === "http:" && url.origin === origin.origin))) {
    throw new Error("configuration-rejected");
  }
  return { url: url.href, format: source.format, label: source.label, custom: source.custom };
}
