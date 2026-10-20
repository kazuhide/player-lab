import type { SourceConfig } from "bitmovin-player";

interface SessionMedia {
  initialize(): void | Promise<unknown>;
  deinitializeSync(timeoutInMs: number): "success" | "timedout" | "invalid";
  setSurfaceHandle(handle: string): void;
  clearSurfaceHandle(handle: string): void;
}

interface SessionPlayer {
  load(source: SourceConfig): Promise<unknown>;
  destroy(): Promise<unknown>;
}

interface SessionController {
  dispose(): void;
  setTimeShiftEnabled(enabled: boolean): void;
}

interface SessionOptions<V extends SessionMedia, P extends SessionPlayer, C extends SessionController> {
  handle: string;
  source: SourceConfig;
  createVideo: () => V;
  installPolyfills: (video: V) => void;
  removePolyfills: (video: V) => void;
  createPlayer: () => P;
  createController: (player: P, isActive: () => boolean) => C;
  controllerRef: { current: C | null };
  getTimeShiftEnabled: () => boolean;
  onError: (message: string) => void;
  after?: Promise<void>;
}

export function startVegaSession<V extends SessionMedia, P extends SessionPlayer, C extends SessionController>(
  options: SessionOptions<V, P, C>,
): { ready: Promise<void>; dispose: () => Promise<void> } {
  let video: V | null = null;
  let player: P | null = null;
  let controller: C | null = null;
  let initializing: Promise<unknown> | null = null;
  let surfaceAttached = false;
  let cancelled = false;
  let cleanup: Promise<void> | null = null;

  function dispose(): Promise<void> {
    if (cleanup) return cleanup;
    cancelled = true;
    // A cancelled waiter owns no resources. Reuse the previous barrier instead of extending a queue.
    if (!video) {
      cleanup = options.after ?? Promise.resolve();
      return cleanup;
    }
    let resolveCleanup!: () => void;
    const barrier: Promise<void> & { retainedOwner?: { video: V; player: P | null; controller: C | null } } =
      Object.assign(new Promise<void>((resolve) => { resolveCleanup = resolve; }), {
        retainedOwner: { video, player, controller },
      });
    // Install the owner-bearing barrier before native calls can synchronously reenter disposal.
    cleanup = barrier;
    // Clear only this effect's controller; an older cleanup cannot clear a newer owner.
    if (controller && options.controllerRef.current === controller) options.controllerRef.current = null;
    try { controller?.dispose(); }
    catch { options.onError("Vega controller cleanup failed"); }

    try { if (surfaceAttached) video.clearSurfaceHandle(options.handle); }
    catch { options.onError("Vega surface cleanup failed"); }
    let released = false;
    // KeplerScript can suspend at background. Release native media before the first await,
    // including ordinary Apply teardown that may still be pending when background arrives.
    // The 1000 ms deadline is this app's policy, not an SDK default. The API also aborts initialization.
    try { released = video.deinitializeSync(1000) === "success"; }
    catch { /* A thrown native release is unconfirmed, just like a non-success status. */ }
    const destroyed = (async () => {
      try { await player?.destroy(); return true; }
      catch {
        options.onError("Vega player cleanup unconfirmed; restart the app before playing again");
        return false;
      }
    })();
    if (!released) {
      // A failed sync call may have discarded its native handle. Retain the owner and block
      // replacements rather than treating a retry or a swallowed error as confirmed release.
      options.onError("Vega media cleanup unconfirmed; restart the app before playing again");
      return barrier;
    }
    void (async () => {
      await initializing?.catch(() => {});
      // Native release alone does not confirm that the Web SDK stopped using the global shim.
      if (!await destroyed) return;
      try { if (video) options.removePolyfills(video); }
      catch { options.onError("Vega media shim cleanup failed"); }
      controller = null;
      player = null;
      video = null;
      delete barrier.retainedOwner;
      resolveCleanup();
    })();
    return barrier;
  }

  const ready = (async () => {
    // Vega's media shim is global. Finish releasing the previous session before installing another.
    if (options.after) await options.after;
    if (cancelled) return;
    video = options.createVideo();
    initializing = Promise.resolve(video.initialize());
    await initializing;
    if (cancelled) return;
    video.setSurfaceHandle(options.handle);
    surfaceAttached = true;
    options.installPolyfills(video);
    player = options.createPlayer();
    controller = options.createController(player, () => !cancelled);
    controller.setTimeShiftEnabled(options.getTimeShiftEnabled());
    options.controllerRef.current = controller;
    await player.load(options.source);
  })().catch(async () => {
    if (!cancelled) options.onError("Vega player setup failed");
    await dispose();
  });
  return { ready, dispose };
}
