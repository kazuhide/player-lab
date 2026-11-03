import type { AdapterSession, CreateAdapter, DemoEngineId, FailureCode } from "./contract";
import type { BrowserMarks } from "./runner";
import { DEMO_CLEANUP_TIMEOUT_MS, DEMO_SAMPLE_INTERVAL_MS, DEMO_SEEK_TIMEOUT_MS, DEMO_STARTUP_TIMEOUT_MS,
  parseDemoSource, type DemoNetworkStatus, type DemoSample, type DemoSeek, type DemoStartOptions, type DemoStartup } from "./demo-contract";
import type { DemoNetworkController } from "./demo-network";
import { isCommonFixedHls, useCompactCommonHls } from "./webx-bundle-policy";
import type { DemoSource } from "./demo-contract";

export { DemoSession } from "./demo-frame";
export * from "./demo-contract";
type Clock = Pick<Performance, "timeOrigin" | "now">;
type Loader = (engine: DemoEngineId, source: DemoSource) => Promise<CreateAdapter>;
const loadAdapter: Loader = async (engine, source) => {
  const { format } = source;
  if (engine === "web-x") {
    if (useCompactCommonHls(source, new URL(import.meta.env.BASE_URL, location.origin).href)) {
      return (await import("./adapters/webx-clear-fmp4")).createAdapter;
    }
    return (format === "dash" ? await import("./adapters/webx-dash") : await import("./adapters/webx")).createAdapter;
  }
  if (engine === "bitmovin-8") return (format === "dash" ? await import("./adapters/bitmovin8-dash") : await import("./adapters/bitmovin8")).createAdapter;
  if (engine === "shaka") return (format === "dash" ? await import("./adapters/shaka-dash") : await import("./adapters/shaka")).createAdapter;
  return (await import("./adapters/hls")).createAdapter;
};
const outcome = (code: FailureCode | null) => ({ status: code === "aborted" ? "cancelled" as const : code ? "failure" as const : "success" as const, failureCode: code });
const finite = (value: number): number | null => Number.isFinite(value) && value >= 0 ? value : null;
function contains(ranges: TimeRanges, value: number): boolean {
  for (let i = 0; i < ranges.length; i++) if (value >= ranges.start(i) && value <= ranges.end(i)) return true;
  return false;
}
async function bounded<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), timeout); })]); }
  finally { clearTimeout(timer); }
}

