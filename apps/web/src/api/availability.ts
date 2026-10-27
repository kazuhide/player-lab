import type { PlayerAPI } from "bitmovin-player";
import type { L } from "../i18n";

interface AdState { isLinear: boolean; skippableAfter?: number }

/** Public SDK observations only; source URLs do not describe active capabilities. */
export interface ApiRuntimeState {
  hasSource: boolean;
  live: boolean;
  playing: boolean;
  timeShiftEnabled: boolean;
  maxTimeShift: number;
  currentTime: number;
  seekableRange: { start: number; end: number };
  activeAd: AdState | null;
  linearAdActive: boolean;
  advertisingModule: string | undefined;
  activeSgaiAd: AdState | undefined;
  adBreakIds: readonly string[];
  castAvailable: boolean;
  casting: boolean;
  airplayAvailable: boolean;
  availableViewModes: readonly string[];
  audioTrackIds: readonly string[];
  audioQualityIds: readonly string[];
  videoQualityIds: readonly string[];
  subtitleIds: readonly string[];
  playReadySource: boolean;
}

export interface ApiUnavailableReason { code: string; message: L }

export class ApiUnavailableError extends Error {
  constructor(readonly reason: ApiUnavailableReason) { super(reason.message.en); }
}

const messages = {
  player: { ja: "Playerを作成してください。", en: "Create a player first." },
  ui: { ja: "UIを作成してください。", en: "Create a UI first." },
  method: { ja: "現在のSDKでは利用できません。", en: "Unavailable in the current SDK instance." },
  source: { ja: "ソースを読み込んでください。", en: "Load a source first." },
  "already-playing": { ja: "すでに再生中です。", en: "Playback is already running." },
  "not-playing": { ja: "再生中に利用できます。", en: "Available during playback." },
  "vod-only": { ja: "VODソースで利用できます。", en: "Available for on-demand sources." },
  "live-only": { ja: "ライブソースで利用できます。", en: "Available for live sources." },
  "timeshift-disabled": { ja: "ライブの巻き戻しを有効にしてください。", en: "Enable live rewind first." },
  "timeshift-window": { ja: "巻き戻し可能な範囲がありません。", en: "No live rewind window is available." },
  "timeshift-range": { ja: "巻き戻し可能な範囲内の値を入力してください。", en: "Enter a value within the live rewind window." },
  "seek-range": { ja: "シーク可能な範囲内の時刻を入力してください。", en: "Enter a time within the seekable range." },
  "ad-seeking": { ja: "リニア広告の再生中はシークできません。", en: "Seeking is unavailable during linear ads." },
  "ad-inactive": { ja: "再生中の広告がありません。", en: "No ad is active." },
  "ad-not-skippable": { ja: "この広告はスキップできません。", en: "The active ad cannot be skipped." },
  "ad-wait": { ja: "まだ広告をスキップできません。", en: "The ad is not skippable yet." },
  "ima-skip": { ja: "IMA SDKではAPIから広告をスキップできません。", en: "The IMA SDK does not support programmatic skipping." },
  "ad-module": { ja: "広告モジュールを確認できません。", en: "The advertising module is unavailable." },
  "sgai-inactive": { ja: "再生中のSGAI広告がありません。", en: "No SGAI ad is active." },
  "ad-break": { ja: "現在の広告ブレークIDを指定してください。", en: "Select a current ad break ID." },
  "cast-unavailable": { ja: "Castを利用できません。", en: "Cast is unavailable." },
  "cast-active": { ja: "すでにCast中です。", en: "A Cast session is already active." },
  "cast-inactive": { ja: "Cast中に利用できます。", en: "A Cast session is required." },
  "airplay-unavailable": { ja: "AirPlayを利用できません。", en: "AirPlay is unavailable." },
  "view-mode": { ja: "選択した表示モードを利用できません。", en: "The selected view mode is unavailable." },
  "audio-track": { ja: "現在の音声トラックIDを指定してください。", en: "Select a current audio track ID." },
  "audio-quality": { ja: "現在の音声品質IDまたはautoを指定してください。", en: "Select a current audio quality ID or auto." },
  "video-quality": { ja: "現在の映像品質IDまたはautoを指定してください。", en: "Select a current video quality ID or auto." },
  "subtitle-track": { ja: "現在の字幕トラックIDを指定してください。", en: "Select a current subtitle track ID." },
  "ui-object": { ja: "現在のUIに対象のオブジェクトがありません。", en: "The current UI has no object for this operation." },
  playready: { ja: "PlayReadyのソースで利用できます。", en: "A PlayReady source is required." },
} satisfies Record<string, L>;

