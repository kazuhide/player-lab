import { DEMO_SDK_VERSIONS, type DemoEngineId, type SafeValue } from "../contract";
import { parseDemoSource } from "../demo-contract";
import type { PreparationPolicy, UseCaseDriver, UseCaseSource } from "./contracts";

export interface SweepOptions {
  readonly engine: DemoEngineId;
  readonly policy: PreparationPolicy;
  readonly warmupMs: number;
  readonly lookahead: number;
  readonly steps: number;
  readonly sourceUrls?: readonly string[];
  readonly format?: "hls" | "dash";
  readonly retain?: boolean;
  readonly workerEnabled?: boolean;
  readonly hlsMetadataDetached?: boolean;
  readonly shakaStrategy?: "pool" | "shared";
}
type Marks = { playingMs: number | null; firstFrameMs: number | null; movingFrameMs: number | null; playResolvedMs: number | null; qualifiedMs: number | null };
export interface SweepTransition {
  readonly sourceId: string;
  readonly status: "success" | "failure";
  readonly marks: Marks;
  readonly inputDispatchDelayMs: number;
  readonly width: number;
  readonly height: number;
  readonly audioDecodedBytes: number | null;
  readonly reusedVideo: boolean;
  readonly audioDecodedBytesBefore: number | null;
  readonly audioCounterResetObserved: boolean;
  readonly bufferSeconds: number | null;
}
export interface SweepResult {
  readonly schemaVersion: 1;
  readonly engine: DemoEngineId;
  readonly version: string;
  readonly policy: PreparationPolicy;
  readonly warmupMs: number;
  readonly lookahead: number;
  readonly steps: number;
  readonly status: "success" | "failure" | "unsupported";
  readonly failureStage: string | null;
  readonly configuration: Readonly<Record<string, SafeValue>>;
  readonly initial: SweepTransition | null;
  /** Includes driver import, SDK download, construction, source load and playback. */
  readonly initialFromCaseStart: Marks | null;
  readonly transitions: readonly SweepTransition[];
  readonly events: readonly { name: string; sourceId: string; elapsedMs: number }[];
  readonly preparation: readonly { sourceId: string; startedMs: number; settledMs: number | null; failed: boolean }[];
  readonly setupMs: number;
  readonly cleanupMs: number | null;
  readonly retained: boolean;
}