/** Runs inside one owned demo iframe; SDK instances never cross postMessage. */
export class DemoRuntime {
  private readonly life = new AbortController();
  private readonly networkLife = new AbortController();
  private readonly clock: Clock;
  private session: AdapterSession | null = null;
  private creation: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private started = false;
  private startupComplete = false;
  private failure: FailureCode | null = null;
  private sdkCode: number | null = null;
  private selectedAt = 0;
  private marks: BrowserMarks = {};
  private active: { finish: (code: FailureCode | null) => void } | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | undefined;
  private stalled = false;
  private lateCleanupFailed = false;
  private listenerCleanupFailed = false;
  private network: DemoNetworkController | null = null;
  private preparingNetwork: Promise<DemoNetworkController> | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly options: { engine: DemoEngineId; video: HTMLVideoElement; container: HTMLElement;
    onSample?: (sample: DemoSample) => void; clock?: Clock; loadAdapter?: Loader }) {
    this.clock = options.clock ?? performance;
  }
  private now(): number { return this.clock.timeOrigin + this.clock.now(); }
  private mark(name: keyof BrowserMarks): void {
    if (!this.closed && !this.startupComplete && !this.failure && this.marks[name] === undefined) this.marks[name] = this.now() - this.selectedAt;
  }
  private fatal(code: FailureCode, sdkCode?: number): void {
    if (this.closed || this.failure) return;
    this.failure = code;
    this.sdkCode = typeof sdkCode === "number" && Number.isFinite(sdkCode) ? sdkCode : null;
    this.active?.finish(code);
    if (this.startupComplete) void this.dispose().catch(() => {});
  }
  private listen(name: string, callback: EventListener): void {
    this.options.video.addEventListener(name, callback);
    this.listeners.push(() => this.options.video.removeEventListener(name, callback));
  }
  private sample(): void {
    if (this.closed || !this.started) return;
    const video = this.options.video;
    try {
      if (![video.currentTime, video.videoWidth, video.videoHeight].every(Number.isFinite)) return;
      let bufferSeconds = 0;
      for (let i = 0; i < video.buffered.length; i++) if (video.currentTime >= video.buffered.start(i) && video.currentTime <= video.buffered.end(i)) bufferSeconds = video.buffered.end(i) - video.currentTime;
      const quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
      this.options.onSample?.({ elapsedMs: this.now() - this.selectedAt, mediaTime: video.currentTime,
        width: video.videoWidth, height: video.videoHeight, bufferSeconds, paused: video.paused,
        stalled: !video.paused && !video.ended && (this.stalled || video.readyState < 2),
        droppedFrames: quality ? finite(quality.droppedVideoFrames) : null,
        durationSeconds: finite(video.duration), seekableStart: video.seekable.length ? finite(video.seekable.start(0)) : null,
        seekableEnd: video.seekable.length ? finite(video.seekable.end(video.seekable.length - 1)) : null,
        ...(this.network ? { network: { ...this.network.status } } : {}) });
    } catch { /* A temporarily unavailable browser observation is not a fabricated sample. */ }
  }

  async start(options: DemoStartOptions): Promise<DemoStartup> {
    if (this.started || this.closed) throw new Error("invalid-playback");
    this.started = true;
    this.selectedAt = options.selectedAt ?? this.now();
    let initial: FailureCode | null = null;
    try { options = { ...options, source: parseDemoSource(options.source, location.href) }; }
    catch { initial = "configuration-rejected"; }
    if (!Number.isFinite(this.selectedAt) || this.selectedAt > this.now() || this.now() - this.selectedAt > 60_000) initial = "configuration-rejected";
    if (options.signal.aborted) initial = "aborted";
    if (!initial && this.options.engine === "hls" && options.source.format === "dash") initial = "unsupported";
    const video = this.options.video;
    const frames = typeof video.requestVideoFrameCallback === "function";
    if (initial) {
      try { await this.dispose(); } catch { initial = "cleanup-failed"; }
      return { ...outcome(initial), sdkCode: null, marks: {}, metadata: null, frameCallbackAvailable: frames };
    }
    this.listen("error", () => this.fatal("media-error"));
    this.listen("waiting", () => { this.stalled = true; this.sample(); });
    this.listen("playing", () => { this.stalled = false; this.sample(); });
    let startSettled = false;
    let firstMediaTime: number | null = null;
    const watching = this.watch(options.signal, DEMO_STARTUP_TIMEOUT_MS, (finish) => {
      const check = () => {
        if (this.marks.nativePlaying === undefined || video.paused || video.ended || video.readyState < 2
          || video.videoWidth <= 0 || video.videoHeight <= 0 || video.currentTime < 0.1) return;
        this.mark("advanced");
        if (startSettled && (!frames || this.marks.firstMovingFrame !== undefined)) finish(null);
      };
      const loaded = () => this.mark("loadedData");
      const playing = () => { this.mark("nativePlaying"); check(); };
      video.addEventListener("loadeddata", loaded); video.addEventListener("playing", playing);
      return { check, frame: (metadata: VideoFrameCallbackMetadata) => {
        this.mark("firstFrame");
        if (firstMediaTime === null) firstMediaTime = metadata.mediaTime;
        if (metadata.mediaTime > firstMediaTime + 0.01) this.mark("firstMovingFrame");
        check();
      }, clean: () => { video.removeEventListener("loadeddata", loaded); video.removeEventListener("playing", playing); } };
    });
    this.creation = (async () => {
      this.mark("sdkImportStart");
      const create = await (this.options.loadAdapter ?? loadAdapter)(this.options.engine, options.source);
      this.mark("sdkImportEnd");
      if (this.life.signal.aborted) return;
      const profile = options.profile ?? "startup";
      // Use the fixed fixture's calibrated policy while retaining caller overrides.
      const tuning = this.options.engine === "hls" && profile === "startup"
        && isCommonFixedHls(options.source, new URL(import.meta.env.BASE_URL, location.origin).href)
        ? { ...options.tuning, hlsWorker: options.tuning?.hlsWorker === undefined ? false : options.tuning.hlsWorker } : options.tuning;
      const created = await create({ video, container: this.options.container, url: options.source.url,
        licenseKey: import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY ?? "", profile,
        ...(tuning ? { tuning } : {}), signal: this.life.signal,
        mark: (name) => this.mark(name), fatal: (code, sdk) => this.fatal(code, sdk) });
      if (this.closed) { try { await created.dispose(); } catch { this.lateCleanupFailed = true; } return; }
      this.session = created;
      await created.start(); startSettled = true;
    })().catch(() => { if (!this.closed) this.fatal(this.failure ?? "initialization-failed"); });
    let failure = await watching;
    const metadata = this.session?.metadata ?? null;
    this.startupComplete = true;
    if (failure) {
      try { await this.dispose(); } catch { failure = "cleanup-failed"; }
    } else {
      this.sample();
      this.sampleTimer = setInterval(() => this.sample(), DEMO_SAMPLE_INTERVAL_MS);
    }
    return { ...outcome(failure), sdkCode: this.sdkCode, marks: { ...this.marks }, metadata, frameCallbackAvailable: frames };
  }

  private watch(signal: AbortSignal, timeout: number, setup: (finish: (code: FailureCode | null) => void) => {
    check: () => void; frame: (metadata: VideoFrameCallbackMetadata) => void; clean?: () => void;
  }): Promise<FailureCode | null> {
    this.active?.finish("aborted");
    return new Promise((resolve) => {
      const video = this.options.video;
      let done = false; let frameId: number | null = null;
      let observer: ReturnType<typeof setup> | undefined;
      const finish = (code: FailureCode | null) => {
        if (done) return; done = true;
        clearTimeout(timer); clearInterval(poll); signal.removeEventListener("abort", abort);
        try { if (frameId !== null) video.cancelVideoFrameCallback(frameId); } catch { code = "cleanup-failed"; }
        try { observer?.clean?.(); } catch { code = "cleanup-failed"; }
        if (this.active?.finish === finish) this.active = null;
        resolve(code);
      };
      const abort = () => finish("aborted");
      const timer = setTimeout(() => finish("deadline"), timeout);
      const poll = setInterval(() => { if (!done) observer?.check(); }, 50);
      this.active = { finish };
      observer = setup(finish);
      const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (done || this.closed) return;
        if (Number.isFinite(metadata.mediaTime)) observer?.frame(metadata);
        if (!done) frameId = video.requestVideoFrameCallback(frame);
      };
      if (typeof video.requestVideoFrameCallback === "function") frameId = video.requestVideoFrameCallback(frame);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || this.closed) finish("aborted");
    });
  }

  async seek(targetSeconds: number, signal: AbortSignal): Promise<DemoSeek> {
    const video = this.options.video;
    const frames = typeof video.requestVideoFrameCallback === "function";
    const buffered = Number.isFinite(targetSeconds) && contains(video.buffered, targetSeconds);
    const result = (code: FailureCode | null, latencyMs: number | null = null): DemoSeek => ({ ...outcome(code), latencyMs,
      targetSeconds, buffered, frameCallbackAvailable: frames });
    if (signal.aborted) return result("aborted");
    if (this.closed || !this.session || !this.startupComplete) return result(this.failure ?? "invalid-playback");
    if (!Number.isFinite(targetSeconds) || targetSeconds < 0 || !contains(video.seekable, targetSeconds)) return result("invalid-playback");
    const selectedAt = this.now(); let sawSeeking = false; let firstTarget: number | null = null;
    let playSettled = false; let movingAt: number | null = null; let recheck = () => {};
    const watching = this.watch(signal, DEMO_SEEK_TIMEOUT_MS, (finish) => {
      const check = () => { if (playSettled && movingAt !== null) finish(null); };
      recheck = check;
      const seeking = () => { sawSeeking = true; };
      video.addEventListener("seeking", seeking);
      return { check, frame: (metadata) => {
        if (!sawSeeking || video.seeking || video.paused || video.ended || video.readyState < 2
          || video.videoWidth <= 0 || video.videoHeight <= 0 || Math.abs(video.currentTime - metadata.mediaTime) > 0.5) return;
        if (firstTarget === null) { if (Math.abs(metadata.mediaTime - targetSeconds) <= 0.25) firstTarget = metadata.mediaTime; }
        else if (metadata.mediaTime > firstTarget + 0.01 && metadata.mediaTime >= targetSeconds - 0.25) {
          if (movingAt === null) movingAt = this.now();
          check();
        }
      }, clean: () => video.removeEventListener("seeking", seeking) };
    });
    const operation = this.active;
    try {
      if (this.session.playback) this.session.playback.seek(targetSeconds); else video.currentTime = targetSeconds;
      if (!frames) operation?.finish("unsupported");
      void this.play().then(() => { playSettled = true; recheck(); }, () => operation?.finish("play-rejected"));
    } catch { operation?.finish("invalid-playback"); }
    const failure = await watching;
    return result(failure, failure || movingAt === null ? null : movingAt - selectedAt);
  }

  async play(): Promise<void> {
    if (this.closed || !this.session) throw new Error("invalid-playback");
    try { await bounded(this.session.playback ? this.session.playback.play() : this.options.video.play(), DEMO_STARTUP_TIMEOUT_MS); }
    catch { throw new Error("play-rejected"); }
  }
  pause(): void {
    this.active?.finish("aborted");
    if (this.closed || !this.session) return;
    if (this.session.playback) this.session.playback.pause(); else this.options.video.pause();
  }
  async setNetworkRate(rate: number | null): Promise<DemoNetworkStatus> {
    if (this.closed) throw new Error("aborted");
    if (rate !== null && (!Number.isFinite(rate) || rate < 1024 || rate > 125000000)) throw new Error("configuration-rejected");
    this.preparingNetwork ??= import("./demo-network").then(({ prepareDemoNetwork }) => prepareDemoNetwork({
      onStatus: () => this.sample(), signal: this.networkLife.signal }));
    const network = await this.preparingNetwork;
    if (this.closed) { await network.dispose(); throw new Error("aborted"); }
    this.network = network;
    if (rate === null || network.status.support === "ready") { try { await network.setRate(rate); } catch { /* Return the actual unsupported/disposed status. */ } }
    this.sample();
    return { ...network.status };
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.active?.finish("aborted"); this.networkLife.abort(); clearInterval(this.sampleTimer);
    for (const remove of this.listeners.splice(0)) { try { remove(); } catch { this.listenerCleanupFailed = true; } }
    this.closing = bounded((async () => {
      let failed = this.listenerCleanupFailed;
      try { if (this.preparingNetwork) await (await this.preparingNetwork).dispose(); } catch { failed = true; }
      this.life.abort();
      try { await this.creation; } catch { failed = true; }
      try { await this.session?.dispose(); } catch { failed = true; }
      if (this.lateCleanupFailed) failed = true;
      if (failed) throw new Error("cleanup-failed");
    })(), DEMO_CLEANUP_TIMEOUT_MS).catch(() => { throw new Error("cleanup-failed"); }).finally(() => this.life.abort());
    return this.closing;
  }
}
