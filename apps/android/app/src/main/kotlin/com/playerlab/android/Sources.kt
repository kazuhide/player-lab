package com.playerlab.android

import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType

data class PlayerSource(
    val id: String,
    val label: String,
    val url: String,
    val type: SourceType,
    val isLive: Boolean,
) {
    fun toSourceConfig(): SourceConfig = SourceConfig(url = url, type = type)
}

object Sources {
    // Verified public reference streams (fetched + manifest-inspected 2026-06-19).
    // Live defaults are genuinely live with a DVR window so the demo works without a
    // running encoder; point them at this project's Bitmovin live channel when it runs.
    val all: List<PlayerSource> = listOf(
        // Live (genuinely live + DVR window)
        PlayerSource(
            "live-dash", "Live DASH + DVR",
            // BBC R&D testcard — type="dynamic", 15-min DVR window (Akamai). livesim2 was
            // the prior default but rate-limits (HTTP 429), so the app opened to a dead source.
            "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
            SourceType.Dash, isLive = true,
        ),
        PlayerSource(
            "live-hls", "Live HLS",
            "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8",
            SourceType.Hls, isLive = true,
        ),
        PlayerSource(
            "live-dash-multiaudio", "Live DASH + Multi-audio",
            // BBC R&D testcard — live, 15min DVR, multi-language audio (deu/eng/fra).
            "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
            SourceType.Dash, isLive = true,
        ),
        PlayerSource(
            "live-dash-subtitles", "Live DASH + Subtitles",
            // BBC R&D testcard — carries deu/eng/fra subtitles (livesim2 rate-limits).
            "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd",
            SourceType.Dash, isLive = true,
        ),
        // VOD
        PlayerSource(
            "vod-hls", "VOD HLS",
            "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
            SourceType.Hls, isLive = false,
        ),
        PlayerSource(
            "vod-dash", "VOD DASH",
            "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd",
            SourceType.Dash, isLive = false,
        ),
    )
}
