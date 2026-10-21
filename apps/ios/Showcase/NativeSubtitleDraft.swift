import Foundation
import BitmovinPlayer

struct NativeSubtitleDraft {
    let url: URL?
    let format: SubtitleFormat
    let formatCode: String
    let label: String
    let identifier: String
    let isDefault: Bool
    let language: String?
    let associatedLanguage: String?
    let characteristics: [String]
    let forced: Bool

    init(_ object: [String: Any]) throws {
        let allowed = Set(["url", "format", "label", "identifier", "isDefaultTrack", "language", "associatedLanguage", "characteristics", "forced"])
        guard object.keys.allSatisfy(allowed.contains) else { throw Self.invalid("Unknown subtitle field. Use url, format, label, identifier, isDefaultTrack, language, associatedLanguage, characteristics and forced.") }
        let rawUrl = try Self.string(object["url"], field: "url")
        if let rawUrl, !rawUrl.isEmpty {
            _ = try ConfigurationInput.url.validate(rawUrl, field: "Subtitle URL")
            url = URL(string: rawUrl)
        } else { url = nil }
        formatCode = try Self.string(object["format"], field: "format") ?? "webVtt"
        switch formatCode {
        case "webVtt": format = .webVtt
        case "ttml": format = .ttml
        case "cea": format = .cea
        case "srt": format = .srt
        default: throw Self.invalid("Subtitle format must be webVtt, ttml, cea or srt.")
        }
        label = try Self.string(object["label"], field: "label") ?? "External subtitles"
        identifier = try Self.string(object["identifier"], field: "identifier") ?? "player-lab-external"
        language = try Self.string(object["language"], field: "language")
        associatedLanguage = try Self.string(object["associatedLanguage"], field: "associatedLanguage")
        if let value = object["characteristics"] {
            guard let values = value as? [String] else { throw Self.invalid("Subtitle characteristics need an array of strings.") }
            characteristics = values
        } else { characteristics = [] }
        isDefault = try Self.boolean(object["isDefaultTrack"], field: "isDefaultTrack")
        forced = try Self.boolean(object["forced"], field: "forced")
    }

    static func parse(_ json: String) throws -> NativeSubtitleDraft {
        guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw invalid("Subtitle input must be a JSON object.") }
        return try Self.init(object)
    }
    static func array(_ json: String) throws -> [NativeSubtitleDraft] {
        guard let objects = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else { throw invalid("SourceConfig.tracks needs an array of subtitle objects.") }
        let tracks = try objects.map(Self.init)
        guard Set(tracks.map(\.identifier)).count == tracks.count else { throw invalid("Subtitle identifiers must be unique within the configured array.") }
        return tracks
    }
    func make() -> SubtitleTrack {
        SubtitleTrack(url: url, format: format, label: label, identifier: identifier, isDefaultTrack: isDefault, language: language, forced: forced,
            associatedLanguage: associatedLanguage, characteristics: characteristics)
    }
    var code: String {
        let strings = "[" + characteristics.map(swiftString).joined(separator: ", ") + "]"
        return "SubtitleTrack(url: \(url.map { "URL(string: \(swiftString($0.absoluteString)))" } ?? "nil"), format: .\(formatCode), label: \(swiftString(label)), identifier: \(swiftString(identifier)), isDefaultTrack: \(isDefault), language: \(language.map(swiftString) ?? "nil"), forced: \(forced), associatedLanguage: \(associatedLanguage.map(swiftString) ?? "nil"), characteristics: \(strings))"
    }
    private static func string(_ value: Any?, field: String) throws -> String? {
        guard let value else { return nil }
        if value is NSNull { return nil }
        guard let value = value as? String else { throw invalid("Subtitle \(field) must be a string or null.") }
        return value
    }
    private static func boolean(_ value: Any?, field: String) throws -> Bool {
        guard let value else { return false }
        guard let value = NativeScriptRuntime.boolean(value) else { throw invalid("Subtitle \(field) must be true or false.") }
        return value
    }
    private static func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
