import { describe, expect, it } from "vitest";
import type { PlayerAPI } from "bitmovin-player";
import { apiUnavailableReason, readApiRuntimeState, type ApiRuntimeState } from "../src/api/availability";

function state(overrides: Partial<ApiRuntimeState> = {}): ApiRuntimeState {
  return {
    hasSource: true, live: false, playing: false, timeShiftEnabled: true, maxTimeShift: 0,
    currentTime: 0, seekableRange: { start: 0, end: 60 }, activeAd: null,
    linearAdActive: false, advertisingModule: "advertising-bitmovin", activeSgaiAd: undefined,
    adBreakIds: [], castAvailable: false, casting: false, airplayAvailable: false,
    availableViewModes: ["inline", "fullscreen"], audioTrackIds: ["audio-en"],
    audioQualityIds: ["audio-1"], videoQualityIds: ["video-1"], subtitleIds: [],
    playReadySource: false, ...overrides,
  };
}

describe("runtime API prerequisites", () => {
  it("requires a current skippable client-side ad and honors the SDK ad clock", () => {
    expect(apiUnavailableReason("PlayerAPI.ads.skip", state())?.code).toBe("ad-inactive");
    const ad = { isLinear: true, skippableAfter: 5 };
    expect(apiUnavailableReason("PlayerAPI.ads.skip", state({ activeAd: ad, linearAdActive: true, currentTime: 4.9 }))?.code).toBe("ad-wait");
    expect(apiUnavailableReason("PlayerAPI.ads.skip", state({ activeAd: ad, linearAdActive: true, currentTime: 5 }))).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.ads.skip", state({ activeAd: { isLinear: true }, linearAdActive: true, currentTime: 20 }))?.code).toBe("ad-not-skippable");
    expect(apiUnavailableReason("PlayerAPI.ads.skip", state({ activeAd: ad, linearAdActive: true, currentTime: NaN }))?.code).toBe("ad-wait");
  });

  it("allows native nonlinear and pause-ad dismissal without using the content clock", () => {
    const nonlinear = state({ activeAd: { isLinear: false }, currentTime: NaN, linearAdActive: false, hasSource: false });
    expect(apiUnavailableReason("PlayerAPI.ads.skip", nonlinear)).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.ads.skip", { ...nonlinear, advertisingModule: "advertising-ima" })?.code).toBe("ima-skip");
    expect(apiUnavailableReason("PlayerAPI.ads.skip", { ...nonlinear, advertisingModule: undefined })?.code).toBe("ad-module");
  });

  it("keeps SGAI and client-side ad activity separate", () => {
    const sgai = state({ activeSgaiAd: { isLinear: true } });
    expect(apiUnavailableReason("PlayerAPI.ads.skip", sgai)?.code).toBe("ad-inactive");
    expect(apiUnavailableReason("PlayerAPI.sgai.skip", sgai)).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.sgai.skip", state({ activeAd: { isLinear: false } }))?.code).toBe("sgai-inactive");
  });

  it("separates VOD seek from the live rewind window and its applied setting", () => {
    expect(apiUnavailableReason("PlayerAPI.seek", state({ live: true }), [10])?.code).toBe("vod-only");
    expect(apiUnavailableReason("PlayerAPI.seek", state(), [10])).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.seek", state(), [61])?.code).toBe("seek-range");
    expect(apiUnavailableReason("PlayerAPI.timeShift", state(), [-5])?.code).toBe("live-only");
    const live = state({ live: true, maxTimeShift: -30 });
    expect(apiUnavailableReason("PlayerAPI.timeShift", live, [-5])).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.timeShift", { ...live, timeShiftEnabled: false }, [-5])?.code).toBe("timeshift-disabled");
    expect(apiUnavailableReason("PlayerAPI.timeShift", { ...live, maxTimeShift: 0 }, [0])?.code).toBe("timeshift-window");
    expect(apiUnavailableReason("PlayerAPI.timeShift", live, [-31])?.code).toBe("timeshift-range");
    // Positive values are documented wall-clock timestamps, not offsets.
    expect(apiUnavailableReason("PlayerAPI.timeShift", live, [1_800_000_000])).toBeUndefined();
  });

  it("blocks content seeking during linear ads without blocking nonlinear content controls", () => {
    expect(apiUnavailableReason("PlayerAPI.seek", state({ linearAdActive: true }), [5])?.code).toBe("ad-seeking");
    // SGAI uses per-break restrictions; its presence alone does not prohibit seeking.
    expect(apiUnavailableReason("PlayerAPI.seek", state({ activeSgaiAd: { isLinear: true } }), [5])).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.seek", state({ activeAd: { isLinear: false } }), [5])).toBeUndefined();
  });

  it("requires the applicable Cast, AirPlay and selected view-mode capability", () => {
    expect(apiUnavailableReason("PlayerAPI.castVideo", state())?.code).toBe("cast-unavailable");
    expect(apiUnavailableReason("PlayerAPI.castVideo", state({ castAvailable: true }))).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.castStop", state())?.code).toBe("cast-inactive");
    expect(apiUnavailableReason("PlayerAPI.castStop", state({ casting: true, hasSource: false }))).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.showAirplayTargetPicker", state())?.code).toBe("airplay-unavailable");
    expect(apiUnavailableReason("PlayerAPI.setViewMode", state(), ["pictureinpicture"])?.code).toBe("view-mode");
    expect(apiUnavailableReason("PlayerAPI.setViewMode", state({ hasSource: false }), ["inline"])).toBeUndefined();
  });

  it("checks current IDs while preserving Auto and subtitle-clearing operations", () => {
    expect(apiUnavailableReason("PlayerAPI.setAudio", state(), ["old-track"])?.code).toBe("audio-track");
    expect(apiUnavailableReason("PlayerAPI.setAudio", state(), ["audio-en"])).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.setVideoQuality", state({ videoQualityIds: [] }), ["auto"])).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.setVideoQuality", state(), ["old-quality"])?.code).toBe("video-quality");
    expect(apiUnavailableReason("PlayerAPI.subtitles.enable", state(), ["old-track"])?.code).toBe("subtitle-track");
    expect(apiUnavailableReason("PlayerAPI.subtitles.disable", state({ hasSource: false }), ["old-track"])).toBeUndefined();
    expect(apiUnavailableReason("PlayerAPI.ads.discardAdBreak", state(), ["old-break"])?.code).toBe("ad-break");
    expect(apiUnavailableReason("PlayerAPI.ads.discardAdBreak", state({ adBreakIds: ["current"] }), ["current"])).toBeUndefined();
  });

  it("keeps bootstrap, teardown, setters and notifications usable without a source", () => {
    const empty = state({ hasSource: false });
    for (const id of ["PlayerAPI.load", "PlayerAPI.destroy", "PlayerAPI.unload", "PlayerAPI.setVolume",
      "PlayerAPI.setPlaybackSpeed", "PlayerAPI.setPosterImage", "PlayerAPI.setAuthentication",
      "PlayerAPI.setVideoElement", "PlayerAPI.lowlatency.setCatchupConfig", "PlayerAPI.addMetadata",
      "PlayerAPI.analytics.ssai.adStart", "PlayerAPI.analytics.ssai.adBreakStart",
      "PlayerAPI.analytics.ssai.adQuartileFinished", "PlayerAPI.subtitles.cueEnter"]) {
      expect(apiUnavailableReason(id, empty), id).toBeUndefined();
    }
    expect(apiUnavailableReason("PlayerAPI.play", empty)?.code).toBe("source");
    expect(apiUnavailableReason("PlayerAPI.ads.schedule", empty)?.code).toBe("source");
    expect(apiUnavailableReason("PlayerAPI.drm.renewLicense", state())?.code).toBe("playready");
  });
});

it("reads applied SDK state, handles missing modules and never infers source capabilities from URLs", () => {
  const player = {
    getSource: () => ({ hls: "https://example.test/live.m3u8" }), isLive: () => false,
    getConfig: () => ({ playback: { timeShift: false } }), getMaxTimeShift: () => -30,
    getCurrentTime: () => 10, getSeekableRange: () => ({ start: 0, end: 60 }),
    getAvailableAudio: () => [{ id: "audio" }], getAvailableVideoQualities: () => [{ id: "video" }],
    ads: { getActiveAd: () => null, getModuleInfo: () => { throw new Error("module missing"); } },
  } as unknown as PlayerAPI;
  const snapshot = readApiRuntimeState(player);
  expect(snapshot.live).toBe(false); expect(snapshot.timeShiftEnabled).toBe(false);
  expect(snapshot.audioTrackIds).toEqual(["audio"]); expect(snapshot.advertisingModule).toBeUndefined();
  expect(apiUnavailableReason("PlayerAPI.timeShift", snapshot)?.code).toBe("live-only");
  expect(readApiRuntimeState(undefined).hasSource).toBe(false);
});
