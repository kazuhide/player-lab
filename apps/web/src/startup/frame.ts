import type { EngineId, StartupProfile, StartupTuning } from "./contract";
import type { BrowserTrial } from "./runner";

export type ContentId = "bbb-360p" | "bbb-180p";
export type SdkMode = "on-demand" | "preloaded";

/** A single visible document. A finished document is never reused for another trial. */
export class TrialFrame {
  readonly element = document.createElement("iframe");
  private readonly channel = crypto.randomUUID();
  private closed = false;
  private started = false;
  private rejectPending: ((error: Error) => void) | null = null;
  private stopListening: (() => void) | null = null;

  constructor(readonly engine: EngineId, readonly mode: SdkMode, stage: HTMLElement) {
    const url = new URL("comparison-runner.html", location.href);
    url.searchParams.set("channel", this.channel);
    url.searchParams.set("engine", engine);
    url.searchParams.set("mode", mode);
    this.element.title = "Player Lab comparison video";
    this.element.allow = "autoplay";
    this.element.src = url.href;
    stage.replaceChildren(this.element);
  }

  private receive(type: string, timeout: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error("closed")); return; }
      const clean = () => { window.clearTimeout(timer); window.removeEventListener("message", listener); this.stopListening = null; this.rejectPending = null; };
      const listener = (event: MessageEvent<unknown>) => {
        if (event.origin !== location.origin || event.source !== this.element.contentWindow
          || typeof event.data !== "object" || !event.data) return;
        const data = event.data as Record<string, unknown>;
        if (data.channel !== this.channel) return;
        if (data.type === "prepare-failed") { clean(); reject(new Error("prepare-failed")); }
        else if (data.type === type) { clean(); resolve(data); }
      };
      const timer = window.setTimeout(() => { clean(); reject(new Error("deadline")); }, timeout);
      this.rejectPending = reject;
      this.stopListening = clean;
      window.addEventListener("message", listener);
    });
  }

  async ready(): Promise<void> { await this.receive("ready", 30_000); }

  async start(contentId: ContentId, profile: StartupProfile, tuning: StartupTuning,
    signal: AbortSignal, selectedAt: number): Promise<BrowserTrial> {
    if (this.closed || this.started || signal.aborted) throw new Error("aborted");
    this.started = true;
    const result = this.receive("result", 40_000);
    const cancel = () => this.element.contentWindow?.postMessage({ type: "cancel", channel: this.channel }, location.origin);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      this.element.contentWindow?.postMessage({ type: "start", channel: this.channel,
        contentId, profile, tuning, selectedAt }, location.origin);
      const data = await result;
      if (typeof data.result !== "object" || data.result === null) throw new Error("invalid-result");
      return data.result as BrowserTrial;
    } finally { signal.removeEventListener("abort", cancel); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const reject = this.rejectPending;
    this.stopListening?.();
    reject?.(new Error("closed"));
    this.element.remove();
  }
}