export function apiReason(code: keyof typeof messages): ApiUnavailableReason { return { code, message: messages[code] }; }

function read<T>(getter: () => T | null | undefined, fallback: T): T {
  try { return getter() ?? fallback; } catch { return fallback; }
}

export function readApiRuntimeState(player: PlayerAPI | undefined): ApiRuntimeState {
  const source = read(() => player?.getSource(), null);
  const ids = (getter: () => readonly { id: string }[] | undefined) => read(getter, []).map(item => item.id);
  const activeAdBreak = read(() => player?.ads.getActiveAdBreak(), null);
  return {
    hasSource: !!source,
    live: read(() => player?.isLive(), false),
    playing: read(() => player?.isPlaying(), false),
    timeShiftEnabled: read(() => player?.getConfig(false).playback?.timeShift, true) !== false,
    maxTimeShift: read(() => player?.getMaxTimeShift(), 0),
    // In SDK 8.281, getCurrentTime routes to the ad controller for linear ads.
    // Nonlinear/pause-ad dismissal must never compare this content clock.
    currentTime: read(() => player?.getCurrentTime(), NaN),
    seekableRange: read(() => player?.getSeekableRange(), { start: NaN, end: NaN }),
    activeAd: read(() => player?.ads.getActiveAd(), null),
    linearAdActive: read(() => player?.ads.isLinearAdActive(), false),
    advertisingModule: read(() => player?.ads.getModuleInfo().name, undefined),
    activeSgaiAd: read(() => player?.sgai?.getActiveAd(), undefined),
    adBreakIds: [...ids(() => player?.ads.list()), ...(activeAdBreak ? [activeAdBreak.id] : [])],
    castAvailable: read(() => player?.isCastAvailable(), false),
    casting: read(() => player?.isCasting(), false),
    airplayAvailable: read(() => player?.isAirplayAvailable(), false),
    availableViewModes: (["inline", "fullscreen", "pictureinpicture"] as const)
      .filter(mode => read(() => player?.isViewModeAvailable(mode as Parameters<PlayerAPI["isViewModeAvailable"]>[0]), false)),
    audioTrackIds: ids(() => player?.getAvailableAudio()),
    audioQualityIds: ids(() => player?.getAvailableAudioQualities()),
    videoQualityIds: ids(() => player?.getAvailableVideoQualities()),
    subtitleIds: ids(() => player?.subtitles.list()),
    playReadySource: !!source?.drm?.playready,
  };
}

const sourceCommands = new Set([
  "PlayerAPI.play", "PlayerAPI.pause", "PlayerAPI.preload", "PlayerAPI.seek", "PlayerAPI.timeShift",
  "PlayerAPI.castVideo", "PlayerAPI.showAirplayTargetPicker", "PlayerAPI.ads.schedule",
  "PlayerAPI.setAudio", "PlayerAPI.setAudioQuality", "PlayerAPI.setVideoQuality",
  "PlayerAPI.subtitles.add", "PlayerAPI.subtitles.enable", "PlayerAPI.subtitles.remove", "PlayerAPI.drm.renewLicense",
]);

export const argumentPrerequisites = new Set(["PlayerAPI.seek", "PlayerAPI.timeShift", "PlayerAPI.setViewMode",
  "PlayerAPI.setAudio", "PlayerAPI.setAudioQuality", "PlayerAPI.setVideoQuality", "PlayerAPI.subtitles.enable",
  "PlayerAPI.subtitles.remove", "PlayerAPI.ads.discardAdBreak"]);

