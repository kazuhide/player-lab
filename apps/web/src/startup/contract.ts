export type EngineId = "web-x" | "hls" | "shaka";
export type StartupProfile = "default" | "startup";

export const SDK_VERSIONS: Readonly<Record<EngineId, string>> = {
  "web-x": "10.3.1",
  hls: "1.7.4",
  shaka: "5.3.3",
};

export type AdapterMark =
  | "constructorStart" | "constructorEnd"
  | "attachStart" | "attachComplete"
  | "loadStart" | "loadComplete"
  | "playRequest" | "playResolved"
  | "sdkReady" | "sdkPlaying";

export type FailureCode =
  | "unsupported" | "initialization-failed" | "configuration-rejected"
  | "load-failed" | "play-rejected" | "sdk-error" | "media-error"
  | "aborted" | "deadline" | "cleanup-failed" | "invalid-playback";

export type SafeValue = null | boolean | number | string
  | readonly SafeValue[] | { readonly [key: string]: SafeValue };

/** Bounded candidates for a separate tuning pass, never inferred from measured rank. */
export interface StartupTuning {
  readonly hlsWorker?: boolean;
  readonly shakaPrefetchLimit?: 0 | 1 | 2;
  readonly webXLoadControl?: 0 | 1 | 2;
}

export interface AdapterMetadata {
  readonly engine: EngineId;
  readonly name: string;
  readonly version: string;
  /** Exact provider event names; these events do not have equivalent semantics. */
  readonly readyEvent: string | null;
  readonly playingEvent: string | null;
  readonly loadCompletion: "promise" | "unavailable";
  readonly attachCompletion: "synchronous-return" | "promise-resolution" | "event";
  /** Explicit public settings only. Never include keys, URLs, headers or SDK objects. */
  readonly configuration: Readonly<Record<string, SafeValue>>;
  readonly unavailable: Readonly<Partial<Record<AdapterMark, string>>>;
}

export interface ProviderSample {
  readonly mediaEngine: "media-source" | "managed-media-source" | "native" | "unknown";
  readonly audioLanguage: string | null;
  readonly workerActive: boolean | null;
  /** Provider statistics retain their original units and definitions. */
  readonly loadLatencySeconds: number | null;
  readonly timeToFirstFrameSeconds: number | null;
  readonly bandwidthEstimateBps: number | null;
}

export interface AdapterContext {
  readonly video: HTMLVideoElement;
  readonly container: HTMLElement;
  readonly url: string;
  readonly licenseKey: string;
  readonly profile: StartupProfile;
  readonly tuning?: StartupTuning;
  readonly signal: AbortSignal;
  /** Observe at the callback using the common performance clock, not SDK timestamps. */
  readonly mark: (name: AdapterMark) => void;
  readonly fatal: (code: FailureCode, sdkCode?: number) => void;
}

export interface AdapterSession {
  readonly metadata: AdapterMetadata;
  /** Request load and play at the earliest supported point; observe each separately. */
  start(): Promise<void>;
  sample(): ProviderSample;
  /** Release partial initialization too, and stop reporting callbacks after disposal. */
  dispose(): Promise<void>;
}

export type CreateAdapter = (context: AdapterContext) => Promise<AdapterSession>;
