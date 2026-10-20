import { describe, expect, it, vi } from "vitest";
import { startVegaSession } from "../src/playerSession";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const video = {
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
  it("releases the attached native surface and media before waiting for SDK destruction", async () => {
    const { options, video, player } = fixture();
    const destroyed = deferred();
    player.destroy.mockReturnValueOnce(destroyed.promise);
    const session = startVegaSession(options);
    await session.ready;
    const cleanup = session.dispose();
    expect(video.clearSurfaceHandle).toHaveBeenCalledWith("surface");
    expect(video.deinitializeSync).toHaveBeenCalledWith(1000);
    expect(video.clearSurfaceHandle.mock.invocationCallOrder[0]).toBeLessThan(video.deinitializeSync.mock.invocationCallOrder[0]!);
    expect(video.deinitializeSync.mock.invocationCallOrder[0]).toBeLessThan(player.destroy.mock.invocationCallOrder[0]!);
    const next = fixture();
    const replacement = startVegaSession({ ...next.options, after: cleanup });
    await Promise.resolve();
    expect(next.options.createVideo).not.toHaveBeenCalled();
    destroyed.resolve();
    await replacement.ready;
    await replacement.dispose();
  });

  it.each(["timedout", "invalid", "throw"] as const)("retains an unconfirmed owner and blocks replacement after %s", async (status) => {
    const { options, video, player } = fixture();
    if (status === "throw") video.deinitializeSync.mockImplementationOnce(() => { throw new Error("native release failed"); });
    else video.deinitializeSync.mockReturnValueOnce(status);
    const session = startVegaSession(options);
    await session.ready;
    const cleanup = session.dispose();
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

  it("installs the cleanup barrier before synchronous reentrant disposal", async () => {
    const { options, controller, video } = fixture();
    const session = startVegaSession(options);
    await session.ready;
    const reentrant: Promise<void>[] = [];
    controller.dispose.mockImplementationOnce(() => { reentrant.push(session.dispose()); });
    video.clearSurfaceHandle.mockImplementationOnce(() => { reentrant.push(session.dispose()); });
    video.deinitializeSync.mockImplementationOnce(() => { reentrant.push(session.dispose()); return "success"; });
    const cleanup = session.dispose();
    expect(reentrant).toEqual([cleanup, cleanup, cleanup]);
    await cleanup;
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveProperty("retainedOwner");
  });

  it("retains unconfirmed media even before installing the global shim", async () => {
    const { options, video } = fixture();
    const initialized = deferred();
    video.initialize.mockReturnValueOnce(initialized.promise);
    video.deinitializeSync.mockReturnValueOnce("invalid");
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
    expect(options.onError).toHaveBeenCalledWith("Vega media cleanup unconfirmed; restart the app before playing again");
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
    await Promise.all([session.ready, disposed]);
    expect(options.createPlayer).not.toHaveBeenCalled();
    expect(controllerRef.current).toBeNull();
    expect(video.deinitializeSync).toHaveBeenCalledTimes(1);
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

  it("cancels initialization synchronously and waits for it to settle before creating the replacement", async () => {
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
    await b.ready;
    expect(next.controllerRef.current).toBe(next.controller);
    await a.dispose();
    expect(next.controllerRef.current).toBe(next.controller);
    await b.dispose();
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
    expect(old.video.deinitializeSync).toHaveBeenCalledTimes(1);
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

  it("reuses the pending cleanup barrier for rapid cancelled source changes", async () => {
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
    await b.ready;
    expect(first.options.createPlayer).not.toHaveBeenCalled();
    expect(latest.options.createPlayer).toHaveBeenCalledTimes(1);
    await b.dispose();
  });

  it.each(["initialize", "load"] as const)("cleans up after a rejected %s", async (step) => {
    const { options, video, player, controllerRef } = fixture();
    const failure = new Error("setup rejected");
    if (step === "initialize") video.initialize.mockRejectedValueOnce(failure);
    else player.load.mockRejectedValueOnce(failure);
    const session = startVegaSession(options);
    await expect(session.ready).resolves.toBeUndefined();
    await session.dispose();
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
