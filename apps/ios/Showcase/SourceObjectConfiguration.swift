import Foundation
import AVFoundation
import BitmovinPlayer

extension AdvancedConfiguration {
    static var sourceObjectFields: [AdvancedConfigurationField] {
        [
            .init("SourceConfig.metadata", .source, "metadata", .text, "JSON object, for example {\"category\":\"sample\"}. This editor supports JSON values, not AVMetadataItem instances."),
            .init("SourceConfig.drmConfig", .source, "drmConfig", .choice(["none", "fairplay", "clearKey"]), "Select DRM, then enter its fields below. FairPlay playback needs compatible encrypted HLS, a certificate and a license service."),
            .init("DrmConfig.licenseUrl", .source, "drmConfig.licenseUrl", .url),
            .init("DrmConfig.uuid", .source, "drmConfig.uuid", .text, "Optional UUID override. Leave this override disabled to keep the DRM system's UUID."),
            .init("FairplayConfig.certificateUrl", .source, "drmConfig.certificateUrl", .url),
            .init("FairplayConfig.licenseRequestHeaders", .source, "drmConfig.licenseRequestHeaders", .text, "JSON string dictionary, for example {\"X-Example\":\"value\"}. Values are redacted from exported code."),
            .init("FairplayConfig.certificateRequestHeaders", .source, "drmConfig.certificateRequestHeaders", .text, "JSON string dictionary. Values are redacted from exported code."),
            .init("DecryptionKey.key", .source, "drmConfig.decryptionKeys[0].key", .text, "ClearKey content key in hexadecimal. Kept in memory and redacted from exported code."),
            .init("DecryptionKey.kid", .source, "drmConfig.decryptionKeys[0].kid", .text, "Optional key identifier in hexadecimal."),
            .init("Track.url", .source, "tracks[0].url", .url, "External subtitle URL. Enabling any subtitle field creates one typed subtitle track."),
            .init("Track.identifier", .source, "tracks[0].identifier", .text),
            .init("Track.label", .source, "tracks[0].label", .text),
            .init("Track.isDefaultTrack", .source, "tracks[0].isDefaultTrack", .boolean),
            .init("SubtitleTrack.format", .source, "tracks[0].format", .choice(["webVtt", "ttml", "cea", "srt"])),
            .init("SubtitleTrack.language", .source, "tracks[0].language", .text),
            .init("SubtitleTrack.associatedLanguage", .source, "tracks[0].associatedLanguage", .text),
            .init("SubtitleTrack.characteristics", .source, "tracks[0].characteristics", .text, "JSON array of strings; for example [\"public.accessibility.transcribes-spoken-dialog\"]."),
            .init("SubtitleTrack.isForced", .source, "tracks[0].isForced", .boolean),
            .init("SourceConfig.thumbnailTrack", .source, "thumbnailTrack", .url, "URL of an external thumbnail track, such as a WebVTT thumbnail index."),
            .init("ThumbnailTrack.label", .source, "thumbnailTrack.label", .text, "Inherited Track.label, for the thumbnail track."),
            .init("ThumbnailTrack.identifier", .source, "thumbnailTrack.identifier", .text, "Inherited Track.identifier, for the thumbnail track."),
            .init("ThumbnailTrack.isDefaultTrack", .source, "thumbnailTrack.isDefaultTrack", .boolean, "Inherited Track.isDefaultTrack, for the thumbnail track."),
            .init("SystemUserInterfaceConfig.subtitleStyles", .player, "styleConfig.userInterfaceConfig.subtitleStyles", .text, "JSON text-markup attributes for one AVTextStyleRule. Requires System UI."),
            .init("SubtitleUserInterfaceConfig.subtitleStyles", .player, "styleConfig.userInterfaceConfig.subtitleStyles", .text, "JSON text-markup attributes for one AVTextStyleRule. Requires Subtitle UI."),
        ]
    }