/** Undefined arguments describe a catalog choice; supplied arguments describe the actual call. */
export function apiUnavailableReason(id: string, state: ApiRuntimeState, args?: readonly unknown[]): ApiUnavailableReason | undefined {
  if (sourceCommands.has(id) && !state.hasSource) return apiReason("source");
  if (id === "PlayerAPI.play" && state.playing) return apiReason("already-playing");
  if (id === "PlayerAPI.pause" && !state.playing) return apiReason("not-playing");
  if (id === "PlayerAPI.seek" || id === "PlayerAPI.timeShift") {
    if (state.linearAdActive) return apiReason("ad-seeking");
    if (id === "PlayerAPI.seek") {
      if (state.live) return apiReason("vod-only");
      const time = args?.[0];
      if (typeof time === "number" && (!Number.isFinite(time) || time < state.seekableRange.start || time > state.seekableRange.end)) return apiReason("seek-range");
    } else {
      if (!state.live) return apiReason("live-only");
      if (!state.timeShiftEnabled) return apiReason("timeshift-disabled");
      if (!Number.isFinite(state.maxTimeShift) || state.maxTimeShift >= 0) return apiReason("timeshift-window");
      const offset = args?.[0];
      if (typeof offset === "number" && (!Number.isFinite(offset) || offset <= 0 && offset < state.maxTimeShift)) return apiReason("timeshift-range");
    }
  }
  if (id === "PlayerAPI.ads.skip") {
    const ad = state.activeAd;
    if (!ad) return apiReason("ad-inactive");
    if (state.advertisingModule === "advertising-ima") return apiReason("ima-skip");
    if (state.advertisingModule !== "advertising-bitmovin") return apiReason("ad-module");
    if (ad.isLinear) {
      if (!Number.isFinite(ad.skippableAfter) || ad.skippableAfter! < 0) return apiReason("ad-not-skippable");
      if (!state.linearAdActive || !Number.isFinite(state.currentTime) || state.currentTime < ad.skippableAfter!) return apiReason("ad-wait");
    }
  }
  if (id === "PlayerAPI.sgai.skip" && !state.activeSgaiAd) return apiReason("sgai-inactive");
  if (id === "PlayerAPI.castVideo") {
    if (!state.castAvailable) return apiReason("cast-unavailable");
    if (state.casting) return apiReason("cast-active");
  }
  if (id === "PlayerAPI.castStop" && !state.casting) return apiReason("cast-inactive");
  if (id === "PlayerAPI.showAirplayTargetPicker" && !state.airplayAvailable) return apiReason("airplay-unavailable");
  if (id === "PlayerAPI.setViewMode" && (args ? !state.availableViewModes.includes(String(args[0])) : !state.availableViewModes.length)) return apiReason("view-mode");
  if (id === "PlayerAPI.setAudio" && (args ? !state.audioTrackIds.includes(String(args[0])) : !state.audioTrackIds.length)) return apiReason("audio-track");
  if (id === "PlayerAPI.setAudioQuality" && args && args[0] !== "auto" && !state.audioQualityIds.includes(String(args[0]))) return apiReason("audio-quality");
  if (id === "PlayerAPI.setVideoQuality" && args && args[0] !== "auto" && !state.videoQualityIds.includes(String(args[0]))) return apiReason("video-quality");
  if ((id === "PlayerAPI.subtitles.enable" || id === "PlayerAPI.subtitles.remove")
    && (args ? !state.subtitleIds.includes(String(args[0])) : !state.subtitleIds.length)) return apiReason("subtitle-track");
  if (id === "PlayerAPI.ads.discardAdBreak" && (args ? !state.adBreakIds.includes(String(args[0])) : !state.adBreakIds.length)) return apiReason("ad-break");
  if (id === "PlayerAPI.drm.renewLicense" && !state.playReadySource) return apiReason("playready");
  return undefined;
}
