import Foundation
import BitmovinPlayer

struct Caption: Decodable {
    let url: String
    let language: String
    let label: String
}

enum Media {
    static func setting(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func url(_ path: String) throws -> URL {
        let configured = setting("MediaBaseURL")
        let baseURL = configured.isEmpty ? "http://127.0.0.1:8621/" : configured
        guard let base = URL(string: baseURL),
              let url = URL(string: path, relativeTo: base)?.absoluteURL,
              ["https", "http"].contains(url.scheme), url.host != nil else {
            throw URLError(.badURL)
        }
        return url
    }

    static func fetch<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
        let request = URLRequest(url: try url(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func source(path: String, title: String, videoId: String, captions: [Caption],
                       isLive: Bool, origin: String? = nil) throws -> Source {
        let config = SourceConfig(url: try url(path), type: .hls)
        config.title = title
        for caption in captions {
            config.add(subtitleTrack: SubtitleTrack(url: try url(caption.url), format: .webVtt,
                label: caption.label, identifier: caption.language, isDefaultTrack: false, language: caption.language))
        }
        let metadata = SourceMetadata(videoId: videoId, title: title, isLive: isLive,
                                      customData: CustomData(customData1: origin))
        return SourceFactory.createSource(from: config, sourceMetadata: metadata)
    }

    static func makePlayer(learnerId: String? = nil) -> Player? {
        let key = setting("BitmovinLicenseKey")
        guard !key.isEmpty else { return nil }
        let config = PlayerConfig()
        config.key = key
        #if os(tvOS)
        config.styleConfig.userInterfaceType = .system
        #else
        config.remoteControlConfig.allowsAirPlay = true
        #endif
        let analyticsKey = setting("AnalyticsLicense")
        let analytics: AnalyticsPlayerConfig = analyticsKey.isEmpty ? .disabled : .enabled(
            analyticsConfig: AnalyticsConfig(licenseKey: analyticsKey),
            defaultMetadata: DefaultMetadata(customUserId: learnerId))
        return PlayerFactory.createPlayer(playerConfig: config, analytics: analytics)
    }

    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0, seconds < Double(Int.max) else { return "—" }
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}