function valid(options: SweepOptions): boolean {
  return ["web-x", "bitmovin-8", "hls", "shaka"].includes(options.engine)
    && ["on-demand", "metadata", "segments", "decoded"].includes(options.policy)
    && Number.isFinite(options.warmupMs) && options.warmupMs >= 0 && options.warmupMs <= 10_000
    && Number.isInteger(options.lookahead) && options.lookahead >= 1 && options.lookahead <= 3
    && Number.isInteger(options.steps) && options.steps >= 1 && options.steps <= 12
    && [undefined, "hls", "dash"].includes(options.format)
    && (options.workerEnabled === undefined || typeof options.workerEnabled === "boolean")
    && (options.hlsMetadataDetached === undefined || typeof options.hlsMetadataDetached === "boolean")
    && [undefined, "pool", "shared"].includes(options.shakaStrategy);
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(0, ms));
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  });
}
async function bounded<T>(promise: Promise<T>, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function load(engine: DemoEngineId, shakaStrategy?: "pool" | "shared") {
  if (engine === "web-x") return (await import("./webx")).createDriver;
  if (engine === "shaka" && shakaStrategy === "shared") return (await import("./shaka-shared")).createDriver;
  if (engine === "shaka") return (await import("./shaka")).createDriver;
  if (engine === "bitmovin-8") return (await import("./bitmovin8")).createDriver;
  return (await import("./hls")).createDriver;
}

/** Keeps the real last player available for the branch's manual demo. */
export class UseCaseSweep {
  private driver: UseCaseDriver | null = null;
  private life: AbortController | null = null;
  private running = false;
  constructor(private readonly container: HTMLElement) {}
  async stop(): Promise<void> {
    this.life?.abort();
    const current = this.driver; this.driver = null;
    if (current) await bounded(current.dispose(), 10_000);
  }
  async run(options: SweepOptions): Promise<SweepResult> {
    if (this.running || !valid(options)) throw new Error("configuration-rejected");
    await this.stop(); this.running = true;
    this.container.replaceChildren();
    const life = this.life = new AbortController(), began = performance.now();
    const events: Array<{ name: string; sourceId: string; elapsedMs: number }> = [];
    const preparation: Array<{ sourceId: string; startedMs: number; settledMs: number | null; failed: boolean }> = [];
    const transitions: SweepTransition[] = [], pending: Promise<void>[] = [];
    const sources: UseCaseSource[] = [];
    const sourceAt = (index: number): UseCaseSource => {
      const source = sources[index];
      if (!source) throw new Error("source-index");
      return source;
    };
    const prepared = new Set<string>();
    const observedVideos = new WeakSet<HTMLVideoElement>();
    let driver: UseCaseDriver | null = null, stage = "configuration", initial: SweepTransition | null = null;
    let setupMs = 0, initialStartedMs = 0, cleanupMs: number | null = null, status: SweepResult["status"] = "failure", failureStage: string | null = null;
    let configuration: SweepResult["configuration"] = {};
    const prepare = (source: UseCaseSource) => {
      if (prepared.has(source.id)) return;
      prepared.add(source.id);
      const row = { sourceId: source.id, startedMs: performance.now() - began, settledMs: null as number | null, failed: false };
      preparation.push(row);
      const work = driver!.prepare(source).then(() => { row.settledMs = performance.now() - began; }, () => {
        row.failed = true; row.settledMs = performance.now() - began;
        // Drivers resolve intentional promotion cancellation. Once this case is
        // aborted, remaining preparation rejections belong to its cleanup.
        if (!life.signal.aborted) { failureStage ??= "source-preparation-error"; life.abort(); }
      });
      pending.push(work);
    };
    try {
      if ((options.engine === "shaka" && (options.policy === "metadata"
        || (options.shakaStrategy === "shared" && options.policy === "decoded")))
        || (options.engine === "hls" && options.format === "dash")) {
        status = "unsupported"; stage = "unsupported-policy";
      } else {
        for (let index = 0; index <= options.steps + options.lookahead; index++) {
          const url = options.sourceUrls?.[index] ?? new URL("media/vod-baseline/comparison-360p.m3u8", location.href).href;
          const checked = parseDemoSource({ url, format: options.format ?? "hls", label: "Common test source", custom: true }, location.href);
          sources.push({ id: `source-${index}`, url: checked.url, format: checked.format, startTimeSeconds: 0 });
        }
        stage = "driver-initialization";
        const create = await load(options.engine, options.shakaStrategy);
        driver = await bounded(create({ container: this.container,
          licenseKey: import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY ?? "", policy: options.policy, bufferSeconds: 12,
          ...(options.workerEnabled === undefined ? {} : { workerEnabled: options.workerEnabled }),
          ...(options.hlsMetadataDetached === undefined ? {} : { hlsMetadataDetached: options.hlsMetadataDetached }),
          signal: life.signal, event: (name, sourceId) => {
            if (events.length < 1000) events.push({ name, sourceId, elapsedMs: performance.now() - began });
            // Buffered video can keep moving after a fatal SDK failure. It is
            // never valid playback evidence for this trial, including lookahead.
            if (name === "error") { failureStage = "sdk-source-error"; life.abort(); }
          } }));
        this.driver = driver; configuration = driver.configuration;
        stage = "initial-playback";
        // Include synchronous preparation in the initial activation clock as well.
        const initialIntent = performance.now();
        initialStartedMs = initialIntent - began;
        prepare(sourceAt(0)); initial = await activate(driver, sourceAt(0), initialIntent, life.signal, observedVideos);
        if (initial.status !== "success") throw new Error("invalid-playback");
        setupMs = performance.now() - began;
        for (let index = 1; index <= options.steps; index++) {
          stage = `transition-${index}`;
          // Anchor intent before synchronous preparation can block the main thread.
          const intendedAt = performance.now() + options.warmupMs;
          for (let next = index; next < Math.min(sources.length, index + options.lookahead); next++) prepare(sourceAt(next));
          await delay(intendedAt - performance.now(), life.signal);
          const result = await activate(driver, sourceAt(index), intendedAt, life.signal, observedVideos);
          transitions.push(result);
          if (result.status !== "success") throw new Error("invalid-playback");
        }
        // A preparation/error callback can race the final completed observation.
        if (life.signal.aborted) throw new Error("invalid-playback");
        status = "success";
      }
    } catch {
      failureStage ??= stage;
    } finally {
      const cleanupStart = performance.now();
      if (!options.retain || status !== "success") {
        life.abort();
        try { await this.stop(); await bounded(Promise.allSettled(pending), 10_000); cleanupMs = performance.now() - cleanupStart; }
        catch { status = "failure"; failureStage = "cleanup"; }
      }
      this.running = false;
    }
    return { schemaVersion: 1, engine: options.engine, version: DEMO_SDK_VERSIONS[options.engine], policy: options.policy,
      warmupMs: options.warmupMs, lookahead: options.lookahead, steps: options.steps, status,
      failureStage, configuration, initial,
      initialFromCaseStart: initial ? offsetMarks(initial.marks, initialStartedMs) : null,
      transitions, events, preparation, setupMs, cleanupMs,
      retained: options.retain === true && status === "success" };
  }
}

function offsetMarks(marks: Marks, offset: number): Marks {
  return {
    playingMs: marks.playingMs === null ? null : marks.playingMs + offset,
    firstFrameMs: marks.firstFrameMs === null ? null : marks.firstFrameMs + offset,
    movingFrameMs: marks.movingFrameMs === null ? null : marks.movingFrameMs + offset,
    playResolvedMs: marks.playResolvedMs === null ? null : marks.playResolvedMs + offset,
    qualifiedMs: marks.qualifiedMs === null ? null : marks.qualifiedMs + offset,
  };
}

function audioDecodedBytes(video: HTMLVideoElement): number | null {
  const value: unknown = Reflect.get(video, "webkitAudioDecodedByteCount");
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

async function activate(driver: UseCaseDriver, source: UseCaseSource, intendedAt: number, signal: AbortSignal,
  observedVideos: WeakSet<HTMLVideoElement>): Promise<SweepTransition> {
  const began = performance.now();
  const marks: Marks = { playingMs: null, firstFrameMs: null, movingFrameMs: null, playResolvedMs: null, qualifiedMs: null };
  let video: HTMLVideoElement | null = null, frameId: number | null = null, firstTime: number | null = null;
  let reusedVideo = false, audioBefore: number | null = null, audioCounterResetObserved = false;
  let settled = false, done = false, timer: ReturnType<typeof setTimeout>, poll: ReturnType<typeof setInterval>;
  let resolve!: (success: boolean) => void;
  const completion = new Promise<boolean>((accept) => { resolve = accept; });
  const now = () => performance.now() - intendedAt;
  const finish = (success: boolean) => {
    if (done) return; done = true; clearTimeout(timer); clearInterval(poll); signal.removeEventListener("abort", abort);
    if (video) { video.removeEventListener("playing", playing); video.removeEventListener("error", error); video.removeEventListener("emptied", emptied);
      if (frameId !== null) video.cancelVideoFrameCallback(frameId); }
    resolve(success);
  };
  const abort = () => finish(false), error = () => finish(false);
  const hasAudioEvidence = () => {
    const audio = video ? audioDecodedBytes(video) : null;
    return audio !== null && audio > 0
      && (!reusedVideo || (audioBefore !== null && (audio > audioBefore || audioCounterResetObserved)));
  };
  const check = () => {
    if (video && audioBefore !== null) {
      const audioNow = audioDecodedBytes(video);
      if (audioNow !== null && audioNow < audioBefore) audioCounterResetObserved = true;
    }
    if (!video || marks.playingMs === null || marks.movingFrameMs === null) return;
    if (!video.paused && !video.ended && video.readyState >= 2 && video.videoWidth === 640 && video.videoHeight === 360
      && video.currentTime >= source.startTimeSeconds + 0.1 && hasAudioEvidence()) {
      // Native observations define this timestamp; SDK promise semantics do not.
      if (marks.qualifiedMs === null) marks.qualifiedMs = now();
      if (settled) finish(true);
    }
  };
  const playing = () => { if (marks.playingMs === null) marks.playingMs = now(); check(); };
  const emptied = () => {
    if (!reusedVideo || !video) return;
    // A queued old-source event/frame must not survive a reused element's reset.
    marks.playingMs = null; marks.firstFrameMs = null; marks.movingFrameMs = null; marks.qualifiedMs = null; firstTime = null;
    const resetAudio = audioDecodedBytes(video);
    if (resetAudio !== null && audioBefore !== null && resetAudio < audioBefore) audioCounterResetObserved = true;
  };
  const observe = (target: HTMLVideoElement) => {
    if (video || done) throw new Error("video-ownership"); video = target;
    reusedVideo = observedVideos.has(target); observedVideos.add(target);
    audioBefore = audioDecodedBytes(target);
    const observedAt = performance.now();
    video.addEventListener("playing", playing); video.addEventListener("error", error); video.addEventListener("emptied", emptied);
    const frame = (_time: number, metadata: VideoFrameCallbackMetadata) => {
      frameId = null; if (done || !video) return;
      // Ignore a reused element's queued previous-source frame and hidden preparation.
      if (marks.playingMs !== null && metadata.presentationTime >= observedAt
        && Math.abs(metadata.mediaTime - video.currentTime) <= 0.05
        && (marks.firstFrameMs !== null || metadata.mediaTime <= source.startTimeSeconds + 0.25)) {
        if (marks.firstFrameMs === null) { marks.firstFrameMs = now(); firstTime = metadata.mediaTime; }
        if (firstTime !== null && metadata.mediaTime > firstTime + 0.01 && marks.movingFrameMs === null) marks.movingFrameMs = now();
      }
      check(); if (!done) frameId = video.requestVideoFrameCallback(frame);
    };
    if (typeof video.requestVideoFrameCallback !== "function") { finish(false); return; }
    frameId = video.requestVideoFrameCallback(frame);
  };
  timer = setTimeout(() => finish(false), 20_000); poll = setInterval(check, 25);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) finish(false);
  else void driver.activate(source.id, observe).then(() => {
    if (done) return;
    settled = true; marks.playResolvedMs = now(); check();
  }, () => finish(false));
  const success = await completion;
  const current = video as HTMLVideoElement | null;
  const audio = current ? audioDecodedBytes(current) : null;
  // Reused videos cannot borrow a previous asset's cumulative decoder counter.
  return { sourceId: source.id, status: success && hasAudioEvidence() ? "success" : "failure", marks,
    inputDispatchDelayMs: Math.max(0, began - intendedAt), width: current?.videoWidth ?? 0, height: current?.videoHeight ?? 0,
    audioDecodedBytes: audio, reusedVideo, audioDecodedBytesBefore: audioBefore, audioCounterResetObserved,
    bufferSeconds: driver.state(source.id).bufferSeconds };
}
