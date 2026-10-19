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
    // The Apple SDK accepts HLS and progressive MP4, not DASH. Loading DASH is a
    // precondition failure, so the Apple catalog only exposes supported HLS sources.
    // Source: https://github.com/bitmovin/bitmovin-player-ios-samples#available-sample-apps
    static let all: [ShowcaseSource] = [
        ShowcaseSource(
            id: "live-hls", label: "Live HLS", kind: .liveHls,
            url: URL(string: "https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8")!
        ),
        // VOD
        ShowcaseSource(
            id: "vod-hls", label: "VOD HLS", kind: .vodHls,
            url: URL(string: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8")!
        ),
    ]
}
