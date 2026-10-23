import Foundation

enum InitialSubtitleMode: String, CaseIterable, Identifiable {
    case automatic = "Automatic"
    case off = "Off"
    case language = "Preferred language"
    var id: Self { self }
}

/// Application preferences, not properties of the SDK's PlayerConfig.
struct InitialTrackPreferences: Equatable {
    var audioLanguage: String?
    var subtitleMode: InitialSubtitleMode = .automatic
    var subtitleLanguage: String?

    var usesSelectionApi: Bool { audioLanguage != nil || subtitleMode != .automatic }

    static func language(_ text: String, field: String, required: Bool = false) throws -> String? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.isEmpty {
            guard !required else {
                throw ConfigurationValidationError(message: "\(field) is required when Preferred language is selected.")
            }
            return nil
        }
        guard value.range(of: "^[a-z]{2,3}(-[a-z0-9]{2,8})*$", options: .regularExpression) != nil else {
            throw ConfigurationValidationError(message: "\(field) must be a two- or three-letter language code, optionally followed by script or region subtags (for example de or en-US).")
        }
        return value
    }

    /// Match the full tag before falling back to a track with the same primary language.
    static func matchingIdentifier(_ language: String, tracks: [(identifier: String, language: String?)]) -> String? {
        let requested = language.lowercased()
        if let exact = tracks.first(where: { $0.language?.lowercased() == requested }) {
            return exact.identifier
        }
        let primary = requested.split(separator: "-").first
        return tracks.first { $0.language?.lowercased().split(separator: "-").first == primary }?.identifier
    }
}

/// A selection is claimed before invoking the SDK, so synchronous callbacks cannot repeat it.
struct InitialTrackSelectionGate {
    private var source: ObjectIdentifier?
    private var applied = false
    private var ready = false
    private var loaded = false

    mutating func bind(_ source: AnyObject) {
        guard self.source != ObjectIdentifier(source) else { return }
        self.source = ObjectIdentifier(source)
        applied = false
        ready = false
        loaded = false
    }

    mutating func retire() { source = nil; applied = false; ready = false; loaded = false }

    func owns(_ source: AnyObject) -> Bool { self.source == ObjectIdentifier(source) }

    /// Ready and SourceLoaded may arrive in either order for a cached HLS source.
    /// Retain both facts for the intended source before attempting its preferences.
    mutating func recordReady(eventSource: AnyObject, currentSource: AnyObject) -> Bool {
        guard owns(eventSource), eventSource === currentSource else { return false }
        ready = true
        return loaded && !applied
    }

    mutating func recordLoaded(eventSource: AnyObject, currentSource: AnyObject) -> Bool {
        guard owns(eventSource), eventSource === currentSource else { return false }
        loaded = true
        return ready && !applied
    }

    mutating func claim(eventSource: AnyObject, currentSource: AnyObject) -> Bool {
        guard !applied, source == ObjectIdentifier(eventSource), eventSource === currentSource else { return false }
        applied = true
        return true
    }
}

struct PlaybackTrackStatus: Equatable {
    var audio = "Not loaded"
    var subtitles = "Not loaded"
    var position: TimeInterval = 0
}
