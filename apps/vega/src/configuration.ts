import type { PlayerConfig, SourceConfig } from "bitmovin-player";
// Older native URL implementations omit the protocol and hostname getters used below.
import { URL } from "react-native-url-polyfill";
import { TimelineReferencePoint } from "bitmovin-player/modules/bitmovinplayer-core";
import type { VegaSource } from "./Sources";

export interface ConfigurationDraft {
  url: string;
  type: "hls" | "dash" | "progressive";
  title: string;
  poster: string;
  startOffset: string;
  timeline: "default" | "start" | "end";
  autoplay: boolean;
  muted: boolean;
  videoForwardDuration: string;
  audioForwardDuration: string;
  maxVideoBitrate: string;
}
export interface Configuration {
  source: SourceConfig;
  player: Pick<PlayerConfig, "playback" | "buffer" | "adaptation">;
  draft: ConfigurationDraft;
}

export function presetDraft(source: VegaSource): Pick<ConfigurationDraft, "url" | "type" | "title" | "poster" | "startOffset" | "timeline"> {
  return {
    url: source.config.hls ?? source.config.dash ?? "", type: source.config.hls ? "hls" : "dash",
    title: source.config.title ?? source.label, poster: source.config.poster ?? "", startOffset: "", timeline: "default",
  };
}

export function initialDraft(source: VegaSource): ConfigurationDraft {
  return { ...presetDraft(source), autoplay: true, muted: true, videoForwardDuration: "", audioForwardDuration: "", maxVideoBitrate: "" };
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

/** Only validated objects cross into the modular SDK's creation/load path. */
export function parseConfiguration(draft: ConfigurationDraft): Configuration {
  const url = httpUrl(draft.url, "Source URL");
  if (!["hls", "dash", "progressive"].includes(draft.type)) throw new Error("Select a supported source type.");
  const title = draft.title.trim();
  const poster = draft.poster.trim() ? httpUrl(draft.poster, "Poster URL") : "";
  const startOffset = optionalNumber(draft.startOffset, "Start offset");
  const video = optionalNumber(draft.videoForwardDuration, "Video forward buffer");
  const audio = optionalNumber(draft.audioForwardDuration, "Audio forward buffer");
  if ((video !== undefined && video <= 0) || (audio !== undefined && audio <= 0)) throw new Error("This screen requires positive buffer targets; leave blank for the SDK default.");
  const maxVideoBitrate = optionalNumber(draft.maxVideoBitrate, "Maximum video bitrate");
  if (maxVideoBitrate !== undefined && maxVideoBitrate <= 0) throw new Error("Maximum video bitrate must be positive; leave blank for no cap.");
  const reference = draft.timeline === "start" ? TimelineReferencePoint.Start : draft.timeline === "end" ? TimelineReferencePoint.End : undefined;
  const media = draft.type === "hls" ? { hls: url } : draft.type === "dash" ? { dash: url } : { progressive: url };
  return {
    source: {
      ...media, ...(title ? { title } : {}), ...(poster ? { poster } : {}),
      ...(startOffset !== undefined || reference !== undefined ? { options: {
        ...(startOffset !== undefined ? { startOffset } : {}),
        ...(reference !== undefined ? { startOffsetTimelineReference: reference } : {}),
      } } : {}),
    },
    player: {
      playback: { autoplay: draft.autoplay, muted: draft.muted },
      ...(video !== undefined || audio !== undefined ? { buffer: {
        ...(video !== undefined ? { video: { forwardduration: video } } : {}),
        ...(audio !== undefined ? { audio: { forwardduration: audio } } : {}),
      } } : {}),
      ...(maxVideoBitrate !== undefined ? { adaptation: { bitrates: { maxSelectableVideoBitrate: maxVideoBitrate } } } : {}),
    },
    draft: { ...draft, url, title, poster, startOffset: startOffset === undefined ? "" : String(startOffset),
      videoForwardDuration: video === undefined ? "" : String(video), audioForwardDuration: audio === undefined ? "" : String(audio),
      maxVideoBitrate: maxVideoBitrate === undefined ? "" : String(maxVideoBitrate) },
  };
}

export function sameConfiguration(left: Configuration, right: Configuration): boolean {
  return JSON.stringify([left.source, left.player]) === JSON.stringify([right.source, right.player]);
}
