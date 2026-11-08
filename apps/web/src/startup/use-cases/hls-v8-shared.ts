import { observedBuffer } from "./contracts";

export const cancelled = () => new DOMException("The use-case operation was cancelled.", "AbortError");

/** Keep cancelled SDK promises observed even when their network cleanup finishes later. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(cancelled()); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(cancelled()); else resolve(value);
    }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export function createStage(container: HTMLElement): HTMLElement {
  const stage = document.createElement("div");
  Object.assign(stage.style, { position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", background: "#000" });
  container.append(stage);
  return stage;
}

export function createOwnedVideo(stage: HTMLElement): { mount: HTMLElement; video: HTMLVideoElement } {
  const mount = document.createElement("div");
  // A positive opacity keeps staged decoding paintable. No display:none,
  // visibility:hidden, detached video or offscreen decode shortcut is used.
  Object.assign(mount.style, { position: "absolute", inset: "0", opacity: "0.001", zIndex: "0", pointerEvents: "none" });
  mount.setAttribute("aria-hidden", "true");
  const video = document.createElement("video");
  video.muted = true; video.defaultMuted = true; video.autoplay = false;
  video.playsInline = true; video.controls = false; video.preload = "auto";
  video.playbackRate = 1; video.defaultPlaybackRate = 1;
  Object.assign(video.style, { display: "block", width: "100%", height: "100%", objectFit: "contain" });
  mount.append(video); stage.append(mount);
  return { mount, video };
}

export function showOwnedVideo(mount: HTMLElement, foreground: boolean): void {
  mount.style.opacity = foreground ? "1" : "0.001";
  mount.style.zIndex = foreground ? "1" : "0";
  mount.setAttribute("aria-hidden", foreground ? "false" : "true");
}

export function releaseOwnedVideo(video: HTMLVideoElement, mount: HTMLElement): void {
  video.pause(); video.removeAttribute("src"); video.load(); mount.remove();
}

/** Preparation readiness comes from the owned media element, not an SDK promise. */
export function waitForBuffer(video: HTMLVideoElement, targetSeconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const events = ["progress", "loadeddata", "canplay", "timeupdate", "seeked", "error"];
    const cleanup = () => {
      if (timer !== undefined) clearInterval(timer);
      for (const event of events) video.removeEventListener(event, check);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(cancelled()); };
    const check = () => {
      if (signal.aborted) { abort(); return; }
      if (video.error) { cleanup(); reject(new Error("Prepared media failed.")); return; }
      const remaining = Number.isFinite(video.duration) ? Math.max(0, video.duration - video.currentTime) : targetSeconds;
      const ahead = observedBuffer(video);
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && ahead > 0 && ahead + 0.05 >= Math.min(targetSeconds, remaining)) {
        cleanup(); resolve();
      }
    };
    for (const event of events) video.addEventListener(event, check);
    signal.addEventListener("abort", abort, { once: true });
    timer = setInterval(check, 100);
    check();
  });
}

/** Install before loading/preplay; a frame callback is required for decoded policy. */
export function waitForDecodedFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number | undefined;
    const cleanup = () => {
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      signal.removeEventListener("abort", abort);
      video.removeEventListener("error", error);
    };
    const abort = () => { cleanup(); reject(cancelled()); };
    const error = () => { cleanup(); reject(new Error("Prepared media failed.")); };
    const observe = () => {
      if (signal.aborted) { abort(); return; }
      frame = video.requestVideoFrameCallback(() => {
        frame = undefined;
        if (signal.aborted) { abort(); return; }
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
          cleanup(); resolve();
        } else observe();
      });
    };
    signal.addEventListener("abort", abort, { once: true });
    video.addEventListener("error", error);
    observe();
  });
}

export const supportsDecodedPreparation = () => typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function";
