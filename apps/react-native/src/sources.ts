/** Source definitions — pure TS (no SDK import), so the workspace typechecks it. */

export type SourceKind = "live-hls" | "live-dash" | "vod-hls" | "vod-dash";

export interface ShowcaseSource {
  id: string;
  label: string;
  url: string;
  kind: SourceKind;
  isLive: boolean;
}

// Verified public reference streams (fetched + manifest-inspected 2026-06-19). Live
// defaults are genuinely live with a DVR window so the demo works without a running
// encoder; point them at this project's Bitmovin live channel when it runs.
export const SOURCES: ShowcaseSource[] = [
  {
    id: "live-dash",
    label: "Live DASH + DVR",
    // BBC R&D testcard — type="dynamic", 15-min DVR window (Akamai). livesim2 was the
    // prior default but rate-limits (HTTP 429), so the app opened to a dead source.
    url: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
    kind: "live-dash",
    isLive: true,
  },
  {
    id: "live-hls",
    label: "Live HLS",
    url: "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8",
    kind: "live-hls",
    isLive: true,
  },
  {
    id: "live-dash-multiaudio",
    label: "Live DASH + Multi-audio",
    // BBC R&D testcard — live, 15min DVR, multi-language audio (deu/eng/fra).
    url: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
    kind: "live-dash",
    isLive: true,
  },
  {
    id: "live-dash-subtitles",
    label: "Live DASH + Subtitles",
    // BBC R&D testcard — carries deu/eng/fra subtitles (livesim2 rate-limits).
    url: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
    kind: "live-dash",
    isLive: true,
  },
  {
    id: "vod-hls",
    label: "VOD HLS",
    url: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
    kind: "vod-hls",
    isLive: false,
  },
  {
    id: "vod-dash",
    label: "VOD DASH",
    url: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd",
    kind: "vod-dash",
    isLive: false,
  },
];
