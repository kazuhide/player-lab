import { describe, expect, it, vi } from "vitest";
import type { Player } from "bitmovin-player-react-native";
import type { NativeSettings } from "../src/nativeSettings";
import { NativeOperationContext, operationUnavailable } from "../src/operationAvailability";

function fixture() {
  const source = { isInitialized: true, isDestroyed: false, loadingState: vi.fn(async (): Promise<unknown> => "LOADED") };
  const player = { source, isDestroyed: false, isLive: vi.fn(async () => false), getMaxTimeShift: vi.fn(async () => 0),
    getCurrentTime: vi.fn(async () => 0),
    getAvailableAudioTracks: vi.fn(async () => [{ identifier: "audio-a" }]),
    getAvailableSubtitles: vi.fn(async () => [{ identifier: "subtitle-a" }]),
    getAvailableVideoQualities: vi.fn(async () => [{ id: "quality-a" }]),
    isAd: vi.fn(async () => false), isCastAvailable: vi.fn(async () => false), isCasting: vi.fn(async () => false) };
  const context = new NativeOperationContext(player as unknown as Player);
  const settings = { player: {}, source: {} } as NativeSettings;
  const reason = (id: string, platform = "android", allowed = true, values?: Record<string, string>) =>
    operationUnavailable(id, player as unknown as Player, context.snapshot(), platform, settings, allowed, values);
  return { source, player, context, settings, reason };
}

