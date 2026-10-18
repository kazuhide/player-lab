import Foundation
import BitmovinPlayer

enum SourceKind {
    case liveHls, liveDash, vodHls, vodDash

    var bitmovinType: SourceType {
        switch self {
        case .liveHls, .vodHls: return .hls
        case .liveDash, .vodDash: return .dash
        }
    }
}

struct ShowcaseSource: Identifiable {
    let id: String
    let label: String
    let kind: SourceKind
    let url: URL
    var isLive: Bool { kind == .liveHls || kind == .liveDash }
}

enum Sources {
    // Verified public reference streams (fetched + manifest-inspected 2026-06-19).
    // Live defaults are genuinely live with a DVR window so the demo works without a
    // running encoder; point them at this project's Bitmovin live channel when it runs.
    static let all: [ShowcaseSource] = [
        // Live (genuinely live + DVR window)
        ShowcaseSource(
            id: "live-dash", label: "Live DASH + DVR", kind: .liveDash,
            // BBC R&D testcard — type="dynamic", 15-min DVR window (Akamai). livesim2 was
            // the prior default but rate-limits (HTTP 429), so the app opened to a dead source.
            url: URL(string: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd")!
        ),
        ShowcaseSource(
            id: "live-hls", label: "Live HLS", kind: .liveHls,
            url: URL(string: "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8")!
        ),
        ShowcaseSource(
            id: "live-dash-multiaudio", label: "Live DASH + Multi-audio", kind: .liveDash,
            // BBC R&D testcard — live, 15min DVR, multi-language audio (deu/eng/fra).
            url: URL(string: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd")!
        ),
        ShowcaseSource(
            id: "live-dash-subtitles", label: "Live DASH + Subtitles", kind: .liveDash,
            // BBC R&D testcard — carries deu/eng/fra subtitles (livesim2 rate-limits).
            url: URL(string: "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd")!
        ),
        // VOD
        ShowcaseSource(
            id: "vod-hls", label: "VOD HLS", kind: .vodHls,
            url: URL(string: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8")!
        ),
        ShowcaseSource(
            id: "vod-dash", label: "VOD DASH", kind: .vodDash,
            url: URL(string: "https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd")!
        ),
    ]
}