    static func normalizeSourceObjectValue(_ value: String, id: String) throws -> String {
        switch id {
        case "SourceConfig.metadata", "SystemUserInterfaceConfig.subtitleStyles", "SubtitleUserInterfaceConfig.subtitleStyles":
            let object = try parseJsonObject(value, id: id)
            if id.hasSuffix("subtitleStyles"), AVTextStyleRule(textMarkupAttributes: object) == nil {
                throw ConfigurationValidationError(message: "\(id) contains invalid AVTextStyleRule attributes.")
            }
            return try normalizedJson(object)
        case "FairplayConfig.licenseRequestHeaders", "FairplayConfig.certificateRequestHeaders":
            guard let headers = try parseJsonObject(value, id: id) as? [String: String] else {
                throw ConfigurationValidationError(message: "\(id) requires a JSON object with string values.")
            }
            return try normalizedJson(headers)
        case "SubtitleTrack.characteristics":
            guard let strings = try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String] else {
                throw ConfigurationValidationError(message: "Subtitle characteristics require a JSON array of strings.")
            }
            return try normalizedJson(strings)
        case "DrmConfig.uuid":
            guard let uuid = UUID(uuidString: value) else { throw ConfigurationValidationError(message: "DrmConfig.uuid requires a valid UUID.") }
            return uuid.uuidString
        case "DecryptionKey.key", "DecryptionKey.kid":
            guard (id.hasSuffix("kid") && value.isEmpty) || (!value.isEmpty && value.count.isMultiple(of: 2) && value.allSatisfy({ $0.isHexDigit && $0.isASCII })) else {
                throw ConfigurationValidationError(message: "\(id) must contain complete hexadecimal byte pairs.")
            }
            return value.lowercased()
        default: return try normalizeAdvertisingValue(value, id: id)
        }
    }

    func validateSourceObjects() throws {
        let drm = values["SourceConfig.drmConfig"] ?? "none"
        let hasFairplay = values.keys.contains { $0.hasPrefix("FairplayConfig.") }
        let hasKey = values.keys.contains { $0.hasPrefix("DecryptionKey.") }
        if hasFairplay && drm != "fairplay" { throw ConfigurationValidationError(message: "Select FairPlay in SourceConfig.drmConfig before editing FairPlay fields.") }
        if hasKey && drm != "clearKey" { throw ConfigurationValidationError(message: "Select ClearKey in SourceConfig.drmConfig before editing a decryption key.") }
        if values.keys.contains(where: { $0.hasPrefix("DrmConfig.") }) && drm == "none" {
            throw ConfigurationValidationError(message: "Select a DRM system before editing DrmConfig fields.")
        }
        if drm == "fairplay" && (values["FairplayConfig.certificateUrl"] ?? "").isEmpty {
            throw ConfigurationValidationError(message: "FairPlay requires FairplayConfig.certificateUrl.")
        }
        if drm == "clearKey" && (values["DecryptionKey.key"] ?? "").isEmpty {
            throw ConfigurationValidationError(message: "ClearKey requires DecryptionKey.key.")
        }
        if hasSubtitleFields && (values["Track.url"] ?? "").isEmpty {
            throw ConfigurationValidationError(message: "An external subtitle requires Track.url.")
        }
        if values.keys.contains(where: { $0.hasPrefix("ThumbnailTrack.") }) && (values["SourceConfig.thumbnailTrack"] ?? "").isEmpty {
            throw ConfigurationValidationError(message: "Thumbnail track fields require SourceConfig.thumbnailTrack URL.")
        }
        if values.keys.contains(where: { $0.hasPrefix("SubtitleUserInterfaceConfig.") }) && values["StyleConfig.userInterfaceType"] != "subtitle" {
            throw ConfigurationValidationError(message: "Select Subtitle in StyleConfig.userInterfaceType before editing Subtitle UI fields.")
        }
    }

    var hasSubtitleFields: Bool { values.keys.contains { $0.hasPrefix("Track.") || $0.hasPrefix("SubtitleTrack.") } }

    func makeSubtitleTrack() -> SubtitleTrack? {
        guard hasSubtitleFields, let url = values["Track.url"].flatMap(URL.init(string:)) else { return nil }
        let format: SubtitleFormat
        switch values["SubtitleTrack.format"] ?? "webVtt" {
        case "ttml": format = .ttml
        case "cea": format = .cea
        case "srt": format = .srt
        default: format = .webVtt
        }
        return SubtitleTrack(url: url, format: format,
            label: values["Track.label"] ?? "External subtitles",
            identifier: values["Track.identifier"] ?? "player-lab-external",
            isDefaultTrack: values["Track.isDefaultTrack"] == "true",
            language: nonempty("SubtitleTrack.language"), forced: values["SubtitleTrack.isForced"] == "true",
            associatedLanguage: nonempty("SubtitleTrack.associatedLanguage"),
            characteristics: jsonValue("SubtitleTrack.characteristics") as? [String] ?? [])
    }

    func applySourceObjects(to config: SourceConfig) {
        if let metadata = jsonValue("SourceConfig.metadata") as? [String: Any] { config.metadata = metadata }
        if let track = makeSubtitleTrack() { config.add(subtitleTrack: track) }
        if values["SourceConfig.thumbnailTrack"] != nil {
            config.thumbnailTrack = nonempty("SourceConfig.thumbnailTrack").flatMap(URL.init(string:)).map { url in
              ThumbnailTrack(url: url, label: values["ThumbnailTrack.label"] ?? "Thumbnails",
                identifier: values["ThumbnailTrack.identifier"] ?? "player-lab-thumbnails",
                isDefaultTrack: values["ThumbnailTrack.isDefaultTrack"] == "true")
            }
        }
        switch values["SourceConfig.drmConfig"] {
        case "none": config.drmConfig = nil
        case "fairplay":
            let fairplay = FairplayConfig(license: nonempty("DrmConfig.licenseUrl").flatMap(URL.init(string:)),
                certificateURL: URL(string: values["FairplayConfig.certificateUrl"]!)!)
            fairplay.licenseRequestHeaders = jsonValue("FairplayConfig.licenseRequestHeaders") as? [String: String]
            fairplay.certificateRequestHeaders = jsonValue("FairplayConfig.certificateRequestHeaders") as? [String: String]
            config.drmConfig = fairplay
        case "clearKey":
            config.drmConfig = ClearKeyConfig(decryptionKeys: [DecryptionKey(kid: nonempty("DecryptionKey.kid"), key: values["DecryptionKey.key"]!)])
        default: break
        }
        if let url = values["DrmConfig.licenseUrl"] { config.drmConfig?.licenseUrl = url.isEmpty ? nil : URL(string: url) }
        if let uuid = values["DrmConfig.uuid"].flatMap(UUID.init(uuidString:)) { config.drmConfig?.uuid = uuid }
    }

    func applySourceObjectUI(to config: PlayerConfig) {
        if let attributes = jsonValue("SystemUserInterfaceConfig.subtitleStyles") as? [String: Any],
           let ui = config.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig,
           let rule = AVTextStyleRule(textMarkupAttributes: attributes) { ui.subtitleStyles = [rule] }
        if let attributes = jsonValue("SubtitleUserInterfaceConfig.subtitleStyles") as? [String: Any],
           let rule = AVTextStyleRule(textMarkupAttributes: attributes) {
            let ui = SubtitleUserInterfaceConfig()
            ui.subtitleStyles = [rule]
            config.styleConfig.userInterfaceConfig = ui
        }
    }

    private static func label(_ template: String, label: String, language: String?, id: String) -> String {
        template.replacingOccurrences(of: "{label}", with: label)
            .replacingOccurrences(of: "{language}", with: language ?? "und")
            .replacingOccurrences(of: "{id}", with: id)
    }

    static func prepareSpc(_ data: Data, assetId: String, mode: String) -> Data {
        switch mode {
        case "base64": return Data(data.base64EncodedString().utf8)
        case "formSpc":
            var form = URLComponents()
            form.queryItems = [URLQueryItem(name: "spc", value: data.base64EncodedString()), URLQueryItem(name: "assetId", value: assetId)]
            // A literal '+' is ambiguous to application/x-www-form-urlencoded servers.
            return Data((form.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        case "jsonSpc": return (try? JSONSerialization.data(withJSONObject: ["spc": data.base64EncodedString(), "assetId": assetId], options: [.sortedKeys])) ?? data
        default: return data
        }
    }

    static func prepareDrmResponse(_ data: Data, mode: String) -> Data {
        if mode == "base64", let text = String(data: data, encoding: .utf8), let decoded = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)) { return decoded }
        if mode == "jsonCkc", let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let text = object["ckc"] as? String, let decoded = Data(base64Encoded: text) { return decoded }
        return data
    }

    func nonempty(_ id: String) -> String? { values[id].flatMap { $0.isEmpty ? nil : $0 } }
    func jsonValue(_ id: String) -> Any? { values[id].flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } }

    private static func parseJsonObject(_ value: String, id: String) throws -> [String: Any] {
        guard let object = try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any] else {
            throw ConfigurationValidationError(message: "\(id) requires a JSON object.")
        }
        return object
    }

    private static func normalizedJson(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }
}
