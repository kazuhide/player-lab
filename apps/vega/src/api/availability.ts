import type { LinearAd, PlayerAPI } from "bitmovin-player";
import { NumericInput } from "./types";

export interface OperationAvailability { callable: boolean; reason?: string; }
const allowed: OperationAvailability = { callable: true };
const blocked = (reason: string): OperationAvailability => ({ callable: false, reason });

const sourceCommands = new Set([
  "PlayerAPI.play", "PlayerAPI.pause", "PlayerAPI.preload", "PlayerAPI.seek", "PlayerAPI.timeShift",
  "PlayerAPI.setAudio", "PlayerAPI.setAudioQuality", "PlayerAPI.setVideoQuality", "PlayerAPI.setPlaybackSpeed",
  "PlayerAPI.subtitles.add", "PlayerAPI.subtitles.enable", "PlayerAPI.subtitles.remove", "PlayerAPI.drm.renewLicense",
  "PlayerAPI.sgai.skip", "PlayerAPI.castVideo",
]);

/** Read current public SDK state without executing the selected operation. */
export function currentOperationAvailability(player: PlayerAPI, id: string, args?: readonly unknown[]): OperationAvailability {
  if (sourceCommands.has(id) && !player.getSource()) return blocked("Load a source before this operation.");
  // SGAI/HLS interstitials have their own active-ad getter. Analytics SSAI
  // notifications and metadata setters are independent of playback ad state.
  if (id === "PlayerAPI.sgai.skip" && !player.sgai?.getActiveAd()) return blocked("No SGAI ad is active.");
  if (id === "PlayerAPI.ads.skip") {
    const ad = player.ads?.getActiveAd() as LinearAd | null | undefined;
    if (!ad) return blocked("No client-side ad is active.");
    if (!ad.isLinear || ad.skippableAfter === undefined || player.getCurrentTime() < ad.skippableAfter) {
      return blocked("The current client-side ad cannot be skipped yet.");
    }
  }
  if (id === "PlayerAPI.ads.discardAdBreak") {
    const breaks = [...(player.ads?.list() ?? []), player.ads?.getActiveAdBreak()].filter(Boolean);
    if (!breaks.length || (args && !breaks.some(adBreak => adBreak?.id === args[0]))) return blocked("Choose a current or scheduled client-side ad break.");
  }
  if (id === "PlayerAPI.seek" && player.isLive()) return blocked("Use timeShift for the current live source.");
  if (id === "PlayerAPI.timeShift") {
    if (!player.isLive()) return blocked("The current source has no live DVR window.");
    // Zero remains the valid live-edge recovery call when a live source has no DVR window.
    const maxTimeShift = player.getMaxTimeShift();
    const offset = args?.[0];
    const liveEdge = offset === 0 || (offset instanceof NumericInput && Number(offset.raw) === 0);
    if (args && !liveEdge && (!Number.isFinite(maxTimeShift) || maxTimeShift >= 0)) return blocked("The current source has no live DVR window.");
  }
  if (id === "PlayerAPI.castVideo" && !player.isCastAvailable()) return blocked("No Cast target is available.");
  if (id === "PlayerAPI.castStop" && !player.isCasting()) return blocked("No Cast session is active.");
  if (id === "PlayerAPI.showAirplayTargetPicker" && !player.isAirplayAvailable()) return blocked("AirPlay is unavailable.");
  if (id === "PlayerAPI.setViewMode" && args && !player.isViewModeAvailable(args[0] as Parameters<PlayerAPI["setViewMode"]>[0])) {
    return blocked("The selected view mode is unavailable.");
  }
  if (id === "PlayerAPI.drm.renewLicense" && !player.getSource()?.drm) return blocked("The current source has no DRM configuration.");
  if (id === "PlayerAPI.setAudio") {
    const tracks = player.getAvailableAudio();
    if (!tracks.length || (args && !tracks.some(track => track.id === args[0]))) return blocked("Choose an audio track from the current source.");
  }
  if (args && (id === "PlayerAPI.setVideoQuality" || id === "PlayerAPI.setAudioQuality") && args[0] !== "auto") {
    const qualities = id === "PlayerAPI.setVideoQuality" ? player.getAvailableVideoQualities() : player.getAvailableAudioQualities();
    if (!qualities.some(quality => quality.id === args[0])) return blocked("Choose a quality from the current source or use auto.");
  }
  if (id === "PlayerAPI.subtitles.enable" || id === "PlayerAPI.subtitles.remove") {
    const tracks = player.subtitles.list();
    if (!tracks.length || (args && !tracks.some(track => track.id === args[0]))) return blocked("Choose a subtitle track from the current source.");
  }
  return allowed;
}
