import type { SourceConfig } from "bitmovin-player";

export type SourceKind = "live-hls" | "live-dash" | "vod-hls" | "vod-dash";

export interface ShowcaseSource {
  id: string;
  label: string;
  kind: SourceKind;
  isLive: boolean;
  config: SourceConfig;
}

// ---------------------------------------------------------------------------
// Live sources. The DEFAULTS are public reference streams that are genuinely
// live right now (verified 2026-06-19: DASH type="dynamic" with a real
// timeShiftBufferDepth / HLS with no EXT-X-ENDLIST), so the demo shows actual
// Live DVR out of the box — no running encoder required. Override the env vars
// to point at this project's own Bitmovin live channel when it is running (that
// channel finalizes to VOD when stopped, which is why it must not be the default).
// ---------------------------------------------------------------------------
const LIVE_DASH =
  import.meta.env.VITE_LIVE_DASH_URL ??
  // BBC R&D testcard — Akamai-backed, continuously live (type="dynamic"), 15-min DVR
  // window, and one rich stream: multi-language audio (deu/eng/fra) AND subtitles
  // (deu/eng/fra). Reliable default. DASH-IF livesim2 was the prior default but
  // rate-limits (HTTP 429) under repeated loads, so it broke the app out of the box.
  "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd";
const LIVE_HLS =
  import.meta.env.VITE_LIVE_HLS_URL ??
  // Unified Streaming — live HLS, sliding window (no EXT-X-ENDLIST).
  "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8";

// VOD reference streams (Unified Streaming Tears of Steel + DASH-IF), verified.
const VOD_HLS =
  "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8";
const VOD_DASH = "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd";

// Feature demos require your own asset URLs in the VITE_VOD_* variables below.
// Unset URLs stay empty; all demo presets remain available.
// Provisioned Bitmovin VOD with a sprite thumbnail track (scrub preview). The VTT is
// the player's thumbnailTrack; built by encoding/test-streams/vod-sprites.yaml.
const VOD_SPRITES_HLS =
  import.meta.env.VITE_VOD_SPRITES_HLS_URL ?? "";
const VOD_SPRITES_VTT =
  import.meta.env.VITE_VOD_SPRITES_VTT_URL ?? "";

// Provisioned Bitmovin VOD with two selectable audio tracks (en default + de).
const VOD_MULTIAUDIO_HLS =
  import.meta.env.VITE_VOD_MULTIAUDIO_HLS_URL ?? "";

// Sideloaded WebVTT subtitle (en), loaded client-side via SourceConfig.subtitleTracks.
// Re-timed Sintel subtitles; see encoding/test-streams/assets/.
const VOD_SUBTITLE_VTT =
  import.meta.env.VITE_VOD_SUBTITLE_VTT_URL ?? "";

export const SOURCES: ShowcaseSource[] = [
  // VOD first — the DEFAULT (index 0) loads instantly and reliably, so the app always
  // opens to a working player. Live is one click away.
  { id: "vod-hls", label: "VOD HLS", kind: "vod-hls", isLive: false, config: { hls: VOD_HLS, title: "VOD HLS (Tears of Steel)" } },
  { id: "vod-dash", label: "VOD DASH", kind: "vod-dash", isLive: false, config: { dash: VOD_DASH, title: "VOD DASH (Big Buck Bunny)" } },
  // Live (genuinely live + DVR window). One rich BBC testcard stream carries DVR +
  // multi-audio (deu/eng/fra) + subtitles, so it isn't split into duplicate buttons;
  // switch audio / enable subtitles from the player's own track controls.
  { id: "live-dash", label: "Live DASH + DVR", kind: "live-dash", isLive: true, config: { dash: LIVE_DASH, title: "Live DASH — DVR · multi-audio · subtitles (BBC R&D testcard, 15-min window)" } },
  { id: "live-hls", label: "Live HLS", kind: "live-hls", isLive: true, config: { hls: LIVE_HLS, title: "Live HLS (Unified Streaming)" } },
  // VOD feature demos
  {
    id: "vod-sprites",
    label: "VOD + Sprites",
    kind: "vod-hls",
    isLive: false,
    config: { hls: VOD_SPRITES_HLS, title: "VOD HLS + sprite scrubbing", thumbnailTrack: { url: VOD_SPRITES_VTT } },
  },
  {
    id: "vod-multiaudio",
    label: "VOD + Multi-audio",
    kind: "vod-hls",
    isLive: false,
    config: { hls: VOD_MULTIAUDIO_HLS, title: "VOD HLS + multi-audio (en/de)" },
  },
  {
    id: "vod-subtitles",
    label: "VOD + Subtitles",
    kind: "vod-hls",
    isLive: false,
    config: {
      hls: VOD_HLS,
      title: "VOD HLS + sideloaded WebVTT subtitles (en)",
      subtitleTracks: [{ url: VOD_SUBTITLE_VTT, id: "sub-en", lang: "en", label: "English", kind: "subtitle" }],
    },
  },
];

/** Missing environment settings for a preset's required media. */
export function missingSourceSettings(source: ShowcaseSource): string[] {
  const hasUrl = (url: unknown): boolean => typeof url === "string" && url.trim().length > 0;
  const required: [string, unknown][] = source.id === "vod-sprites" ? [
    ["VITE_VOD_SPRITES_HLS_URL", source.config.hls],
    ["VITE_VOD_SPRITES_VTT_URL", source.config.thumbnailTrack?.url],
  ] : source.id === "vod-multiaudio" ? [
    ["VITE_VOD_MULTIAUDIO_HLS_URL", source.config.hls],
  ] : source.id === "vod-subtitles" ? [
    ["VITE_VOD_SUBTITLE_VTT_URL", source.config.subtitleTracks?.[0]?.url],
  ] : source.kind === "live-hls" ? [["VITE_LIVE_HLS_URL", source.config.hls]]
    : source.kind === "live-dash" ? [["VITE_LIVE_DASH_URL", source.config.dash]] : [];
  return required.filter(([, url]) => !hasUrl(url)).map(([name]) => name);
}

/** Advance through configured episodes, preserving their original order. */
export function nextPlaylistSource(sources: ShowcaseSource[], playlist: string[], currentId: string): ShowcaseSource | undefined {
  const current = playlist.indexOf(currentId);
  for (let step = 1; step <= playlist.length; step++) {
    const id = playlist[(current + step) % playlist.length];
    const source = sources.find((candidate) => candidate.id === id);
    if (source && missingSourceSettings(source).length === 0) return source;
  }
  return undefined;
}
