import type { PlayerAPI } from "bitmovin-player";
import { describe, expect, it, vi } from "vitest";
import { PlaybackController } from "../src/playbackController";

// Keep the native-player boundary outside Node; the controller itself runs unchanged.
vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  PlayerEvent: {
    TimeChanged: "timechanged",
    SourceLoaded: "sourceloaded",
    TimeShifted: "timeshifted",
    DurationChanged: "durationchanged",
    DVRWindowExceeded: "dvrwindowexceeded",
  },
}));

function fixture() {
  const handlers = new Map<string, () => void>();
  const player = {
    on: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
    off: vi.fn((event: string) => { handlers.delete(event); }),
    isLive: () => true,
    getDuration: () => Infinity,
    getMaxTimeShift: () => -300,
    getTimeShift: () => -30,
    getCurrentTime: vi.fn(() => 1000),
    timeShift: vi.fn(),
  };
  const update = vi.fn();
  const controller = new PlaybackController(player as unknown as PlayerAPI, update);
  return { player, handlers, update, controller };
}

describe("Playback controller ownership", () => {
  it("publishes SDK playback progress and stops publishing after disposal", () => {
    const { handlers, player, update, controller } = fixture();
    const refresh = handlers.get("timechanged")!;
    refresh();
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 1000 }), undefined);
    player.getCurrentTime.mockReturnValue(1005);
    refresh();
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 1005 }), undefined);
    controller.dispose();
    refresh();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("ignores events already queued when its session is disposed", () => {
    const { handlers, player, update, controller } = fixture();
    const refresh = handlers.get("timechanged")!;
    const recover = handlers.get("dvrwindowexceeded")!;
    controller.dispose();
    refresh();
    recover();
    expect(update).not.toHaveBeenCalled();
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("does not emit or seek through a stale controller reference", () => {
    const { player, update, controller } = fixture();
    controller.dispose();
    controller.setTimeShiftEnabled(false);
    controller.seek(-60);
    controller.goToLiveEdge();
    expect(update).not.toHaveBeenCalled();
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("removes subscriptions once and applies the disabled flag to the real controller", () => {
    const { player, update, controller } = fixture();
    controller.setTimeShiftEnabled(false);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "live-no-dvr", dvrAvailable: false }), undefined);
    controller.seek(-60);
    expect(player.timeShift).toHaveBeenCalledWith(0);
    controller.dispose();
    controller.dispose();
    expect(player.off).toHaveBeenCalledTimes(5);
  });
});
