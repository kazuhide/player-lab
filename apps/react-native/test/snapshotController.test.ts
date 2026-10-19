import { describe, expect, it, vi } from "vitest";
import { SnapshotController, type SnapshotPlayer } from "../src/dvr/snapshotController";
import type { DvrState } from "../src/dvr/state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const player: SnapshotPlayer = {
    isLive: vi.fn(async () => true),
    getDuration: vi.fn(async () => Infinity),
    getMaxTimeShift: vi.fn(async () => -300),
    getTimeShift: vi.fn(async () => -10),
    getCurrentTime: vi.fn(async () => 1000),
    timeShift: vi.fn(),
  };
  const states: DvrState[] = [];
  const logs: string[] = [];
  const controller = new SnapshotController(player, (state) => states.push(state), (line) => logs.push(line));
  return { player, states, logs, controller };
}

describe("snapshot refresh ordering", () => {
  it("coalesces a burst into one pending refresh while publishing valid reads in order", async () => {
    const { player, states, controller } = fixture();
    const oldOffset = deferred<number>();
    vi.mocked(player.getTimeShift).mockReturnValueOnce(oldOffset.promise);
    const first = controller.refresh();
    const pending = Array.from({ length: 100 }, () => controller.refresh());
    expect(player.isLive).toHaveBeenCalledTimes(1);
    oldOffset.resolve(-40);
    await Promise.all([first, ...pending]);
    expect(player.isLive).toHaveBeenCalledTimes(2);
    expect(states.map((state) => state.behindLive)).toEqual([40, 10]);
  });

  it("publishes continuously even when every read receives another refresh request", async () => {
    const { player, states, controller } = fixture();
    const offsets = Array.from({ length: 6 }, () => deferred<number>());
    let read = 0;
    vi.mocked(player.getTimeShift).mockImplementation(() => offsets[read++]!.promise);
    const completion = controller.refresh();
    try {
      for (let batch = 0; batch < 5; batch++) {
        void controller.refresh();
        offsets[batch]!.resolve(-40 + batch);
        await nextTurn();
        expect(states).toHaveLength(batch + 1);
        expect(player.isLive).toHaveBeenCalledTimes(batch + 2);
      }
    } finally {
      offsets.forEach((offset) => offset.resolve(-10));
      await completion;
    }
    expect(states.map((state) => state.behindLive)).toEqual([40, 39, 38, 37, 36, 10]);
  });

  it("drains a refresh queued after the final read but before its completion cleanup", async () => {
    const { player } = fixture();
    let queued: Promise<void> | undefined;
    let updates = 0;
    const controller = new SnapshotController(player, () => {
      if (++updates === 1) {
        void Promise.resolve().then(() => { queued = controller.refresh(); });
      }
    }, () => {});
    await controller.refresh();
    expect(queued).toBeDefined();
    await queued;
    expect(player.isLive).toHaveBeenCalledTimes(2);
    expect(updates).toBe(2);
  });

  it("handles a rejected SDK read and preserves the last good state", async () => {
    const { player, states, logs, controller } = fixture();
    await controller.refresh();
    vi.mocked(player.getDuration).mockRejectedValueOnce(new Error("native read rejected"));
    await expect(controller.refresh()).resolves.toBeUndefined();
    expect(states).toHaveLength(1);
    expect(logs).toContain("Snapshot read failed");
    await controller.refresh();
    expect(states).toHaveLength(2);
  });

  it.each(["source", "dispose"] as const)("ignores old snapshots and recovery after %s invalidation", async (reason) => {
    const { player, states, logs, controller } = fixture();
    const oldOffset = deferred<number>();
    vi.mocked(player.getTimeShift).mockReturnValueOnce(oldOffset.promise);
    const read = controller.refresh();
    if (reason === "source") controller.sourceChanged();
    else controller.dispose();
    oldOffset.resolve(-500);
    await read;
    expect(states).toEqual([]);
    expect(logs).toEqual([]);
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("updates the cached display immediately when DVR is disabled while paused", async () => {
    const { states, controller } = fixture();
    await controller.refresh();
    controller.setTimeShiftEnabled(false);
    expect(states[states.length - 1]?.mode).toBe("live-no-dvr");
    expect(states[states.length - 1]?.dvrAvailable).toBe(false);
    controller.setTimeShiftEnabled(true);
    expect(states[states.length - 1]?.dvrAvailable).toBe(true);
  });

  it("does not let an in-flight read restore the previous DVR flag", async () => {
    const { player, states, controller } = fixture();
    await controller.refresh();
    const offset = deferred<number>();
    vi.mocked(player.getTimeShift).mockReturnValueOnce(offset.promise);
    const read = controller.refresh();
    controller.setTimeShiftEnabled(false);
    offset.resolve(-500);
    await read;
    expect(states.map((state) => state.dvrAvailable)).toEqual([true, false]);
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("waits for the rest of a rejected batch before starting a queued refresh", async () => {
    const { player, controller } = fixture();
    const offset = deferred<number>();
    vi.mocked(player.getDuration).mockRejectedValueOnce(new Error("native read rejected"));
    vi.mocked(player.getTimeShift).mockReturnValueOnce(offset.promise);
    const first = controller.refresh();
    const queued = controller.refresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(player.isLive).toHaveBeenCalledTimes(1);
    offset.resolve(-10);
    await Promise.all([first, queued]);
    expect(player.isLive).toHaveBeenCalledTimes(2);
  });

  it("does not issue reads after disposal", async () => {
    const { player, controller } = fixture();
    controller.dispose();
    await controller.refresh();
    await controller.seek(-30);
    expect(player.isLive).not.toHaveBeenCalled();
    expect(player.getMaxTimeShift).not.toHaveBeenCalled();
  });

  it("publishes only the new source when an old read is still pending", async () => {
    const { player, states, controller } = fixture();
    const oldOffset = deferred<number>();
    vi.mocked(player.getTimeShift).mockReturnValueOnce(oldOffset.promise);
    const old = controller.refresh();
    controller.sourceChanged();
    const current = controller.refresh();
    oldOffset.resolve(-500);
    await Promise.all([old, current]);
    expect(states.map((state) => state.behindLive)).toEqual([10]);
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("still recovers an expired position from a current valid snapshot", async () => {
    const { player, logs, states, controller } = fixture();
    vi.mocked(player.getTimeShift).mockResolvedValueOnce(-500);
    await controller.refresh();
    expect(player.timeShift).toHaveBeenCalledWith(0);
    expect(logs).toEqual(["DVR window exceeded → recover"]);
    expect(states[0]?.behindLive).toBe(300);
  });
});

describe("snapshot-based seeks", () => {
  it.each(["source", "dispose", "flag"] as const)("does not seek after %s invalidation", async (reason) => {
    const { player, controller } = fixture();
    const max = deferred<number>();
    vi.mocked(player.getMaxTimeShift).mockReturnValueOnce(max.promise);
    const seek = controller.seek(-60);
    if (reason === "source") controller.sourceChanged();
    else if (reason === "dispose") controller.dispose();
    else controller.setTimeShiftEnabled(false);
    max.resolve(-300);
    await seek;
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("keeps the latest seek when native reads finish in reverse order", async () => {
    const { player, controller } = fixture();
    const oldMax = deferred<number>();
    vi.mocked(player.getMaxTimeShift).mockReturnValueOnce(oldMax.promise);
    const first = controller.seek(-60);
    await controller.seek(-10);
    oldMax.resolve(-300);
    await first;
    expect(player.timeShift).toHaveBeenCalledTimes(1);
    expect(player.timeShift).toHaveBeenCalledWith(-10);
  });

  it("handles rejected seek reads", async () => {
    const { player, logs, controller } = fixture();
    vi.mocked(player.getMaxTimeShift).mockRejectedValueOnce(new Error("native read rejected"));
    await expect(controller.seek(-10)).resolves.toBeUndefined();
    expect(player.timeShift).not.toHaveBeenCalled();
    expect(logs).toEqual(["Seek read failed"]);
  });
});
import { setImmediate as nextTurn } from "node:timers/promises";
