import Foundation

extension NativeConfigurationProfile {
    static func capture(name: String, draft: ConfigurationDraft, sdkVersion: String, id: UUID = UUID()) throws -> Self {
        func number(_ input: String, optional: Bool = false) throws -> NativeProfileValue {
            let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
            if optional && text.isEmpty { return .null }
            guard let value = Double(text), value.isFinite else { throw NativeProfileError.invalid }
            return .number(value)
        }
        guard let bitrate = UInt(draft.maximumBitrate.trimmingCharacters(in: .whitespacesAndNewlines)), bitrate <= 9_007_199_254_740_991 else { throw NativeProfileError.invalid }
        let preset = draft.sourceType == .hls ? NativeProfileSchema.presetURLs.first(where: { $0.value == draft.sourceURL })?.key : nil
        var values: [String: NativeProfileValue] = [
            "source.preset": preset.map(NativeProfileValue.text) ?? .null,
            "source.startOffset": try number(draft.startOffset, optional: true),
            "source.timelineReference": .text(draft.timelineReference.rawValue.lowercased()),
            "source.audioLanguage": .text(draft.audioLanguage.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()),
            "source.subtitleMode": .text(draft.subtitleMode == .language ? "language" : draft.subtitleMode == .off ? "off" : "automatic"),
            "source.subtitleLanguage": .text(draft.subtitleLanguage.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()),
            "player.autoplay": .boolean(draft.autoplay), "player.startMuted": .boolean(draft.startMuted),
            "player.sdkTimeShiftEnabled": .boolean(draft.sdkTimeShiftEnabled),
            "player.maximumBitrate": .number(Double(bitrate)), "player.forwardBuffer": try number(draft.forwardBuffer),
            "player.videoScaling": .text(draft.videoScaling == .fit ? "fit" : draft.videoScaling == .fill ? "fill" : "stretch")
        ]
        let fields = Dictionary(uniqueKeysWithValues: AdvancedConfiguration.fields.map { ($0.id, $0) })
        for id in NativeProfileSchema.overrides.keys {
            guard let raw = draft.advancedValues[id] else { continue }
            guard let field = fields[id] else { throw NativeProfileError.invalid }
            let text = try field.input.validate(raw, field: id)
            switch field.input {
            case .boolean: values["sdk." + id] = .boolean(text == "true")
            case .number, .nonPositiveNumber: values["sdk." + id] = try number(text)
            case .choice: values["sdk." + id] = .text(text)
            default: throw NativeProfileError.invalid
            }
        }
        let profile = Self(id: id, name: try NativeProfileSchema.normalizedName(name), sdkVersion: sdkVersion, values: values)
        try profile.validateCurrentFields()
        return profile
    }

    func validateCurrentFields() throws {
        _ = try NativeProfileCodec.encode([self])
        let fields = Dictionary(uniqueKeysWithValues: AdvancedConfiguration.fields.map { ($0.id, $0) })
        for (id, value) in values where id.hasPrefix("sdk.") {
            guard let field = fields[String(id.dropFirst(4))] else { throw NativeProfileError.invalid }
            switch (field.input, value) {
            case (.boolean, .boolean), (.number, .number), (.nonPositiveNumber, .number), (.choice, .text):
                _ = try field.input.validate(value.draftText, field: id)
            default: throw NativeProfileError.invalid
            }
        }
    }

    func restored(into current: ConfigurationDraft, sdkVersion: String, confirmDifferentSDK: Bool) throws -> ConfigurationDraft {
        try validateCurrentFields()
        guard self.sdkVersion == sdkVersion || confirmDifferentSDK else { throw NativeProfileError.sdk }
        var draft = current
        if case .text(let preset) = values["source.preset"], let url = NativeProfileSchema.presetURLs[preset] {
            draft.sourceURL = url; draft.sourceType = .hls
        }
        func text(_ id: String) -> String {
            let value = values[id]!.draftText
            return value.hasSuffix(".0") ? String(value.dropLast(2)) : value
        }
        draft.startOffset = text("source.startOffset")
        if case .text(let value) = values["source.timelineReference"] {
            draft.timelineReference = value == "start" ? .start : value == "end" ? .end : .automatic
        }
        draft.audioLanguage = text("source.audioLanguage")
        draft.subtitleLanguage = text("source.subtitleLanguage")
        if case .text(let value) = values["source.subtitleMode"] {
            draft.subtitleMode = value == "language" ? .language : value == "off" ? .off : .automatic
        }
        if case .boolean(let value) = values["player.autoplay"] { draft.autoplay = value }
        if case .boolean(let value) = values["player.startMuted"] { draft.startMuted = value }
        if case .boolean(let value) = values["player.sdkTimeShiftEnabled"] { draft.sdkTimeShiftEnabled = value }
        if case .number(let value) = values["player.maximumBitrate"] { draft.maximumBitrate = String(UInt(value)) }
        draft.forwardBuffer = text("player.forwardBuffer")
        if case .text(let value) = values["player.videoScaling"] {
            draft.videoScaling = value == "fit" ? .fit : value == "fill" ? .fill : .stretch
        }
        for id in NativeProfileSchema.overrides.keys { draft.advancedValues[id] = values["sdk." + id]?.draftText }
        return draft
    }
}
