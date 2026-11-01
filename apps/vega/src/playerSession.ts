import type { SourceConfig } from "bitmovin-player";

interface SessionMedia {
  src: string;
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

interface NativeReleaseBarrier extends Promise<void> {
  releaseNativeSync?: (resetMedia?: boolean) => boolean;
}

export function releaseVegaBackgroundMedia(cleanup: Promise<void>): void {
  (cleanup as NativeReleaseBarrier).releaseNativeSync?.(true);
}

interface SessionOptions<V extends SessionMedia, P extends SessionPlayer, C extends SessionController> {
  handle: string;
  source: SourceConfig;
  createVideo: () => V;
  installPolyfills: (video: V) => void;
  removePolyfills: (video: V) => void;
  createPlayer: () => P;
  createController: (player: P, isActive: () => boolean) => C;
  observePlayer?: (player: P, isActive: () => boolean) => () => void;
  controllerRef: { current: C | null };
  getTimeShiftEnabled: () => boolean;
  onError: (message: string) => void;
  after?: Promise<void>;
}

export function startVegaSession<V extends SessionMedia, P extends SessionPlayer, C extends SessionController>(
  options: SessionOptions<V, P, C>,
): { ready: Promise<void>; dispose: (background?: boolean) => Promise<void> } {
  let video: V | null = null;
  let player: P | null = null;
  let controller: C | null = null;
  let initializing: Promise<unknown> | null = null;
  let initialized = false;
  let surfaceAttached = false;
  let cancelled = false;
  let cleanup: Promise<void> | null = null;
  let removePlayerObservers: (() => void) | null = null;

  function dispose(background = false): Promise<void> {
    if (cleanup) return cleanup;
    cancelled = true;
    // A cancelled waiter owns no resources. Reuse the previous barrier instead of extending a queue.
    if (!video) {
      cleanup = options.after ?? Promise.resolve();
      return cleanup;
    }
    let resolveCleanup!: () => void;
    const barrier: NativeReleaseBarrier & { retainedOwner?: { video: V; player: P | null; controller: C | null } } =
      Object.assign(new Promise<void>((resolve) => { resolveCleanup = resolve; }), {
        retainedOwner: { video, player, controller },
      });
    // Install the owner-bearing barrier before native calls can synchronously reenter disposal.
    cleanup = barrier;
    const retiringVideo = video;
    let nativeRelease: boolean | undefined;
    barrier.releaseNativeSync = (resetMedia = false) => {
      if (nativeRelease !== undefined) return nativeRelease;
      nativeRelease = false;
      const initializationConfirmed = initialized;
      try { if (surfaceAttached) retiringVideo.clearSurfaceHandle(options.handle); }
      catch { options.onError("Vega surface cleanup failed"); }
      if (resetMedia && initializationConfirmed) {
        // The public source setter synchronously detaches MSE before native release.
        // Its empty-source event belongs to the already-retired owner, not the current UI.
        try { retiringVideo.src = ""; }
        catch { options.onError("Vega media source reset failed"); }
      }
      // The 1000 ms deadline is this app's policy, not an SDK default.
      let released = false;
      try { released = retiringVideo.deinitializeSync(1000) === "success"; }
      catch { /* A thrown native release is unconfirmed, just like a non-success status. */ }
      if (!released) {
        // A failed sync call may discard its handle, so retrying cannot confirm release.
        options.onError("Vega media cleanup unconfirmed; restart the app before playing again");
        return false;
      }
      if (!initializationConfirmed) {
        // Abort success acknowledges cancellation. Late native allocation is destroyed
        // asynchronously by the package without an exposed completion acknowledgement.
        options.onError("Vega initialization cancellation unconfirmed; restart the app before playing again");
        return false;
      }
      nativeRelease = true;
      return true;
    };
    if (background) barrier.releaseNativeSync(true);
    // Clear only this effect's controller; an older cleanup cannot clear a newer owner.
    if (controller && options.controllerRef.current === controller) options.controllerRef.current = null;
    try { removePlayerObservers?.(); }
    catch { options.onError("Vega observer cleanup failed"); }
    removePlayerObservers = null;
    try { controller?.dispose(); }
    catch { options.onError("Vega controller cleanup failed"); }

    // The Web SDK's asynchronous stop sequence still needs valid media during foreground Apply.
    // Background explicitly escalates this same barrier before KeplerScript can suspend.
    const destroyFailed = () => {
      options.onError("Vega player cleanup unconfirmed; restart the app before playing again");
      return false;
    };
    let destroyed: Promise<boolean>;
    try { destroyed = Promise.resolve(player?.destroy()).then(() => true, destroyFailed); }
    catch { destroyed = Promise.resolve(destroyFailed()); }
    void (async () => {
      // Foreground source changes can wait for initialization; background release remains synchronous.
      await initializing?.catch(() => {});
      // Native release alone does not confirm that the Web SDK stopped using the global shim.
      const sdkReleased = await destroyed;
      const nativeReleased = barrier.releaseNativeSync!();
      if (!sdkReleased || !nativeReleased) return;
      try { if (video) options.removePolyfills(video); }
      catch { options.onError("Vega media shim cleanup failed"); }
      controller = null;
      player = null;
      video = null;
      delete barrier.retainedOwner;
      delete barrier.releaseNativeSync;
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
    initialized = true;
    if (cancelled) return;
    // The native setter caches the handle before its bridge call, which can throw after mutation.
    surfaceAttached = true;
    video.setSurfaceHandle(options.handle);
    options.installPolyfills(video);
    player = options.createPlayer();
    removePlayerObservers = options.observePlayer?.(player, () => !cancelled) ?? null;
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
