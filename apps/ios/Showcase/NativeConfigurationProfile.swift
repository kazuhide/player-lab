import Foundation

enum NativeProfileError: String, LocalizedError {
    case invalid = "Saved profiles contain unsupported data. Clear saved profiles to start again."
    case name = "Use a profile name of 1–48 characters: letters, numbers, spaces, or . - _ ( )."
    case limit = "Profiles are limited to 20 entries, 8 KiB per entry and 128 KiB in total."
    case duplicate = "A profile with this name already exists. Confirm replacement."
    case draft = "Some profile fields are invalid in the draft. Correct them before saving."
    case sdk = "This profile was saved with a different SDK. Confirm restoration after revalidation."
    case read = "Saved profiles could not be read. Existing saved data was retained."
    case write = "Profiles could not be saved. Existing saved data was retained."
    var errorDescription: String? { rawValue.nativeLocalized }
}

enum NativeProfileValue: Codable, Equatable {
    case null, boolean(Bool), number(Double), text(String)

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .boolean(item) }
        else if let item = try? value.decode(Double.self), item.isFinite { self = .number(item) }
        else if let item = try? value.decode(String.self) { self = .text(item) }
        else { throw NativeProfileError.invalid }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .boolean(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .text(let item): try value.encode(item)
        }
    }

    var draftText: String {
        switch self {
        case .null: return ""
        case .boolean(let value): return String(value)
        case .number(let value): return String(value)
        case .text(let value): return value
        }
    }
}

enum NativeProfileRule {
    case boolean, number(minimum: Double, maximum: Double = .greatestFiniteMagnitude, whole: Bool = false)
    case optionalNumber, choice([String]), language, preset

    func accepts(_ value: NativeProfileValue) -> Bool {
        switch (self, value) {
        case (.boolean, .boolean): return true
        case (.number(let minimum, let maximum, let whole), .number(let item)):
            return item.isFinite && item >= minimum && item <= maximum && (!whole || item.rounded() == item)
        case (.optionalNumber, .null): return true
        case (.optionalNumber, .number(let item)): return item.isFinite
        case (.choice(let choices), .text(let item)): return choices.contains(item)
        case (.language, .text(let item)):
            return item.isEmpty || (item.utf8.count <= 35 && item.range(of: "^[a-z]{2,3}(-[a-z0-9]{2,8})*$", options: .regularExpression) != nil)
        case (.preset, .null): return true
        case (.preset, .text(let item)): return NativeProfileSchema.presetURLs[item] != nil
        default: return false
        }
    }
}

enum NativeProfileSchema {
    static let platform: String = {
        #if os(tvOS)
        return "tvos"
        #else
        return "ios"
        #endif
    }()
    // IDs are persisted; an arbitrary current source URL is never persisted.
    static let presetURLs = [
        "live-hls": "https://demo.unified-streaming.com/k8s/vod2live/stable/unified-learning.isml/.m3u8",
        "vod-hls": "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8"
    ]
    static let basic: [String: NativeProfileRule] = [
        "source.preset": .preset, "source.startOffset": .optionalNumber,
        "source.timelineReference": .choice(["automatic", "start", "end"]),
        "source.audioLanguage": .language, "source.subtitleMode": .choice(["automatic", "off", "language"]),
        "source.subtitleLanguage": .language,
        "player.autoplay": .boolean, "player.startMuted": .boolean, "player.sdkTimeShiftEnabled": .boolean,
        "player.maximumBitrate": .number(minimum: 0, maximum: 9_007_199_254_740_991, whole: true),
        "player.forwardBuffer": .number(minimum: 0), "player.videoScaling": .choice(["fit", "fill", "stretch"])
    ]
    // This is an explicit subset, rather than a blacklist or automatic field discovery.
    static let overrides: [String: NativeProfileRule] = [
        "SourceConfig.isPosterPersistent": .boolean,
        "SourceLiveConfig.targetLatency": .number(minimum: 0),
        "SourceLiveConfig.minTimeshiftBufferDepth": .number(minimum: -.greatestFiniteMagnitude, maximum: 0),
        "SourceLiveConfig.automaticallyPreservesLatency": .boolean,
        "PlaybackConfig.isBackgroundPlaybackEnabled": .boolean,
        "NowPlayingConfig.isNowPlayingInfoEnabled": .boolean, "StyleConfig.isUiEnabled": .boolean,
        "TweaksConfig.isCustomHlsLoadingEnabled": .boolean, "TweaksConfig.isNativeHlsParsingEnabled": .boolean,
        "TweaksConfig.parseAdditionalMediaAttributes": .boolean,
        "TweaksConfig.enforcedMinimumBufferLevelForPlayback": .number(minimum: 0),
        "TweaksConfig.seekToEndThreshold": .number(minimum: 0),
        "TweaksConfig.timeChangedInterval": .number(minimum: 0.01),
        "TweaksConfig.playbackStartBehaviour": .choice(["relaxed", "aggressive"]),
        "TweaksConfig.unstallingBehaviour": .choice(["relaxed", "aggressive"]),
        "TweaksConfig.sourceFailureAction": .choice(["none", "drop"]),
        "ThumbnailConfig.renderingMode": .choice(["automatic", "trickPlay"]),
        "PlayerViewConfig.hideFirstFrame": .boolean, "PictureInPictureConfig.isEnabled": .boolean
    ]

