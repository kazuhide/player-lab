import { SourceType, TimelineReferencePoint, type PlayerConfig, type SourceConfig } from "bitmovin-player-react-native";
import type { ShowcaseSource } from "./sources";

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
}
export interface Configuration {
  source: SourceConfig;
  player: Pick<PlayerConfig, "playbackConfig" | "bufferConfig" | "adaptationConfig">;
  draft: ConfigurationDraft;
}

export function supportsSource(source: ShowcaseSource, platform: NativePlatform): boolean {
  return platform !== "ios" || source.kind.endsWith("hls");
}

export function presetDraft(source: ShowcaseSource): Pick<ConfigurationDraft, "url" | "type" | "title" | "poster" | "startOffset" | "timeline"> {
  return {
    url: source.url, type: source.kind.endsWith("hls") ? "hls" : "dash", title: source.label,
    poster: "", startOffset: "", timeline: "default",
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
  const url = httpUrl(draft.url, "Source URL");
  if (platform === "ios" && draft.type === "dash") throw new Error("DASH is not supported by the native iOS player. Use HLS or progressive MP4.");
  const type = { hls: SourceType.HLS, dash: SourceType.DASH, progressive: SourceType.PROGRESSIVE }[draft.type];
  if (!type) throw new Error("Select a supported source type.");
  const title = draft.title.trim();
  const poster = draft.poster.trim() ? httpUrl(draft.poster, "Poster URL") : "";
  const startOffset = optionalNumber(draft.startOffset, "Start offset");
  const forwardDuration = optionalNumber(draft.forwardDuration, "Forward buffer");
  // Zero selects a duration automatically only on iOS; this screen requires positive Android targets.
  if (forwardDuration !== undefined && (forwardDuration < 0 || (platform === "android" && forwardDuration === 0))) {
    throw new Error(platform === "ios" ? "Forward buffer must be zero or positive." : "Forward buffer must be positive on Android; leave blank for the SDK default.");
  }
  const maxBitrate = optionalNumber(draft.maxBitrate, "Maximum bitrate");
  if (maxBitrate !== undefined && maxBitrate <= 0) throw new Error("Maximum bitrate must be positive; leave blank for no cap.");
  const reference = draft.timeline === "start" ? TimelineReferencePoint.START : draft.timeline === "end" ? TimelineReferencePoint.END : undefined;
  const source: SourceConfig = {
    url, type, ...(title ? { title } : {}), ...(poster ? { poster } : {}),
    ...(startOffset !== undefined || reference !== undefined ? { options: {
      ...(startOffset !== undefined ? { startOffset } : {}),
      ...(reference !== undefined ? { startOffsetTimelineReference: reference } : {}),
    } } : {}),
  };
  return {
    source,
    player: {
      playbackConfig: { isAutoplayEnabled: draft.autoplay, isMuted: draft.muted },
      ...(forwardDuration !== undefined ? { bufferConfig: { audioAndVideo: { forwardDuration } } } : {}),
      ...(maxBitrate !== undefined ? { adaptationConfig: { maxSelectableBitrate: maxBitrate } } : {}),
    },
    draft: { ...draft, url, title, poster, startOffset: startOffset === undefined ? "" : String(startOffset),
      forwardDuration: forwardDuration === undefined ? "" : String(forwardDuration), maxBitrate: maxBitrate === undefined ? "" : String(maxBitrate) },
  };
}

export function sameConfiguration(left: Configuration, right: Configuration): boolean {
  return JSON.stringify([left.source, left.player]) === JSON.stringify([right.source, right.player]);
}
