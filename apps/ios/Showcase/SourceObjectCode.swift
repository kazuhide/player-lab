import Foundation

extension AdvancedConfiguration {
    var sourceObjectCode: [String] {
        var lines: [String] = []
        if let value = values["SourceConfig.metadata"], let draft = try? NativeMetadataDraft(json: value) { lines += draft.code + ["sourceConfig.metadata = sourceMetadata"] }
        if let json = values["SourceConfig.tracks"], let tracks = try? NativeSubtitleDraft.array(json) {
            for track in tracks { lines.append("sourceConfig.add(subtitleTrack: \(track.code))") }
        }
        if hasSubtitleFields {
            lines.append("let subtitleTrack = SubtitleTrack(url: \(optionalUrl("Track.url")), format: .\(values["SubtitleTrack.format"] ?? "webVtt"), label: \(quoted("Track.label", default: "External subtitles")), identifier: \(quoted("Track.identifier", default: "player-lab-external")), isDefaultTrack: \(values["Track.isDefaultTrack"] ?? "false"), language: \(optionalQuoted("SubtitleTrack.language")), forced: \(values["SubtitleTrack.isForced"] ?? "false"), associatedLanguage: \(optionalQuoted("SubtitleTrack.associatedLanguage")), characteristics: \(stringArrayCode("SubtitleTrack.characteristics")))")
            lines.append("sourceConfig.add(subtitleTrack: subtitleTrack)")
        }
        if let url = nonempty("SourceConfig.thumbnailTrack") {
            lines.append("sourceConfig.thumbnailTrack = ThumbnailTrack(url: URL(string: \(swiftString(url)))!, label: \(quoted("ThumbnailTrack.label", default: "Thumbnails")), identifier: \(quoted("ThumbnailTrack.identifier", default: "player-lab-thumbnails")), isDefaultTrack: \(values["ThumbnailTrack.isDefaultTrack"] ?? "false"))")
        } else if values["SourceConfig.thumbnailTrack"] != nil {
            lines.append("sourceConfig.thumbnailTrack = nil")
        }
        switch values["SourceConfig.drmConfig"] {
        case "none": lines.append("sourceConfig.drmConfig = nil")
        case "clearKey":
            lines += ["// Replace placeholders locally. Content keys are excluded from exported code.",
                "let clearKeys = [" + configuredClearKeys().map { "DecryptionKey(kid: \($0.kid.map(swiftString) ?? "nil"), key: \"<CONTENT_KEY>\")" }.joined(separator: ", ") + "]",
                "sourceConfig.drmConfig = ClearKeyConfig(decryptionKeys: clearKeys)"]
        case "fairplay":
            lines.append("let fairplay = FairplayConfig(license: \(optionalUrl("DrmConfig.licenseUrl")), certificateURL: URL(string: \(quoted("FairplayConfig.certificateUrl")))!)")
            for field in ["licenseRequestHeaders", "certificateRequestHeaders"] {
                if let headers = jsonValue("FairplayConfig." + field) as? [String: String] {
                    lines += ["// Header values are excluded from exported code.", "fairplay.\(field) = \(Self.headersCode(headers))"]
                }
            }
            lines.append("sourceConfig.drmConfig = fairplay")
        default: break
        }
        lines += receiverDrmCode
        if values["DrmConfig.licenseUrl"] != nil { lines.append("sourceConfig.drmConfig?.licenseUrl = \(optionalUrl("DrmConfig.licenseUrl"))") }
        if let uuid = values["DrmConfig.uuid"] { lines.append("sourceConfig.drmConfig?.uuid = UUID(uuidString: \(swiftString(uuid)))!") }
        if let attributes = values["SystemUserInterfaceConfig.subtitleStyles"] {
            if attributes == "null" { lines.append("systemUiConfig.subtitleStyles = nil") }
            else { lines += ["let systemAttributes = try! JSONSerialization.jsonObject(with: Data(\(swiftString(attributes)).utf8)) as! [[String: Any]]",
                "systemUiConfig.subtitleStyles = systemAttributes.compactMap { AVTextStyleRule(textMarkupAttributes: $0) }"] }
        }
        if let attributes = values["SubtitleUserInterfaceConfig.subtitleStyles"] {
            lines.append("let subtitleUi = SubtitleUserInterfaceConfig()")
            if attributes == "null" { lines.append("subtitleUi.subtitleStyles = nil") }
            else { lines += ["let subtitleAttributes = try! JSONSerialization.jsonObject(with: Data(\(swiftString(attributes)).utf8)) as! [[String: Any]]",
                "subtitleUi.subtitleStyles = subtitleAttributes.compactMap { AVTextStyleRule(textMarkupAttributes: $0) }"] }
            lines.append("playerConfig.styleConfig.userInterfaceConfig = subtitleUi")
        }
        return lines
    }

    private func quoted(_ id: String, default fallback: String = "") -> String { swiftString(values[id] ?? fallback) }
    private func optionalQuoted(_ id: String) -> String { nonempty(id).map(swiftString) ?? "nil" }
    private func optionalUrl(_ id: String) -> String { nonempty(id).map { "URL(string: \(swiftString($0)))" } ?? "nil" }
    private func stringArrayCode(_ id: String) -> String { "[" + ((jsonValue(id) as? [String]) ?? []).map(swiftString).joined(separator: ", ") + "]" }

    static func headersCode(_ headers: [String: String]) -> String {
        headers.isEmpty ? "[:]" : "[" + headers.keys.sorted().map { swiftString($0) + ": \"<HEADER_VALUE>\"" }.joined(separator: ", ") + "]"
    }

    private func spcCode(field: String, mode: String) -> [String] {
        switch mode {
        case "base64": return ["fairplay.\(field) = { data, _ in Data(data.base64EncodedString().utf8) }"]
        case "formSpc": return ["fairplay.\(field) = { data, assetId in", "    var form = URLComponents()", "    form.queryItems = [URLQueryItem(name: \"spc\", value: data.base64EncodedString()), URLQueryItem(name: \"assetId\", value: assetId)]", "    return Data((form.percentEncodedQuery ?? \"\").replacingOccurrences(of: \"+\", with: \"%2B\").utf8)", "}"]
        case "jsonSpc": return ["fairplay.\(field) = { data, assetId in", "    (try? JSONSerialization.data(withJSONObject: [\"spc\": data.base64EncodedString(), \"assetId\": assetId], options: [.sortedKeys])) ?? data", "}"]
        default: return ["fairplay.\(field) = { data, _ in data }"]
        }
    }

    private func drmResponseCode(field: String, mode: String) -> [String] {
        switch mode {
        case "base64": return ["fairplay.\(field) = { data in", "    guard let text = String(data: data, encoding: .utf8), let decoded = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return data }", "    return decoded", "}"]
        case "jsonCkc": return ["fairplay.\(field) = { data in", "    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let text = object[\"ckc\"] as? String, let decoded = Data(base64Encoded: text) else { return data }", "    return decoded", "}"]
        default: return ["fairplay.\(field) = { $0 }"]
        }
    }
}
