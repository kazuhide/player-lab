import type { DemoNetworkStatus, DemoOptions, DemoSample, DemoSeek, DemoStartOptions, DemoStartup } from "./demo-contract";
import { DEMO_CLEANUP_TIMEOUT_MS } from "./demo-contract";
import { STARTUP_MARKS } from "./model";

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; clean: () => void }
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const optionalMeasurement = (value: unknown): value is number | null => value === null || measured(value);
const failures = new Set(["unsupported", "initialization-failed", "configuration-rejected", "load-failed", "play-rejected",
  "sdk-error", "media-error", "aborted", "deadline", "cleanup-failed", "invalid-playback"]);
function validOutcome(value: Record<string, unknown>): boolean {
  return value.status === "success" ? value.failureCode === null
    : (value.status === "failure" || value.status === "cancelled") && typeof value.failureCode === "string" && failures.has(value.failureCode);
}
function networkStatus(value: unknown): DemoNetworkStatus | null {
  if (!value || typeof value !== "object") return null;
  const data = value as DemoNetworkStatus;
  if (!["ready", "unsupported", "disposed"].includes(data.support)
    || (data.reason !== undefined && !["no-service-worker", "insecure-context", "wrong-document", "registration-failed",
      "worker-timeout", "opaque-media", "unclassified-media", "unreadable-media", "stream-limit"].includes(data.reason))
    || !optionalMeasurement(data.rateBytesPerSecond)
    || ![data.shapedResponses, data.deliveredBytes, data.skippedResponses].every(measured)) return null;
  return { support: data.support, ...(data.reason === undefined ? {} : { reason: data.reason }),
    rateBytesPerSecond: data.rateBytesPerSecond, shapedResponses: data.shapedResponses,
    deliveredBytes: data.deliveredBytes, skippedResponses: data.skippedResponses };
}
/** One retained player/document, authenticated by source, origin and a random channel. */
export class DemoSession {
  readonly element = document.createElement("iframe");
  private readonly channel = crypto.randomUUID();
  private readonly pending = new Map<number, Pending>();
  private next = 0;
  private closed = false;
  private started = false;
  private readySeen = false;
  private disposal: Promise<void> | null = null;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly readyTimer: ReturnType<typeof setTimeout>;
  constructor(private readonly options: DemoOptions) {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // A caller may dispose a document before asking it to start.
    void this.ready.catch(() => {});
    this.readyTimer = setTimeout(() => this.close("deadline"), 30_000);
    window.addEventListener("message", this.receive);
    const url = new URL("demo-runner.html", location.href);
    url.searchParams.set("demo", "1"); url.searchParams.set("engine", options.engine); url.searchParams.set("channel", this.channel);
    this.element.title = `${options.engine} comparison player`;
    this.element.allow = "autoplay"; this.element.src = url.href;
    options.container.replaceChildren(this.element);
  }
  private readonly receive = (event: MessageEvent<unknown>) => {
    if (this.closed || event.origin !== location.origin || event.source !== this.element.contentWindow
      || !event.data || typeof event.data !== "object") return;
    const data = event.data as Record<string, unknown>;
    if (data.channel !== this.channel) return;
    if (data.type === "ready") { this.readySeen = true; clearTimeout(this.readyTimer); this.resolveReady(); return; }
    if (data.type === "sample") {
      const sample = data.sample as Partial<DemoSample> | undefined;
      if (!sample || ![sample.elapsedMs, sample.mediaTime, sample.width, sample.height, sample.bufferSeconds]
        .every(measured) || ![sample.droppedFrames, sample.durationSeconds, sample.seekableStart, sample.seekableEnd].every(optionalMeasurement)
        || typeof sample.paused !== "boolean" || typeof sample.stalled !== "boolean") return;
      const network = sample.network === undefined ? undefined : networkStatus(sample.network);
      if (network === null) return;
      this.options.onSample?.({ elapsedMs: sample.elapsedMs!, mediaTime: sample.mediaTime!, width: sample.width!, height: sample.height!,
        bufferSeconds: sample.bufferSeconds!, paused: sample.paused, stalled: sample.stalled, droppedFrames: sample.droppedFrames!,
        durationSeconds: sample.durationSeconds!, seekableStart: sample.seekableStart!, seekableEnd: sample.seekableEnd!,
        ...(network === undefined ? {} : { network }) }); return;
    }
    if (data.type === "prepare-failed") { this.close("initialization-failed"); return; }
    if (data.type !== "response" || !Number.isSafeInteger(data.operationId)) return;
    const pending = this.pending.get(data.operationId as number);
    if (!pending) return;
    pending.clean();
    if (data.error) pending.reject(new Error("operation-failed")); else pending.resolve(data.result);
  };
  private async request(type: string, payload: unknown, signal?: AbortSignal, timeout = 40_000): Promise<unknown> {
    if (this.closed || signal?.aborted) throw new Error("aborted");
    const preparingAbort = () => { if (!this.readySeen) this.close("aborted"); };
    if (!this.readySeen) signal?.addEventListener("abort", preparingAbort, { once: true });
    try { await this.ready; } finally { signal?.removeEventListener("abort", preparingAbort); }
    if (this.closed || signal?.aborted) throw new Error("aborted");
    const operationId = ++this.next;
    return new Promise((resolve, reject) => {
      const abort = () => this.element.contentWindow?.postMessage({ type: "cancel", channel: this.channel, operationId }, location.origin);
      const timer = setTimeout(() => this.close("deadline"), timeout);
      const clean = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.pending.delete(operationId); };
      this.pending.set(operationId, { resolve, reject, clean });
      signal?.addEventListener("abort", abort, { once: true });
      this.element.contentWindow?.postMessage({ type, payload, channel: this.channel, operationId }, location.origin);
      if (signal?.aborted) abort();
    });
  }
  async start(options: DemoStartOptions): Promise<DemoStartup> {
    if (this.started || this.closed) throw new Error("invalid-playback");
    this.started = true;
    const { signal, ...settings } = options;
    const result = await this.request("start", { ...settings, selectedAt: options.selectedAt ?? performance.timeOrigin + performance.now() }, signal);
    if (!result || typeof result !== "object") throw new Error("invalid-result");
    const data = result as Record<string, unknown>;
    if (!validOutcome(data) || typeof data.frameCallbackAvailable !== "boolean" || !optionalMeasurement(data.sdkCode)
      || !data.marks || typeof data.marks !== "object" || Array.isArray(data.marks)
      || Object.entries(data.marks).some(([key, value]) => !STARTUP_MARKS.includes(key as typeof STARTUP_MARKS[number]) || !measured(value))
      || (data.metadata !== null && (!data.metadata || typeof data.metadata !== "object"))) throw new Error("invalid-result");
    return { status: data.status, failureCode: data.failureCode, sdkCode: data.sdkCode, marks: { ...data.marks },
      metadata: data.metadata, frameCallbackAvailable: data.frameCallbackAvailable } as DemoStartup;
  }
  async seek(targetSeconds: number, signal: AbortSignal): Promise<DemoSeek> {
    const result = await this.request("seek", { targetSeconds }, signal, 15_000);
    if (!result || typeof result !== "object") throw new Error("invalid-result");
    const data = result as Record<string, unknown>;
    if (!validOutcome(data) || !optionalMeasurement(data.latencyMs) || !measured(data.targetSeconds)
      || data.targetSeconds !== targetSeconds || typeof data.buffered !== "boolean" || typeof data.frameCallbackAvailable !== "boolean"
      || (data.status === "success" && (data.latencyMs === null || data.frameCallbackAvailable !== true))
      || (data.status !== "success" && data.latencyMs !== null)) throw new Error("invalid-result");
    return { status: data.status, failureCode: data.failureCode, latencyMs: data.latencyMs, targetSeconds,
      buffered: data.buffered, frameCallbackAvailable: data.frameCallbackAvailable } as DemoSeek;
  }
  async play(): Promise<void> { await this.request("play", {}); }
  pause(): void {
    if (!this.closed) this.element.contentWindow?.postMessage({ type: "pause", payload: {}, channel: this.channel, operationId: ++this.next }, location.origin);
  }
  async setNetworkRate(rate: number | null): Promise<DemoNetworkStatus> {
    const value = networkStatus(await this.request("network", { rate }, undefined, 15_000));
    if (!value) throw new Error("invalid-result");
    return value;
  }
  private close(code: string): void {
    if (this.closed) return; this.closed = true;
    clearTimeout(this.readyTimer); this.rejectReady(new Error(code)); window.removeEventListener("message", this.receive);
    for (const pending of [...this.pending.values()]) { pending.clean(); pending.reject(new Error(code)); }
    this.element.remove();
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    if (this.closed) return Promise.resolve();
    if (!this.readySeen) { this.close("aborted"); return this.disposal = Promise.resolve(); }
    this.disposal = this.request("dispose", {}, undefined, DEMO_CLEANUP_TIMEOUT_MS + 1_000)
      .then(() => {}, () => { throw new Error("cleanup-failed"); }).finally(() => this.close("aborted"));
    return this.disposal;
  }
}
