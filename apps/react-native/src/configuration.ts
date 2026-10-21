import { SourceType, SubtitleFormat, TimelineReferencePoint, type PlayerConfig, type SourceConfig } from "bitmovin-player-react-native";
// Older native URL implementations omit the protocol and hostname getters used below.
import { URL } from "react-native-url-polyfill";
import type { ShowcaseSource } from "./sources";
import { applyNativeSettings, type NativeSettings, type SettingValues } from "./nativeSettings";
import { applyNativeArrays, type NativeArrayDraft } from "./nativeArrays";
import { validateNativeScripts, validateNativeScriptSettings, type NativeScriptDraft } from "./nativeScripts";

export type NativePlatform = "ios" | "android";
export type SourceFormat = "hls" | "dash" | "progressive";
export interface ConfigurationDraft {
  url: string;
  type: SourceFormat;
  title: string;
  poster: string;
  startOffset: string;
  timeline: "default" | "start" | "end";
  autoplay: boolean;
  muted: boolean;
  forwardDuration: string;
  maxBitrate: string;
  subtitleUrl: string;
  subtitleLabel: string;
  subtitleLanguage: string;
  subtitleDefault: boolean;
  apiSettings?: SettingValues;
  arraySettings?: NativeArrayDraft;
  scripts?: NativeScriptDraft;
}
export interface Configuration extends NativeSettings {
  draft: ConfigurationDraft;
}

export function supportsSource(source: ShowcaseSource, platform: NativePlatform): boolean {
  return platform !== "ios" || source.kind.endsWith("hls");
}

export function presetDraft(source: ShowcaseSource): Pick<ConfigurationDraft, "url" | "type" | "title" | "poster" | "startOffset" | "timeline" | "subtitleUrl" | "subtitleLabel" | "subtitleLanguage" | "subtitleDefault"> {
  return {
    url: source.url, type: source.kind.endsWith("hls") ? "hls" : "dash", title: source.label,
    poster: "", startOffset: "", timeline: "default",
    subtitleUrl: "", subtitleLabel: "", subtitleLanguage: "", subtitleDefault: false,
  };
}

export function initialDraft(source: ShowcaseSource): ConfigurationDraft {
  return { ...presetDraft(source), autoplay: false, muted: false, forwardDuration: "", maxBitrate: "" };
}

function httpUrl(value: string, label: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (/^https?:\/\/[^\s\\]+$/i.test(trimmed) && (url.protocol === "http:" || url.protocol === "https:") && url.hostname) return trimmed;
  } catch { /* The field message below also covers malformed URLs. */ }
  throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
}

function optionalNumber(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined;
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const number = Number(value.trim());
  if (!decimal.test(value.trim()) || !Number.isFinite(number)) throw new Error(`${label} must be a finite decimal number.`);
  return number;
}

