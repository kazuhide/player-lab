import { describe, expect, it, vi } from "vitest";
import type { Player } from "bitmovin-player-react-native";
import type { NativeSettings } from "../src/nativeSettings";
import { NativeOperationContext, operationUnavailable } from "../src/operationAvailability";

function fixture() {
  const source = { isInitialized: true, isDestroyed: false, loadingState: vi.fn(async () => 2) };
  const player = { source, isDestroyed: false, isLive: vi.fn(async () => false), getMaxTimeShift: vi.fn(async () => 0),
    isAd: vi.fn(async () => false), isCastAvailable: vi.fn(async () => false), isCasting: vi.fn(async () => false) };
  const context = new NativeOperationContext(player as unknown as Player);
  const settings = { player: {}, source: {} } as NativeSettings;
  const reason = (id: string, platform = "android", allowed = true, values: Record<string, string> = {}) =>
    operationUnavailable(id, player as unknown as Player, context.snapshot(), platform, settings, allowed, values);
  return { source, player, context, settings, reason };
}

describe("native operation availability", () => {
  it("rejects ordinary-source ad operations while retaining load/bootstrap and explicit clearing", async () => {
    const f = fixture(); await f.context.refresh();
    expect(f.reason("Player.skipAd")).toBe("No active ad is available to skip.");
    expect(f.reason("Player.scheduleAd")).toBe("Apply an advertising schedule first.");
    expect(f.reason("Player.setSubtitleTrack", "android", true, { value: "" })).toBeUndefined();
    expect(f.reason("Player.setMaxSelectableBitrate", "android", true, { value: "" })).toBeUndefined();
    Reflect.deleteProperty(f.player, "source"); f.context.reset();
    for (const id of ["Player.load", "Player.loadSource", "Player.loadOfflineContent", "Player.initialize", "OfflineContentManager.initialize"]) expect(f.reason(id)).toBeUndefined();
    expect(f.reason("Player.play")).toBe("Wait for a loaded source.");
    expect(f.reason("Source.metadata")).toBe("Load a source first.");
  });

  it("uses native live state, DVR depth and the host preference while retaining go-to-edge", async () => {
    const f = fixture(); await f.context.refresh();
    expect(f.reason("Player.seek")).toBeUndefined();
    expect(f.reason("Player.timeShift")).toBe("Time shift requires a live source.");
    f.player.isLive.mockResolvedValue(true); f.player.getMaxTimeShift.mockResolvedValue(-120); await f.context.refresh();
    expect(f.reason("Player.seek")).toBe("Seek requires an on-demand source.");
    expect(f.reason("Player.timeShift", "android", true, { value: "-10" })).toBeUndefined();
    expect(f.reason("Player.timeShift", "android", false, { value: "-10" })).toBe("Live rewind is unavailable for this source or setting.");
    expect(f.reason("Player.timeShift", "android", false, { value: "0" })).toBeUndefined();
    f.player.isLive.mockResolvedValue(false); await f.context.refresh();
    expect(f.reason("Player.seek", "android", false)).toBeUndefined();
  });

  it("retains native offline playback whose pinned wrapper does not construct a Source object", async () => {
    const f = fixture(); await f.context.refresh();
    f.context.reset(true);
    Reflect.deleteProperty(f.player, "source");
    f.context.event("onSourceUnloaded"); f.context.event("onSourceLoad"); f.context.event("onSourceLoaded");
    await f.context.refresh();
    expect(f.reason("Player.play")).toBeUndefined();
    expect(f.reason("Player.seek")).toBeUndefined();
    expect(f.reason("Source.metadata")).toBe("Load a source first.");
    f.context.event("onSourceUnloaded");
    expect(f.reason("Player.play")).toBe("Wait for a loaded source.");
  });

  it("distinguishes linear interruptions from pause ads whose isAd getter is false", async () => {
    const f = fixture(); await f.context.refresh();
    f.player.isAd.mockResolvedValue(true); f.context.event("onAdStarted"); await f.context.refresh();
    expect(f.reason("Player.skipAd")).toBeUndefined();
    expect(f.reason("Player.seek")).toBe("Wait for the linear ad to finish.");
    f.player.isAd.mockResolvedValue(false); f.context.event("onAdFinished"); f.context.event("onNonLinearAdStarted"); await f.context.refresh();
    expect(f.reason("Player.skipAd")).toBeUndefined();
    expect(f.reason("Player.seek")).toBeUndefined();
    f.context.event("onNonLinearAdSkipped");
    expect(f.reason("Player.skipAd")).toBe("No active ad is available to skip.");
  });

  it("rejects unsupported platform, Analytics and Cast actions", async () => {
    const f = fixture(); await f.context.refresh();
    expect(f.reason("Player.showAirPlayTargetPicker")).toBe("This operation requires iOS.");
    expect(f.reason("BitmovinCastManager.updateContext", "ios")).toBe("This operation requires Android.");
    expect(f.reason("Source.drm.fairplay.renewExpiringLicense")).toBe("This operation requires iOS.");
    expect(f.reason("Player.analytics.getUserId")).toBe("Configure Analytics before creating this player.");
    expect(f.reason("Player.castVideo")).toBe("No Cast receiver is available.");
    expect(f.reason("Player.castStop")).toBe("No Cast session is active.");
    expect(f.reason("BitmovinCastManager.sendMessage")).toBe("No Cast session is active.");
  });

  it.each(["reset", "retire", "source replacement"])("discards delayed capability reads after %s", async action => {
    const f = fixture();
    let resolve!: (value: boolean) => void;
    f.player.isLive.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    const pending = f.context.refresh();
    if (action === "source replacement") f.player.source = { ...f.source };
    else f.context[action as "reset" | "retire"]();
    resolve(false);
    expect(await pending).toBe(false);
    expect(f.context.snapshot().loaded).toBe(false);
  });

  it("does not overwrite a newer ad lifecycle event with an older native read", async () => {
    const f = fixture(); await f.context.refresh();
    let resolve!: (value: boolean) => void;
    f.player.isAd.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    const pending = f.context.refresh(); f.context.event("onAdStarted"); resolve(false);
    expect(await pending).toBe(false);
    expect(f.reason("Player.seek")).toBe("Wait for the linear ad to finish.");
  });

  it("bounds event reads and starts a fresh native batch for explicit dispatch", async () => {
    const f = fixture();
    let resolve!: (value: boolean) => void;
    f.player.isLive.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
    const first = f.context.refresh();
    for (let index = 0; index < 40; index++) expect(f.context.refresh()).toBe(first);
    const dispatch = f.context.refresh(true);
    expect(f.player.isLive).toHaveBeenCalledTimes(1);
    resolve(false); await dispatch;
    expect(f.player.isLive).toHaveBeenCalledTimes(2);
  });
});
