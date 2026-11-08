import type { DemoEngineId, SafeValue } from "../contract";

export type PreparationPolicy = "on-demand" | "metadata" | "segments" | "decoded";
export interface UseCaseSource {
  readonly id: string;
  readonly url: string;
  readonly format: "hls" | "dash";
  readonly startTimeSeconds: number;
}
export interface UseCaseDriverOptions {
  readonly container: HTMLElement;
  readonly licenseKey: string;
  readonly policy: PreparationPolicy;
  readonly bufferSeconds: number;
  /** Optional public hls.js worker setting; other drivers ignore it. */
  readonly workerEnabled?: boolean;
  /** hls.js metadata preparation can parse a manifest before media attachment. */
  readonly hlsMetadataDetached?: boolean;
  readonly signal: AbortSignal;
  readonly event: (name: "source-created" | "metadata" | "prepared" | "error", sourceId: string) => void;
}
export interface UseCaseSourceState {
  readonly video: HTMLVideoElement | null;
  /** Null means no supported observation, not an empty buffer. */
  readonly bufferSeconds: number | null;
  readonly readyState: number | null;
}
export interface UseCaseDriver {
  readonly engine: DemoEngineId;
  readonly supportedPolicies: readonly PreparationPolicy[];
  /** Explicit public settings only: exclude keys, URLs and provider objects. */
  readonly configuration: Readonly<Record<string, SafeValue>>;
  /** Register/prepare a source; never request foreground playback here. */
  prepare(source: UseCaseSource): Promise<void>;
  /** Observe the owned video before attachment or playback can advance it. */
  activate(sourceId: string, observeVideo: (video: HTMLVideoElement) => void): Promise<HTMLVideoElement>;
  state(sourceId: string): UseCaseSourceState;
  remove(sourceId: string): Promise<void>;
  dispose(): Promise<void>;
}
export type CreateUseCaseDriver = (options: UseCaseDriverOptions) => Promise<UseCaseDriver>;

export function observedBuffer(video: HTMLVideoElement): number {
  for (let index = 0; index < video.buffered.length; index++) {
    if (video.currentTime >= video.buffered.start(index) && video.currentTime <= video.buffered.end(index)) {
      return Math.max(0, video.buffered.end(index) - video.currentTime);
    }
  }
  return 0;
}