describe("native operation availability", () => {
  it.each([
    ["Android loaded name", "LOADED", true], ["iOS loaded ordinal", 2, true],
    ["Android loading name", "LOADING", false], ["Android unloaded name", "UNLOADED", false],
    ["iOS loading ordinal", 1, false], ["iOS unloaded ordinal", 0, false],
    ["missing source", null, false], ["numeric string", "2", false], ["different name", "loaded", false],
  ])("uses the pinned native loading-state wire shape: %s", async (_name, wireValue, loaded) => {
    const f = fixture(); f.source.loadingState.mockResolvedValue(wireValue);
    await f.context.refresh();
    expect(f.context.snapshot().loaded).toBe(loaded);
    expect(f.reason("Player.play")).toBe(loaded ? undefined : "Wait for a loaded source.");
  });

  it.each([
    ["Player.setAudioTrack", "getAvailableAudioTracks", "audio-a", { identifier: "audio-b" }, "Choose an available audio track identifier."],
    ["Player.setSubtitleTrack", "getAvailableSubtitles", "subtitle-a", { identifier: "subtitle-b" }, "Choose an available subtitle identifier or leave it blank."],
    ["Player.setVideoQuality", "getAvailableVideoQualities", "quality-a", { id: "quality-b" }, "Choose an available quality ID or auto."],
  ] as const)("rejects a retained %s ID after replacing the source catalog", async (id, getter, oldId, replacement, expected) => {
    const f = fixture(); await f.context.refresh();
    expect(f.reason(id, "android", true, { value: oldId })).toBeUndefined();
    f.player.source = { ...f.source };
    f.player[getter].mockResolvedValue([replacement] as never);
    await f.context.refresh(true);
    expect(f.reason(id, "android", true, { value: oldId })).toBe(expected);
    const newId = "identifier" in replacement ? replacement.identifier : replacement.id;
    expect(f.reason(id, "android", true, { value: newId })).toBeUndefined();
  });

  it("retains subtitle clearing and Android auto quality without a selectable catalog", async () => {
    const f = fixture();
    f.player.getAvailableAudioTracks.mockResolvedValue([]);
    f.player.getAvailableSubtitles.mockResolvedValue([]);
    f.player.getAvailableVideoQualities.mockResolvedValue([]);
    await f.context.refresh();
    expect(f.reason("Player.setAudioTrack")).toBe("Choose an available audio track identifier.");
    expect(f.reason("Player.setSubtitleTrack")).toBeUndefined();
    expect(f.reason("Player.setSubtitleTrack", "android", true, { value: "" })).toBeUndefined();
    expect(f.reason("Player.setVideoQuality")).toBeUndefined();
    expect(f.reason("Player.setVideoQuality", "android", true, { value: "auto" })).toBeUndefined();
    expect(f.reason("Player.setVideoQuality", "ios", true, { value: "auto" })).toBe("This operation requires Android.");
  });

  it("keeps failed catalog reads unavailable without invalidating unrelated loaded-source operations", async () => {
    const f = fixture();
    f.player.getAvailableAudioTracks.mockRejectedValue(new Error("bridge read failed"));
    f.player.getAvailableSubtitles.mockRejectedValue(new Error("bridge read failed"));
    f.player.getAvailableVideoQualities.mockRejectedValue(new Error("bridge read failed"));
    expect(await f.context.refresh()).toBe(true);
    expect(f.reason("Player.play")).toBeUndefined();
    expect(f.reason("Player.setAudioTrack", "android", true, { value: "audio-a" })).toBe("Wait for the current audio track list.");
    expect(f.reason("Player.setSubtitleTrack", "android", true, { value: "subtitle-a" })).toBe("Wait for the current subtitle track list.");
    expect(f.reason("Player.setVideoQuality", "android", true, { value: "quality-a" })).toBe("Wait for the current video quality list.");
    expect(f.reason("Player.setSubtitleTrack", "android", true, { value: "" })).toBeUndefined();
    expect(f.reason("Player.setVideoQuality", "android", true, { value: "auto" })).toBeUndefined();
  });

  it.each(["reset", "retire", "source replacement"])("discards deferred catalog reads after %s", async action => {
    const f = fixture();
    let finish!: (value: { identifier: string }[]) => void;
    f.player.getAvailableAudioTracks.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.context.refresh();
    for (let turn = 0; turn < 8 && !finish; turn++) await Promise.resolve();
    expect(finish).toBeTypeOf("function");
    if (action === "source replacement") f.player.source = { ...f.source };
    else f.context[action as "reset" | "retire"]();
    finish([{ identifier: "stale-audio" }]);
    expect(await pending).toBe(false);
    expect(f.context.snapshot().loaded).toBe(false);
    expect(f.reason("Player.setAudioTrack", "android", true, { value: "stale-audio" })).toBeDefined();
  });

  it.each([["onSourceError", "LOADED"], ["onSourceError", 2], ["onPlayerError", "LOADED"], ["onPlayerError", 2]])("latches %s even when native loadingState remains %s", async (name, wireValue) => {
    const f = fixture(); f.source.loadingState.mockResolvedValue(wireValue); f.player.isLive.mockResolvedValue(true); await f.context.refresh();
    f.context.event(String(name));
    await f.context.refresh(true);
    expect(f.context.snapshot().loaded).toBe(false);
    const expected = name === "onSourceError" ? "Load a source again after the source error." : "Recreate the player after the player error.";
    expect(f.reason("Player.play")).toBe(expected);
    expect(f.reason("Player.timeShift", "android", true, { value: "-10" })).toBe(expected);
    for (const id of ["Player.load", "Player.loadSource", "Player.loadOfflineContent", "Player.initialize", "Player.destroy"])
      expect(f.reason(id)).toBeUndefined();
  });

  it.each(["onSourceLoad", "source replacement"])("recovers a source error only after %s", async action => {
    const f = fixture(); await f.context.refresh(); f.context.event("onSourceError");
    f.context.reset(); await f.context.refresh(true);
    expect(f.context.snapshot().loaded).toBe(false);
    if (action === "source replacement") f.player.source = { ...f.source };
    else f.context.event("onSourceLoad");
    await f.context.refresh(true);
    expect(f.reason("Player.play")).toBeUndefined();
  });

  it("keeps a player error latched across source recovery and replacement", async () => {
    const f = fixture(); await f.context.refresh(); f.context.event("onPlayerError");
    f.context.event("onSourceLoad"); f.context.event("onSourceLoaded"); await f.context.refresh(true);
    expect(f.reason("Player.play")).toBe("Recreate the player after the player error.");
    f.player.source = { ...f.source }; await f.context.refresh(true);
    expect(f.reason("Player.play")).toBe("Recreate the player after the player error.");
    const newPlayer = { ...f.player } as unknown as Player;
    const recreated = new NativeOperationContext(newPlayer);
    await recreated.refresh();
    expect(operationUnavailable("Player.play", newPlayer, recreated.snapshot(), "android", f.settings, true)).toBeUndefined();
  });

  it.each([
    ["unskippable", -1, 99, "bitmovin", "This ad does not allow skipping."],
    ["immediately skippable", 0, 0, "bitmovin", undefined],
    ["before threshold", 5, 4.99, "bitmovin", "Wait until the ad's skip offset is reached."],
    ["at threshold", 5, 5, "bitmovin", undefined],
    ["after threshold", 5, 6, "progressive", undefined],
    ["unknown threshold", undefined, 99, "bitmovin", "The current ad's skip metadata is unavailable."],
    ["invalid threshold", NaN, 99, "bitmovin", "The current ad's skip metadata is unavailable."],
    ["unknown native clock", 5, NaN, "bitmovin", "Wait for a current native ad position."],
    ["IMA UI", 0, 99, "ima", "Programmatic skipping is unavailable for IMA ads."],
    ["unknown ad client", 0, 99, "unknown", "The current ad's skip metadata is unavailable."],
  ])("qualifies actual skip capability for %s", async (_name, skipOffset, time, clientType, expected) => {
    const f = fixture(); await f.context.refresh();
    f.player.isAd.mockResolvedValue(true); f.player.getCurrentTime.mockResolvedValue(Number(time));
    f.context.event("onAdStarted", { skipOffset, clientType });
    await f.context.refresh(true);
    expect(f.reason("Player.skipAd")).toBe(expected);
  });

  it("never treats main-content time as the current ad's skip clock", async () => {
    const f = fixture(); await f.context.refresh();
    f.player.getCurrentTime.mockResolvedValue(100);
    f.context.event("onAdStarted", { skipOffset: 5, clientType: "bitmovin" });
    await f.context.refresh(true);
    expect(f.reason("Player.skipAd")).toBe("No active ad is available to skip.");
    expect(f.player.getCurrentTime).not.toHaveBeenCalled();
  });

  it("keeps unverified live time-mode offsets out of a positive ad threshold", async () => {
    const f = fixture(); await f.context.refresh();
    f.player.isLive.mockResolvedValue(true); f.player.isAd.mockResolvedValue(true); f.player.getCurrentTime.mockResolvedValue(1000000);
    f.context.event("onAdStarted", { skipOffset: 5, clientType: "bitmovin" });
    await f.context.refresh(true);
    expect(f.reason("Player.skipAd")).toBe("The live ad's playback position cannot be verified.");
    expect(f.player.getCurrentTime).not.toHaveBeenCalled();
    f.context.event("onAdStarted", { skipOffset: 0, clientType: "bitmovin" }); await f.context.refresh(true);
    expect(f.reason("Player.skipAd")).toBeUndefined();
  });

  it.each(["onAdFinished", "onAdSkipped", "onAdBreakFinished", "onAdError", "onSourceError"])("clears the current ad capability on %s", async name => {
    const f = fixture(); await f.context.refresh(); f.player.isAd.mockResolvedValue(true);
    f.context.event("onAdStarted", { skipOffset: 0, clientType: "bitmovin" }); await f.context.refresh(true);
    expect(f.reason("Player.skipAd")).toBeUndefined();
    f.context.event(name);
    expect(f.context.snapshot()).toMatchObject({ adSkipOffset: null, adClientType: null, adTime: null, adPlaying: false });
    expect(f.reason("Player.skipAd")).toBeDefined();
  });

  it("discards an older ad's deferred clock when a new unskippable ad starts", async () => {
    const f = fixture(); await f.context.refresh(); f.player.isAd.mockResolvedValue(true);
    f.context.event("onAdStarted", { skipOffset: 5, clientType: "bitmovin" });
    let finish!: (value: number) => void;
    f.player.getCurrentTime.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
    const pending = f.context.refresh();
    for (let turn = 0; turn < 8 && !finish; turn++) await Promise.resolve();
    expect(finish).toBeTypeOf("function");
    f.context.event("onAdStarted", { skipOffset: -1, clientType: "bitmovin" }); finish(100);
    expect(await pending).toBe(false);
    expect(f.reason("Player.skipAd")).toBe("This ad does not allow skipping.");
    expect(f.context.snapshot().adTime).toBeNull();
  });

  it.each(["reset", "retire", "source replacement"])("fences a deferred native ad clock at %s before any follow-up SDK read", async action => {
    const f = fixture(); await f.context.refresh(); f.player.isAd.mockResolvedValue(true);
    f.context.event("onAdStarted", { skipOffset: 5, clientType: "bitmovin" });
    let finish!: (value: number) => void;
    f.player.getCurrentTime.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
    const pending = f.context.refresh();
    for (let turn = 0; turn < 8 && !finish; turn++) await Promise.resolve();
    const reads = f.player.isAd.mock.calls.length;
    if (action === "source replacement") f.player.source = { ...f.source };
    else f.context[action as "reset" | "retire"]();
    finish(100);
    expect(await pending).toBe(false);
    expect(f.player.isAd).toHaveBeenCalledTimes(reads);
    expect(f.context.snapshot().adTime).toBeNull();
    expect(f.reason("Player.skipAd")).toBeDefined();
  });

  it("requires a presented non-linear payload instead of treating isAd=false as dismissible", async () => {
    const f = fixture(); await f.context.refresh();
    for (const payload of [undefined, {}, { ad: { isLinear: true } }]) {
      f.context.event("onNonLinearAdStarted", payload);
      expect(f.reason("Player.skipAd")).toBe("No active ad is available to skip.");
    }
    f.context.event("onNonLinearAdStarted", { ad: { isLinear: false } });
    expect(f.reason("Player.skipAd")).toBeUndefined();
    f.context.event("onNonLinearAdFinished");
    expect(f.reason("Player.skipAd")).toBe("No active ad is available to skip.");
  });

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
    f.player.isAd.mockResolvedValue(true); f.context.event("onAdStarted", { skipOffset: 0, clientType: "bitmovin" }); await f.context.refresh();
    expect(f.reason("Player.skipAd")).toBeUndefined();
    expect(f.reason("Player.seek")).toBe("Wait for the linear ad to finish.");
    f.player.isAd.mockResolvedValue(false); f.context.event("onAdFinished"); f.context.event("onNonLinearAdStarted", { ad: { isLinear: false } }); await f.context.refresh();
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
