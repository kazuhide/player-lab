/**
 * Test streams used by the E2E specs.
 *
 * - REFERENCE.* — public reference streams (DASH-IF reference player, Unified
 *   Streaming, BBC R&D). Every URL was fetched and its manifest inspected on
 *   2026-06-19; the comment records the marker that was confirmed present. Live
 *   entries are genuinely live (DASH type="dynamic" / HLS without EXT-X-ENDLIST)
 *   with a real DVR window. Re-verify by fetching the URL and grepping the marker.
 * - PROVISIONED.* — your hosted Bitmovin one-shot VOD outputs, verified by the
 *   per-feature specs. Configure VITE_TEST_STREAM_BASE_URL in the test runner.
 */
export const REFERENCE = {
  // ---- Live (genuinely live, with a DVR/timeshift window) ----
  /** DASH-IF livesim2, 300s DVR window. type="dynamic", timeShiftBufferDepth="PT5M". */
  liveDashDvr300: "https://livesim2.dashif.org/livesim2/tsbd_300/testpic_2s/Manifest.mpd",
  /** DASH-IF livesim2, 60s DVR window. type="dynamic", timeShiftBufferDepth="PT1M". */
  liveDashDvr60: "https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd",
  /** BBC R&D testcard — live, 15min DVR, multi-language audio (deu/eng/fra).
   *  type="dynamic", timeShiftBufferDepth="PT15M". This is the akamai origin that
   *  rdmedia.bbc.co.uk/testcard/simulcast/manifests/avc-full.mpd 301-redirects to;
   *  the resolved URL is used directly to avoid player manifest-redirect handling. */
  liveDashMultiAudio: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
  /** DASH-IF livesim2 — live, 5 segmented TTML subtitle AdaptationSets. type="dynamic". */
  liveDashSubtitles: "https://livesim2.dashif.org/livesim2/testpic_2s/multi_subs.mpd",
  /** DASH-IF livesim2 — live, 1 image AdaptationSet (thumbnail tiles). type="dynamic". */
  liveDashThumbnails: "https://livesim2.dashif.org/livesim2/testpic_2s/Manifest_thumbs.mpd",
  /** Unified Streaming — live HLS, sliding window (no EXT-X-ENDLIST in the variant). */
  liveHls: "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8",

  // ---- VOD ----
  /** Unified Streaming Tears of Steel — VOD HLS, 7-variant ABR ladder. */
  vodHls: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
  /** Unified Streaming Tears of Steel — VOD DASH. */
  vodDash: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.mpd",
  /** DASH-IF Big Buck Bunny — VOD DASH (on-demand profile). */
  vodDashBbb: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd",
} as const;

// Back-compat aliases used by existing specs (now pointing at verified URLs).
export const PUBLIC_VOD_HLS = REFERENCE.vodHls;
export const PUBLIC_VOD_DASH = REFERENCE.vodDashBbb;

const PROVISIONED_BASE = (process.env.VITE_TEST_STREAM_BASE_URL ?? "").trim().replace(/\/+$/, "");
const provisionedUrl = (path: string): string => PROVISIONED_BASE ? `${PROVISIONED_BASE}/${path}` : "";

export const PROVISIONED = {
  /** vod-baseline — H.264 360p/480p ladder, DASH+HLS, video-only (10s sample). */
  vodBaselineHls: provisionedUrl("vod-baseline/master.m3u8"),
  vodBaselineDash: provisionedUrl("vod-baseline/manifest.mpd"),
  /** vod-hevc — H.265 (hvc1) 480p, DASH+HLS, video-only (10s sample). */
  vodHevcHls: provisionedUrl("vod-hevc/master.m3u8"),
  vodHevcDash: provisionedUrl("vod-hevc/manifest.mpd"),
  /** vod-sprites — H.264 480p + WebVTT sprite sheet (scrub preview). The VTT is the
   *  player's SourceConfig.thumbnailTrack; cues point at sprite-0.jpg#xywh=… tiles
   *  (160×90 every 5s). */
  vodSpritesHls: provisionedUrl("vod-sprites/master.m3u8"),
  vodSpritesVtt: provisionedUrl("vod-sprites/thumbnails/thumbnails.vtt"),
  /** vod-multiaudio — H.264 480p + two AAC audio renditions (en default + de) from
   *  distinct sources, in one HLS media.audio group. getAvailableAudio() lists both;
   *  setAudio() switches. HLS only. */
  vodMultiAudioHls: provisionedUrl("vod-multiaudio/master.m3u8"),
  /** subtitle VTT (en) — sideloaded onto any video via SourceConfig.subtitleTracks.
   *  Re-timed Sintel subtitles (text/vtt, PUBLIC_READ); see encoding/test-streams/assets. */
  subtitleVttEn: provisionedUrl("assets/sintel_en.vtt"),
} as const;

/** Fail in a suite's beforeAll hook, before opening a player with unavailable media. */
export function requireProvisionedStreams(): void {
  const base = process.env.VITE_TEST_STREAM_BASE_URL?.trim();
  if (!base) throw new Error("Provisioned media is not configured. Export VITE_TEST_STREAM_BASE_URL before running these scenarios; see tests/e2e/README.md.");
  let parsed: URL;
  try { parsed = new URL(base); } catch { throw new Error("VITE_TEST_STREAM_BASE_URL must be an absolute HTTP or HTTPS media base URL."); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.search || parsed.hash) {
    throw new Error("VITE_TEST_STREAM_BASE_URL must be an absolute HTTP or HTTPS media base URL without a query or fragment.");
  }
}
