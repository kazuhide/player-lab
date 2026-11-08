import { observedBuffer } from "./contracts";

export const cancelled = (): DOMException => new DOMException("The prepared source operation was cancelled.", "AbortError");

export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(cancelled()); }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(cancelled()); };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); });
  });
}

export function waitUntil(check: () => boolean, signal: AbortSignal, timeoutMs = 30_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setInterval>;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      clearInterval(timer); clearTimeout(deadline); signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(cancelled());
    const poll = () => {
      if (signal.aborted) { onAbort(); return; }
      try { if (check()) finish(); } catch { finish(new Error("The source state could not be observed.")); }
    };
    timer = setInterval(poll, 25);
    deadline = setTimeout(() => finish(new Error("The prepared source observation timed out.")), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    poll();
  });
}

export interface PreparedMedia {
  readonly video: HTMLVideoElement;
  readonly container: HTMLDivElement;
  show(active: boolean): void;
  destroy(): void;
}

/** Full-size transparent staging preserves the common paint geometry. */
export function createPreparedMedia(parent: HTMLElement): PreparedMedia {
  const container = document.createElement("div");
  const video = document.createElement("video");
  video.muted = true; video.defaultMuted = true; video.autoplay = false;
  video.playsInline = true; video.controls = false; video.preload = "auto";
  video.playbackRate = 1; video.defaultPlaybackRate = 1;
  video.style.cssText = "display:block;width:100%;height:100%;object-fit:contain";
  container.append(video); parent.append(container);
  const show = (active: boolean) => {
    container.setAttribute("aria-hidden", active ? "false" : "true");
    container.style.cssText = active
      ? "position:absolute;inset:0;width:100%;height:100%;opacity:1;pointer-events:none;z-index:1"
      : "position:absolute;inset:0;width:100%;height:100%;opacity:0.001;pointer-events:none;z-index:0";
  };
  show(false);
  return { video, container, show, destroy() {
    video.pause(); video.removeAttribute("src"); video.srcObject = null; video.load(); container.remove();
  } };
}

/** Observe a real presented frame; no ready/playing event substitutes for one. */
export function firstFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (typeof video.requestVideoFrameCallback !== "function") {
    return Promise.reject(new Error("Decoded preparation requires requestVideoFrameCallback."));
  }
  return new Promise<void>((resolve, reject) => {
    let frame = 0;
    const finish = (error?: Error) => {
      clearTimeout(deadline); signal.removeEventListener("abort", onAbort);
      video.cancelVideoFrameCallback(frame);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(cancelled());
    const deadline = setTimeout(() => finish(new Error("Decoded preparation produced no observed frame.")), 30_000);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    frame = video.requestVideoFrameCallback(() => finish());
  });
}

export async function prepareDecoded(options: {
  readonly media: PreparedMedia;
  readonly signal: AbortSignal;
  readonly startTimeSeconds: number;
  readonly bufferSeconds: number;
  readonly promoted: () => boolean;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly seek: (seconds: number) => void;
}): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal.addEventListener("abort", cancel, { once: true });
  if (options.signal.aborted) controller.abort();
  try {
    const frame = firstFrame(options.media.video, controller.signal);
    // Keep the callback rejection observed if play() rejects first.
    void frame.catch(() => {});
    await Promise.all([abortable(options.play(), controller.signal), frame]);
    if (options.promoted()) return;
    options.pause();
    if (options.promoted()) return;
    options.seek(options.startTimeSeconds);
    await waitUntil(() => {
      const video = options.media.video;
      return !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && Math.abs(video.currentTime - options.startTimeSeconds) < 0.05
        && observedBuffer(video) >= options.bufferSeconds - 0.05;
    }, controller.signal);
  } finally {
    options.signal.removeEventListener("abort", cancel); controller.abort();
    if (!options.promoted()) options.pause();
  }
}