    static func normalizedName(_ input: String) throws -> String {
        let name = input.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
        let allowed = CharacterSet.letters.union(.decimalDigits).union(.nonBaseCharacters).union(CharacterSet(charactersIn: " .-_()"))
        guard (1...48).contains(name.unicodeScalars.count), name.unicodeScalars.allSatisfy({ allowed.contains($0) }),
              !name.lowercased().hasPrefix("bearer "), UUID(uuidString: name) == nil else { throw NativeProfileError.name }
        if name.range(of: "^[a-zA-Z0-9_-]{24,}$", options: .regularExpression) != nil,
           name.rangeOfCharacter(from: .decimalDigits) != nil { throw NativeProfileError.name }
        return name
    }

    static func nameKey(_ name: String) -> String {
        name.folding(options: .caseInsensitive, locale: Locale(identifier: "en_US_POSIX"))
    }

    static func validate(_ values: [String: NativeProfileValue]) throws {
        guard Set(basic.keys).isSubset(of: Set(values.keys)) else { throw NativeProfileError.invalid }
        for (id, value) in values {
            guard let rule = basic[id] ?? (id.hasPrefix("sdk.") ? overrides[String(id.dropFirst(4))] : nil), rule.accepts(value) else { throw NativeProfileError.invalid }
        }
        if values["source.subtitleMode"] == .text("language"), values["source.subtitleLanguage"] == .text("") { throw NativeProfileError.invalid }
    }
}

struct NativeConfigurationProfile: Codable, Equatable, Identifiable {
    let id: UUID
    let name: String
    let sdkVersion: String
    let values: [String: NativeProfileValue]
}

enum NativeProfileCodec {
    static let collectionLimit = 128 * 1024
    private struct Collection: Codable {
        let schemaVersion: Int
        let platform: String
        let profiles: [NativeConfigurationProfile]
    }

    static func encode(_ profiles: [NativeConfigurationProfile]) throws -> Data {
        guard profiles.count <= 20 else { throw NativeProfileError.limit }
        var names = Set<String>(); var ids = Set<UUID>()
        for profile in profiles {
            guard try NativeProfileSchema.normalizedName(profile.name) == profile.name,
                  profile.sdkVersion.range(of: "^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}([-+][a-zA-Z0-9.-]{1,24})?$", options: .regularExpression) != nil else { throw NativeProfileError.invalid }
            guard names.insert(NativeProfileSchema.nameKey(profile.name)).inserted,
                  ids.insert(profile.id).inserted else { throw NativeProfileError.duplicate }
            try NativeProfileSchema.validate(profile.values)
            guard try JSONEncoder().encode(profile).count <= 8 * 1024 else { throw NativeProfileError.limit }
        }
        let data = try JSONEncoder().encode(Collection(schemaVersion: 1, platform: NativeProfileSchema.platform, profiles: profiles))
        guard data.count <= collectionLimit else { throw NativeProfileError.limit }
        return data
    }

    static func decode(_ data: Data) throws -> [NativeConfigurationProfile] {
        guard data.count <= collectionLimit else { throw NativeProfileError.limit }
        do {
            // Codable ignores unknown members by default; reject them before decoding.
            guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(root.keys) == ["schemaVersion", "platform", "profiles"],
                  let rows = root["profiles"] as? [[String: Any]], rows.count <= 20,
                  rows.allSatisfy({ Set($0.keys) == ["id", "name", "sdkVersion", "values"] }) else { throw NativeProfileError.invalid }
            let collection = try JSONDecoder().decode(Collection.self, from: data)
            guard collection.schemaVersion == 1, collection.platform == NativeProfileSchema.platform else { throw NativeProfileError.invalid }
            _ = try encode(collection.profiles)
            return collection.profiles
        } catch let error as NativeProfileError { throw error }
        catch { throw NativeProfileError.invalid }
    }
}
