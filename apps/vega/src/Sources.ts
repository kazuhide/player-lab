import type { SourceConfig } from "bitmovin-player";

export interface VegaSource {
  id: string;
  label: string;
  isLive: boolean;
  config: SourceConfig;
}

// Verified public reference streams (fetched + manifest-inspected 2026-06-19). Live
// defaults are genuinely live with a DVR window so the demo works without a running
// encoder; point them at this project's Bitmovin live channel when it runs.
export const SOURCES: VegaSource[] = [
  {
    id: "live-dash",
    label: "Live DASH + DVR",
    isLive: true,
    config: {
      title: "Live DASH + DVR (BBC R&D testcard, 15-min window)",
      // BBC R&D testcard — type="dynamic", 15-min DVR window (Akamai; livesim2 rate-limits, HTTP 429).
      dash: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
    },
  },
  {
    id: "live-hls",
    label: "Live HLS",
    isLive: true,
    config: {
      title: "Live HLS (Unified Streaming)",
      hls: "https://demo.unified-streaming.com/k8s/vod2live/stable/unified-learning.isml/.m3u8",
    },
  },
  {
    id: "live-dash-multiaudio",
    label: "Live DASH + Multi-audio",
    isLive: true,
    config: {
      title: "Live DASH + DVR + multi-audio (BBC testcard)",
      // BBC R&D testcard — live, 15min DVR, multi-language audio (deu/eng/fra).
      dash: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
    },
  },
  {
    id: "live-dash-subtitles",
    label: "Live DASH + Subtitles",
    isLive: true,
    config: {
      title: "Live DASH + subtitles (BBC R&D testcard, deu/eng/fra)",
      dash: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
    },
  },
  {
    id: "vod-hls",
    label: "VOD HLS",
    isLive: false,
    config: {
      title: "VOD HLS (Tears of Steel)",
      hls: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
    },
  },
  {
    id: "vod-dash",
    label: "VOD DASH",
    isLive: false,
    config: {
      title: "VOD DASH (Big Buck Bunny)",
      dash: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd",
    },
  },
];
