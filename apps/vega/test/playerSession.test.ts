import { describe, expect, it, vi } from "vitest";
import { releaseVegaBackgroundMedia, startVegaSession } from "../src/playerSession";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const video = {
    src: "",
    initialize: vi.fn(async () => {}),
    deinitializeSync: vi.fn((_timeout: number): "success" | "timedout" | "invalid" => "success"),
    setSurfaceHandle: vi.fn(),
    clearSurfaceHandle: vi.fn(),
  };
  const player = { load: vi.fn(async () => {}), destroy: vi.fn(async () => {}) };
  const controller = { dispose: vi.fn(), setTimeShiftEnabled: vi.fn() };
  const controllerRef: { current: typeof controller | null } = { current: null };
  const options = {
    handle: "surface",
    source: { hls: "https://example.com/live.m3u8" },
    createVideo: vi.fn(() => video),
    installPolyfills: vi.fn(),
    removePolyfills: vi.fn(),
    createPlayer: vi.fn(() => player),
    createController: vi.fn(() => controller),
    controllerRef,
    getTimeShiftEnabled: () => true,
    onError: vi.fn(),
  };
  return { video, player, controller, controllerRef, options };
}

describe("Vega session ownership", () => {
  it("retires public player observers before destroy and acknowledges cleanup only after both SDK and native release", async () => {
    const old = fixture();
    const destroyed = deferred();
    old.player.destroy.mockReturnValueOnce(destroyed.promise);
    let active!: () => boolean;
    const remove = vi.fn(() => expect(active()).toBe(false));
    const session = startVegaSession({ ...old.options, observePlayer: (player, isActive) => {
      expect(player).toBe(old.player); active = isActive; return remove;
    } });
    await session.ready;
    expect(active()).toBe(true);
    const cleanup = session.dispose();
    const acknowledged = vi.fn();
    void cleanup.then(acknowledged);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(old.player.destroy.mock.invocationCallOrder[0]!);
    await Promise.resolve();
    expect(acknowledged).not.toHaveBeenCalled();
    destroyed.resolve(); await cleanup;
    expect(old.video.deinitializeSync).toHaveReturnedWith("success");
    expect(acknowledged).toHaveBeenCalledTimes(1);
    await session.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it("keeps native media valid until ordinary foreground SDK destruction fulfills", async () => {
    const { options, video, player } = fixture();
    const reset = vi.fn();
    Object.defineProperty(video, "src", { set: reset });
    const destroyed = deferred();
    player.destroy.mockReturnValueOnce(destroyed.promise);
    const session = startVegaSession(options);
    await session.ready;
    const cleanup = session.dispose();
    expect(video.clearSurfaceHandle).not.toHaveBeenCalled();
    expect(video.deinitializeSync).not.toHaveBeenCalled();
    const next = fixture();
    const replacement = startVegaSession({ ...next.options, after: cleanup });
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    destroyed.resolve();
    await replacement.ready;
    expect(video.clearSurfaceHandle).toHaveBeenCalledWith("surface");
    expect(video.deinitializeSync).toHaveBeenCalledWith(1000);
    expect(player.destroy.mock.invocationCallOrder[0]).toBeLessThan(video.clearSurfaceHandle.mock.invocationCallOrder[0]!);
    expect(video.clearSurfaceHandle.mock.invocationCallOrder[0]).toBeLessThan(video.deinitializeSync.mock.invocationCallOrder[0]!);
    expect(reset).not.toHaveBeenCalled();
    await replacement.dispose();
  });

  it("resets retired media before synchronous background release and waits for the SDK acknowledgement", async () => {
    const old = fixture();
    const destroyed = deferred();
    old.player.destroy.mockReturnValueOnce(destroyed.promise);
    let attached = true;
    let active!: () => boolean;
    const reset = vi.fn((value: string) => {
      expect(value).toBe("");
      expect(active()).toBe(false);
      attached = false;
    });
    Object.defineProperty(old.video, "src", { set: reset });
    old.video.deinitializeSync.mockImplementation(() => attached ? "timedout" : "success");
    const session = startVegaSession({ ...old.options, createController: (_player, isActive) => {
      active = isActive;
      return old.controller;
    } });
    await session.ready;
    const cleanup = session.dispose(true);
    expect(reset).toHaveBeenCalledExactlyOnceWith("");
    expect(old.video.deinitializeSync).toHaveBeenCalledExactlyOnceWith(1000);
    expect(old.video.deinitializeSync.mock.results[0]!.value).toBe("success");
    expect(reset.mock.invocationCallOrder[0]).toBeLessThan(old.video.deinitializeSync.mock.invocationCallOrder[0]!);
    expect(old.video.deinitializeSync.mock.invocationCallOrder[0]).toBeLessThan(old.controller.dispose.mock.invocationCallOrder[0]!);
    expect(old.controller.dispose.mock.invocationCallOrder[0]).toBeLessThan(old.player.destroy.mock.invocationCallOrder[0]!);
    expect(old.options.removePolyfills).not.toHaveBeenCalled();
    const next = fixture();
    const replacement = startVegaSession({ ...next.options, after: cleanup });
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    destroyed.resolve();
    await replacement.ready;
    expect(old.options.onError).not.toHaveBeenCalled();
    expect(old.options.source).toEqual({ hls: "https://example.com/live.m3u8" });
    expect(old.options.removePolyfills).toHaveBeenCalledWith(old.video);
    expect(cleanup).not.toHaveProperty("retainedOwner");
    await replacement.dispose();
  });

  it("synchronously releases the retiring owner through a cancelled waiter's barrier on background", async () => {
    const old = fixture();
    let attached = true;
    const reset = vi.fn(() => { attached = false; });
    Object.defineProperty(old.video, "src", { set: reset });
    old.video.deinitializeSync.mockImplementation(() => attached ? "timedout" : "success");
    const destroyed = deferred();
    old.player.destroy.mockReturnValueOnce(destroyed.promise);
    const a = startVegaSession(old.options);
    await a.ready;
    const cleanup = a.dispose();
    const waiting = fixture();
    const b = startVegaSession({ ...waiting.options, after: cleanup });
    const waitingCleanup = b.dispose();
    expect(waitingCleanup).toBe(cleanup);
    expect(old.video.deinitializeSync).not.toHaveBeenCalled();
    releaseVegaBackgroundMedia(waitingCleanup);
    releaseVegaBackgroundMedia(waitingCleanup);
    expect(reset).toHaveBeenCalledExactlyOnceWith("");
    expect(old.video.clearSurfaceHandle).toHaveBeenCalledWith("surface");
    expect(old.video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(old.video.deinitializeSync.mock.results[0]!.value).toBe("success");
    expect(old.player.destroy).toHaveBeenCalledTimes(1);
    const next = fixture();
    const c = startVegaSession({ ...next.options, after: waitingCleanup });
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    destroyed.resolve();
    await c.ready;
    expect(waiting.options.createVideo).not.toHaveBeenCalled();
    await c.dispose();
  });

  it.each(["timedout", "invalid", "throw"] as const)("retains an unconfirmed owner and blocks replacement after %s", async (status) => {
    const { options, video, player } = fixture();
    if (status === "throw") video.deinitializeSync.mockImplementationOnce(() => { throw new Error("native release failed"); });
    else video.deinitializeSync.mockReturnValueOnce(status);
    const session = startVegaSession(options);
    await session.ready;
    const cleanup = session.dispose(true);
    expect(session.dispose()).toBe(cleanup);
    const next = fixture();
    startVegaSession({ ...next.options, after: cleanup });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(options.onError).toHaveBeenCalledWith("Vega media cleanup unconfirmed; restart the app before playing again");
    expect(next.options.createVideo).not.toHaveBeenCalled();
    expect(options.removePolyfills).not.toHaveBeenCalled();
    expect(cleanup).toHaveProperty("retainedOwner", { video, player, controller: expect.anything() });
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
  });

  it("reuses the installed owner barrier when the background source reset reenters disposal", async () => {
    const { options, video, player } = fixture();
    const session = startVegaSession(options);
    await session.ready;
    const reentrant: Promise<void>[] = [];
    const reset = vi.fn(() => { reentrant.push(session.dispose(true)); });
    Object.defineProperty(video, "src", { set: reset });
    const cleanup = session.dispose(true);
    expect(reset).toHaveBeenCalledExactlyOnceWith("");
    expect(reentrant).toEqual([cleanup]);
    await cleanup;
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
  });

  it("still releases native media after a partial background source reset throws", async () => {
    const { options, video, player } = fixture();
    const session = startVegaSession(options);
    await session.ready;
    const reset = vi.fn(() => { throw new Error("source reset failed after mutation"); });
    Object.defineProperty(video, "src", { set: reset });
    const cleanup = session.dispose(true);
    expect(reset).toHaveBeenCalledExactlyOnceWith("");
    expect(video.deinitializeSync).toHaveBeenCalledExactlyOnceWith(1000);
    await cleanup;
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith("Vega media source reset failed");
    expect(cleanup).not.toHaveProperty("retainedOwner");
  });

  it("installs the cleanup barrier before synchronous reentrant disposal", async () => {
    const { options, controller, video } = fixture();
    const session = startVegaSession(options);
    await session.ready;
    const reentrant: Promise<void>[] = [];
    controller.dispose.mockImplementationOnce(() => { reentrant.push(session.dispose()); });
    video.clearSurfaceHandle.mockImplementationOnce(() => { reentrant.push(session.dispose()); });
    video.deinitializeSync.mockImplementationOnce(() => { reentrant.push(session.dispose()); return "success"; });
    const cleanup = session.dispose();
    await cleanup;
    expect(reentrant).toEqual([cleanup, cleanup, cleanup]);
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveProperty("retainedOwner");
  });

  it.each(["success", "invalid"] as const)("retains unconfirmed initialization cancellation (%s) before installing the global shim", async (status) => {
    const { options, video } = fixture();
    const initialized = deferred();
    video.initialize.mockReturnValueOnce(initialized.promise);
    video.deinitializeSync.mockReturnValueOnce(status);
    const session = startVegaSession(options);
    const cleanup = session.dispose();
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle).not.toHaveBeenCalled();
    initialized.resolve();
    await session.ready;
    const next = fixture();
    startVegaSession({ ...next.options, after: cleanup });
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    expect(options.installPolyfills).not.toHaveBeenCalled();
    expect(cleanup).toHaveProperty("retainedOwner", { video, player: null, controller: null });
    expect(options.onError).toHaveBeenCalledWith(status === "success"
      ? "Vega initialization cancellation unconfirmed; restart the app before playing again"
      : "Vega media cleanup unconfirmed; restart the app before playing again");
  });

  it.each([false, true])("clears a partially attached surface and releases media when native attachment throws (clear fails: %s)", async (clearFails) => {
    const { options, video } = fixture();
    video.setSurfaceHandle.mockImplementationOnce(() => { throw new Error("native attachment failed after caching the handle"); });
    if (clearFails) video.clearSurfaceHandle.mockImplementationOnce(() => { throw new Error("native clear failed"); });
    const session = startVegaSession(options);
    await session.ready;
    await session.dispose();
    expect(video.clearSurfaceHandle).toHaveBeenCalledWith("surface");
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle.mock.invocationCallOrder[0]).toBeLessThan(video.deinitializeSync.mock.invocationCallOrder[0]!);
    expect(options.createPlayer).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledWith("Vega player setup failed");
    if (clearFails) expect(options.onError).toHaveBeenCalledWith("Vega surface cleanup failed");
    expect(options.removePolyfills).toHaveBeenCalledWith(video);
  });

  it("never creates or publishes a player when initialization finishes after cleanup", async () => {
    const { options, video, controllerRef } = fixture();
    const initialized = deferred();
    video.initialize.mockReturnValueOnce(initialized.promise);
    const session = startVegaSession(options);
    const disposed = session.dispose();
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle).not.toHaveBeenCalled();
    initialized.resolve();
    await session.ready;
    expect(options.createPlayer).not.toHaveBeenCalled();
    expect(controllerRef.current).toBeNull();
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(disposed).toHaveProperty("retainedOwner", { video, player: null, controller: null });
  });

  it("releases each owned player and media object once", async () => {
    const { options, player, video, controller } = fixture();
    const session = startVegaSession(options);
    await session.ready;
    await Promise.all([session.dispose(), session.dispose()]);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle).toHaveBeenCalledTimes(1);
  });

  it("blocks replacement after initialization abort even when its promise later settles", async () => {
    const old = fixture();
    const next = fixture();
    const initialized = deferred();
    old.video.initialize.mockReturnValueOnce(initialized.promise);
    const a = startVegaSession(old.options);
    const cleanup = a.dispose();
    expect(old.video.deinitializeSync).toHaveBeenCalledTimes(1);
    const b = startVegaSession({ ...next.options, after: cleanup });
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    initialized.resolve();
    await a.ready;
    expect(old.options.createPlayer).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    expect(next.controllerRef.current).toBeNull();
    expect(a.dispose()).toBe(cleanup);
    expect(b.dispose()).toBe(cleanup);
    expect(old.options.onError).toHaveBeenCalledWith("Vega initialization cancellation unconfirmed; restart the app before playing again");
  });

  it.each([true, false])("keeps the new owner when old load settles %s before destruction", async (loadFirst) => {
    const old = fixture();
    const next = fixture();
    const loaded = deferred();
    const destroyed = deferred();
    old.player.load.mockReturnValueOnce(loaded.promise);
    old.player.destroy.mockReturnValueOnce(destroyed.promise);
    const a = startVegaSession(old.options);
    await Promise.resolve();
    expect(old.player.load).toHaveBeenCalledTimes(1);
    const cleanup = a.dispose();
    const b = startVegaSession({ ...next.options, controllerRef: old.controllerRef, after: cleanup });
    expect(old.controllerRef.current).toBeNull();
    if (loadFirst) {
      loaded.resolve();
      await a.ready;
      expect(next.options.createVideo).not.toHaveBeenCalled();
    }
    expect(old.video.deinitializeSync).not.toHaveBeenCalled();
    destroyed.resolve();
    await b.ready;
    expect(old.controllerRef.current).toBe(next.controller);
    if (!loadFirst) {
      loaded.reject(new Error("old load aborted"));
      await a.ready;
    }
    expect(old.controllerRef.current).toBe(next.controller);
    expect(old.options.onError).not.toHaveBeenCalled();
    expect(old.player.destroy).toHaveBeenCalledTimes(1);
    expect(old.video.deinitializeSync).toHaveBeenCalledTimes(1);
    await b.dispose();
  });

  it("reuses the unconfirmed initialization barrier for rapid cancelled source changes", async () => {
    const first = fixture();
    const initialized = deferred();
    first.video.initialize.mockReturnValueOnce(initialized.promise);
    const a = startVegaSession(first.options);
    const cleanup = a.dispose();
    for (let i = 0; i < 100; i++) {
      const cancelled = fixture();
      const waiter = startVegaSession({ ...cancelled.options, after: cleanup });
      expect(waiter.dispose()).toBe(cleanup);
      expect(cancelled.options.createVideo).not.toHaveBeenCalled();
    }
    const latest = fixture();
    const b = startVegaSession({ ...latest.options, after: cleanup });
    initialized.resolve();
    await a.ready;
    await Promise.resolve();
    expect(first.options.createPlayer).not.toHaveBeenCalled();
    expect(latest.options.createVideo).not.toHaveBeenCalled();
    expect(b.dispose()).toBe(cleanup);
  });

  it.each(["initialize", "load"] as const)("cleans up after a rejected %s", async (step) => {
    const { options, video, player, controllerRef } = fixture();
    const failure = new Error("setup rejected");
    if (step === "initialize") video.initialize.mockRejectedValueOnce(failure);
    else player.load.mockRejectedValueOnce(failure);
    const session = startVegaSession(options);
    if (step === "load") {
      await expect(session.ready).resolves.toBeUndefined();
      await session.dispose();
    } else {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const cleanup = session.dispose();
      expect(cleanup).toHaveProperty("retainedOwner", { video, player: null, controller: null });
      expect(options.onError).toHaveBeenCalledWith("Vega initialization cancellation unconfirmed; restart the app before playing again");
    }
    expect(controllerRef.current).toBeNull();
    expect(options.onError).toHaveBeenCalledWith("Vega player setup failed");
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(player.destroy).toHaveBeenCalledTimes(step === "load" ? 1 : 0);
  });

  it("releases native media but retains the SDK owner when player destruction rejects", async () => {
    const { options, player, video } = fixture();
    player.destroy.mockRejectedValueOnce(new Error("destroy rejected"));
    const session = startVegaSession(options);
    await session.ready;
    const cleanup = session.dispose();
    const next = fixture();
    startVegaSession({ ...next.options, after: cleanup });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(options.onError).toHaveBeenCalledWith("Vega player cleanup unconfirmed; restart the app before playing again");
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle).toHaveBeenCalledTimes(1);
    expect(options.removePolyfills).not.toHaveBeenCalled();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    expect(cleanup).toHaveProperty("retainedOwner", { video, player, controller: expect.anything() });
  });

  it("applies the current DVR flag after initialization and on every new source", async () => {
    const first = fixture();
    const initialized = deferred();
    let allowed = true;
    first.video.initialize.mockReturnValueOnce(initialized.promise);
    const a = startVegaSession({ ...first.options, getTimeShiftEnabled: () => allowed });
    allowed = false;
    initialized.resolve();
    await a.ready;
    expect(first.controller.setTimeShiftEnabled).toHaveBeenCalledWith(false);
    const cleanup = a.dispose();
    const next = fixture();
    const b = startVegaSession({ ...next.options, after: cleanup, getTimeShiftEnabled: () => allowed });
    await b.ready;
    expect(next.controller.setTimeShiftEnabled).toHaveBeenCalledWith(false);
    await b.dispose();
  });

  it("invalidates controller callbacks synchronously before asynchronous destruction", async () => {
    const { options, player } = fixture();
    const destroyed = deferred();
    player.destroy.mockReturnValueOnce(destroyed.promise);
    let active!: () => boolean;
    const session = startVegaSession({ ...options, createController: (p, isActive) => {
      active = isActive;
      return options.createController();
    } });
    await session.ready;
    expect(active()).toBe(true);
    const cleanup = session.dispose();
    expect(active()).toBe(false);
    destroyed.resolve();
    await cleanup;
  });
});
