import type { SourceConfig } from "bitmovin-player";

interface SessionMedia {
  initialize(): void | Promise<unknown>;
  deinitialize(): void | Promise<unknown>;
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
  let cancelled = false;
  let cleanup: Promise<void> | null = null;

  function dispose(): Promise<void> {
    if (cleanup) return cleanup;
    cancelled = true;
    // Clear only this effect's controller; an older cleanup cannot clear a newer owner.
    if (controller && options.controllerRef.current === controller) options.controllerRef.current = null;
    try { controller?.dispose(); }
    catch { options.onError("Vega controller cleanup failed"); }
    // A cancelled waiter owns no resources. Reuse the previous barrier instead of extending a queue.
    if (!video) {
      cleanup = options.after ?? Promise.resolve();
      return cleanup;
    }
    cleanup = (async () => {
      // Initialization cannot be cancelled. Release its media only after that call settles.
      await initializing?.catch(() => {});
      try { await player?.destroy(); }
      catch { options.onError("Vega player cleanup failed"); }
      try { await video?.deinitialize(); }
      catch { options.onError("Vega media cleanup failed"); }
      try { video?.clearSurfaceHandle(""); }
      catch { options.onError("Vega surface cleanup failed"); }
      try { if (video) options.removePolyfills(video); }
      catch { options.onError("Vega media shim cleanup failed"); }
      controller = null;
      player = null;
      video = null;
    })();
    return cleanup;
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
