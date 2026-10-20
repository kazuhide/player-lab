import Foundation
import BitmovinPlayer

enum SourceFormat: String, CaseIterable, Identifiable {
    case hls = "HLS"
    case progressive = "Progressive MP4"
    var id: Self { self }
    var sdkType: SourceType { self == .hls ? .hls : .progressive }
}

enum OffsetReference: String, CaseIterable, Identifiable {
    case automatic = "Automatic"
    case start = "Start"
    case end = "End"
    var id: Self { self }
    var sdkValue: TimelineReferencePoint {
        switch self {
        case .automatic: return .auto
        case .start: return .start
        case .end: return .end
        }
    }
}

struct SourceSettings: Equatable {
    var url: URL
    var type: SourceFormat
    var title: String
    var posterURL: URL?
    var startOffset: TimeInterval?
    var timelineReference: OffsetReference = .automatic

    init(_ source: ShowcaseSource) {
        url = source.url
        // The Apple preset catalog contains supported HLS sources only.
        type = .hls
        title = source.label
    }

    init(url: URL, type: SourceFormat, title: String, posterURL: URL?,
         startOffset: TimeInterval?, timelineReference: OffsetReference) {
        self.url = url
        self.type = type
        self.title = title
        self.posterURL = posterURL
        self.startOffset = startOffset
        self.timelineReference = timelineReference
    }

    func makeSourceConfig() -> SourceConfig {
        let config = SourceConfig(url: url, type: type.sdkType)
        config.title = title.isEmpty ? nil : title
        config.posterSource = posterURL
        if let startOffset { config.options.startOffset = startOffset }
        config.options.startOffsetTimelineReference = timelineReference.sdkValue
        return config
    }
}

struct PlayerSettings: Equatable {
    var autoplay = false
    var startMuted = true
    var sdkTimeShiftEnabled = true
    var maximumBitrate: UInt = 0
    var forwardBuffer: TimeInterval = 0

    func apply(to config: PlayerConfig) {
        config.playbackConfig.isAutoplayEnabled = autoplay
        config.playbackConfig.isMuted = startMuted
        config.playbackConfig.isTimeShiftEnabled = sdkTimeShiftEnabled
        config.adaptationConfig.maxSelectableBitrate = maximumBitrate
        config.bufferConfig.audioAndVideo.forwardDuration = forwardBuffer
    }
}

struct ValidatedConfiguration: Equatable {
    let source: SourceSettings
    let player: PlayerSettings
}

enum ConfigurationEffect: Equatable {
    case none, reloadSource, recreatePlayer

    var description: String {
        switch self {
        case .none: return "No configuration changes"
        case .reloadSource: return "Reload source"
        case .recreatePlayer: return "Recreate player and reload source"
        }
    }
}

/// Text stays in a draft until all fields validate. No SDK object is mutated during editing.
struct ConfigurationDraft: Equatable {
    var sourceURL: String
    var sourceType: SourceFormat
    var title: String
    var posterURL: String
    var startOffset: String
    var timelineReference: OffsetReference
    var autoplay: Bool
    var startMuted: Bool
    var sdkTimeShiftEnabled: Bool
    var maximumBitrate: String
    var forwardBuffer: String

    init(source: SourceSettings? = nil, player: PlayerSettings = PlayerSettings()) {
        let source = source ?? SourceSettings(Sources.all[0])
        sourceURL = source.url.absoluteString
        sourceType = source.type
        title = source.title
        posterURL = source.posterURL?.absoluteString ?? ""
        startOffset = source.startOffset.map(Self.numberText) ?? ""
        timelineReference = source.timelineReference
        autoplay = player.autoplay
        startMuted = player.startMuted
        sdkTimeShiftEnabled = player.sdkTimeShiftEnabled
        maximumBitrate = String(player.maximumBitrate)
        forwardBuffer = Self.numberText(player.forwardBuffer)
    }

    func validated() throws -> ValidatedConfiguration {
        let url = try Self.httpURL(sourceURL, field: "Source URL")
        let posterText = posterURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let poster = posterText.isEmpty ? nil : try Self.httpURL(posterText, field: "Poster URL")
        let offsetText = startOffset.trimmingCharacters(in: .whitespacesAndNewlines)
        let offset = offsetText.isEmpty ? nil : try Self.number(offsetText, field: "Start offset")
        guard let bitrate = UInt(maximumBitrate.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw ConfigurationValidationError(message: "Maximum bitrate must be a nonnegative whole number in bit/s.")
        }
        let buffer = try Self.number(forwardBuffer, field: "Forward buffer")
        guard buffer >= 0 else {
            throw ConfigurationValidationError(message: "Forward buffer must be zero or greater seconds.")
        }
        return ValidatedConfiguration(
            source: SourceSettings(url: url, type: sourceType, title: title,
                                   posterURL: poster, startOffset: offset, timelineReference: timelineReference),
            player: PlayerSettings(autoplay: autoplay, startMuted: startMuted,
                                   sdkTimeShiftEnabled: sdkTimeShiftEnabled,
                                   maximumBitrate: bitrate, forwardBuffer: buffer))
    }

    private static func httpURL(_ text: String, field: String) throws -> URL {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host, !host.isEmpty else {
            throw ConfigurationValidationError(message: "\(field) must be an absolute HTTP or HTTPS URL.")
        }
        return url
    }

    private static func number(_ text: String, field: String) throws -> Double {
        guard let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)), value.isFinite else {
            throw ConfigurationValidationError(message: "\(field) must be a finite number of seconds.")
        }
        return value
    }

    private static func numberText(_ value: Double) -> String {
        let text = String(value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }
}

struct ConfigurationValidationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