/** The only boundary from editable text into SDK configuration objects. */
export function parseConfiguration(draft: ConfigurationDraft, platform: NativePlatform): Configuration {
  if (draft.scripts) validateNativeScripts(draft.scripts);
  const url = httpUrl(draft.url, "Source URL");
  if (platform === "ios" && draft.type === "dash") throw new Error("DASH is not supported by the native iOS player. Use HLS or progressive MP4.");
  const type = { hls: SourceType.HLS, dash: SourceType.DASH, progressive: SourceType.PROGRESSIVE }[draft.type];
  if (!type) throw new Error("Select a supported source type.");
  const title = draft.title.trim();
  const poster = draft.poster.trim() ? httpUrl(draft.poster, "Poster URL") : "";
  const subtitleUrl = draft.subtitleUrl.trim() ? httpUrl(draft.subtitleUrl, "External WebVTT URL") : "";
  const subtitleLabel = subtitleUrl ? draft.subtitleLabel.trim() : "";
  let subtitleLanguage = "";
  if (subtitleUrl) {
    if (!subtitleLabel) throw new Error("Enter a label for the external subtitle track.");
    try { subtitleLanguage = Intl.getCanonicalLocales(draft.subtitleLanguage.trim())[0] ?? ""; }
    catch { /* Report the field error without forwarding invalid text to the SDK. */ }
    if (!subtitleLanguage) throw new Error("Subtitle language must be an IETF language tag, such as en or en-US.");
  }
  const subtitleDefault = Boolean(subtitleUrl && draft.subtitleDefault);
  const startOffset = optionalNumber(draft.startOffset, "Start offset");
  const forwardDuration = optionalNumber(draft.forwardDuration, "Forward buffer");
  // Zero selects a duration automatically only on iOS; this screen requires positive Android targets.
  if (forwardDuration !== undefined && (forwardDuration < 0 || (platform === "android" && forwardDuration === 0))) {
    throw new Error(platform === "ios" ? "Forward buffer must be zero or positive." : "Forward buffer must be positive on Android; leave blank for the SDK default.");
  }
  const maxBitrate = optionalNumber(draft.maxBitrate, "Maximum bitrate");
  // Android consumes an Int; iOS uses an unsigned value that JavaScript must represent exactly.
  // Check the text too: Number can round fractional input to a safe integer.
  const wholeBitrate = /^\+?\d+(?:\.0*)?$/.test(draft.maxBitrate.trim());
  if (maxBitrate !== undefined && (!wholeBitrate || !Number.isSafeInteger(maxBitrate) || maxBitrate <= 0 || (platform === "android" && maxBitrate > 2147483647))) {
    throw new Error(platform === "android"
      ? "Maximum bitrate must be a whole number from 1 to 2147483647 bit/s; leave blank for no cap."
      : "Maximum bitrate must be a whole number from 1 to 9007199254740991 bit/s; leave blank for no cap.");
  }
  const reference = draft.timeline === "start" ? TimelineReferencePoint.START : draft.timeline === "end" ? TimelineReferencePoint.END : undefined;
  const source: SourceConfig = {
    url, type, ...(title ? { title } : {}), ...(poster ? { poster } : {}),
    ...(subtitleUrl ? { subtitleTracks: [{ url: subtitleUrl, label: subtitleLabel, language: subtitleLanguage,
      identifier: "player-lab-external", format: SubtitleFormat.VTT, isDefault: subtitleDefault }] } : {}),
    ...(startOffset !== undefined || reference !== undefined ? { options: {
      ...(startOffset !== undefined ? { startOffset } : {}),
      ...(reference !== undefined ? { startOffsetTimelineReference: reference } : {}),
    } } : {}),
  };
  const player: PlayerConfig = {
      playbackConfig: { isAutoplayEnabled: draft.autoplay, isMuted: draft.muted },
      ...(forwardDuration !== undefined ? { bufferConfig: { audioAndVideo: { forwardDuration } } } : {}),
      ...(maxBitrate !== undefined ? { adaptationConfig: { maxSelectableBitrate: maxBitrate } } : {}),
  };
  const settings = applyNativeSettings(source, player, draft.apiSettings ?? {});
  applyNativeArrays(settings, draft.arraySettings ?? {});
  if (draft.scripts) validateNativeScriptSettings(settings, draft.scripts);
  return {
    ...settings,
    draft: { ...draft, url, title, poster, subtitleUrl, subtitleLabel, subtitleLanguage, subtitleDefault,
      startOffset: startOffset === undefined ? "" : String(startOffset),
      forwardDuration: forwardDuration === undefined ? "" : String(forwardDuration), maxBitrate: maxBitrate === undefined ? "" : String(maxBitrate) },
  };
}

export function sameConfiguration(left: Configuration, right: Configuration): boolean {
  const values = (config: Configuration) => [config.source, config.player, config.view, config.webUi, config.props, config.offline, config.download, config.offlineOptions, config.cast, config.draft.scripts];
  return JSON.stringify(values(left)) === JSON.stringify(values(right));
}
