import Foundation
import BitmovinPlayer

enum ConfigurationOwner: String, CaseIterable {
    case player = "Player", source = "Source", view = "Player view"
}

enum ConfigurationInput {
    case boolean, number(minimum: Double), text, url, choice([String])

    var initial: String {
        switch self {
        case .boolean: return "false"
        case .number(let minimum): return String(minimum)
        case .text, .url: return ""
        case .choice(let choices): return choices[0]
        }
    }

    func validate(_ value: String, field: String) throws -> String {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        switch self {
        case .boolean:
            guard ["true", "false"].contains(value) else { throw invalid(field, "must be true or false") }
        case .number(let minimum):
            guard let number = Double(value), number.isFinite, number >= minimum else {
                throw invalid(field, "must be a finite number greater than or equal to \(minimum)")
            }
            return String(number)
        case .choice(let choices):
            guard choices.contains(value) else { throw invalid(field, "must be one of \(choices.joined(separator: ", "))") }
        case .url:
            guard value.isEmpty || URL(string: value).map({ url in
                ["https", "http", "file"].contains(url.scheme?.lowercased() ?? "") &&
                    (url.isFileURL || !(url.host ?? "").isEmpty)
            }) == true else { throw invalid(field, "must be an absolute HTTP, HTTPS or file URL") }
        case .text: break
        }
        return value
    }

    private func invalid(_ field: String, _ message: String) -> ConfigurationValidationError {
        ConfigurationValidationError(message: "\(field) \(message).")
    }

    func code(_ value: String) -> String {
        switch self {
        case .boolean, .number: return value
        case .choice: return "." + value
        case .text: return value.isEmpty ? "nil" : swiftString(value)
        case .url: return value.isEmpty ? "nil" : "URL(string: \(swiftString(value)))"
        }
    }
}

struct AdvancedConfigurationField: Identifiable {
    let id: String
    let owner: ConfigurationOwner
    let path: String
    let input: ConfigurationInput
    let note: String

    init(_ id: String, _ owner: ConfigurationOwner, _ path: String,
         _ input: ConfigurationInput, _ note: String = "") {
        self.id = id; self.owner = owner; self.path = path; self.input = input; self.note = note
    }
}

/// Only validated, explicitly enabled overrides are retained. SDK defaults are untouched otherwise.
struct AdvancedConfiguration: Equatable {
    private(set) var values: [String: String] = [:]
    static let empty = AdvancedConfiguration()

    private init() {}

    init(validating values: [String: String], owner: ConfigurationOwner? = nil) throws {
        let fields = Dictionary(uniqueKeysWithValues: Self.fields.map { ($0.id, $0) })
        for (id, value) in values {
            guard let field = fields[id] else {
                throw ConfigurationValidationError(message: "Unknown or unavailable configuration API: \(id)")
            }
            if owner == nil || field.owner == owner || (owner == .player && field.owner == .view) {
                self.values[id] = try Self.normalizeSourceObjectValue(field.input.validate(value, field: id), id: id)
                if ["StyleConfig.playerUiJs", "StyleConfig.playerUiCss"].contains(id) && self.values[id] == "" {
                    throw ConfigurationValidationError(message: "\(id) requires a resource URL when overridden.")
                }
            }
        }
        let engine = self.values["StyleConfig.userInterfaceType"] ?? {
            #if os(tvOS)
            return "system"
            #else
            return "bitmovin"
            #endif
        }()
        if self.values.keys.contains(where: { $0.hasPrefix("SystemUserInterfaceConfig.") }) && engine != "system" {
            throw ConfigurationValidationError(message: "Select System in StyleConfig.userInterfaceType before editing System UI fields.")
        }
        #if !os(tvOS)
        if self.values.keys.contains(where: { $0.hasPrefix("BitmovinUserInterface") }) && engine != "bitmovin" {
            throw ConfigurationValidationError(message: "Select Bitmovin in StyleConfig.userInterfaceType before editing Web UI fields.")
        }
        #endif
        try validateSourceObjects()
    }

    static var fields: [AdvancedConfigurationField] {
        var fields: [AdvancedConfigurationField] = [
            .init("SourceConfig.sourceDescription", .source, "sourceDescription", .text),
            .init("SourceConfig.isPosterPersistent", .source, "isPosterPersistent", .boolean),
            .init("SourceLiveConfig.targetLatency", .source, "liveConfig.targetLatency", .number(minimum: 0), "Seconds; requires a live stream."),
            .init("SourceLiveConfig.minTimeshiftBufferDepth", .source, "liveConfig.minTimeshiftBufferDepth", .number(minimum: 0), "Seconds; minimum live window for time shift."),
            .init("SourceLiveConfig.automaticallyPreservesLatency", .source, "liveConfig.automaticallyPreservesLatency", .boolean),
            .init("SourceOptions.sharePlayIdentifier", .source, "options.sharePlayIdentifier", .text, "Identifiers must match participating SharePlay sources."),
            .init("PlaybackConfig.isBackgroundPlaybackEnabled", .player, "playbackConfig.isBackgroundPlaybackEnabled", .boolean, "Background audio requires the host audio capability. tvOS supports audio-only background content."),
            .init("NowPlayingConfig.isNowPlayingInfoEnabled", .player, "nowPlayingConfig.isNowPlayingInfoEnabled", .boolean),
            .init("StyleConfig.isUiEnabled", .player, "styleConfig.isUiEnabled", .boolean),
            .init("TweaksConfig.isCustomHlsLoadingEnabled", .player, "tweaksConfig.isCustomHlsLoadingEnabled", .boolean),
            .init("TweaksConfig.isNativeHlsParsingEnabled", .player, "tweaksConfig.isNativeHlsParsingEnabled", .boolean, "Additional HLS parsing requires custom HLS loading."),
            .init("TweaksConfig.parseAdditionalMediaAttributes", .player, "tweaksConfig.parseAdditionalMediaAttributes", .boolean),
            .init("TweaksConfig.enforcedMinimumBufferLevelForPlayback", .player, "tweaksConfig.enforcedMinimumBufferLevelForPlayback", .number(minimum: 0), "Seconds."),
            .init("TweaksConfig.seekToEndThreshold", .player, "tweaksConfig.seekToEndThreshold", .number(minimum: 0), "Seconds."),
            .init("TweaksConfig.timeChangedInterval", .player, "tweaksConfig.timeChangedInterval", .number(minimum: 0.01), "Seconds between TimeChanged events; this editor uses a 0.01-second minimum."),
            .init("TweaksConfig.playbackStartBehaviour", .player, "tweaksConfig.playbackStartBehaviour", .choice(["relaxed", "aggressive"])),
            .init("TweaksConfig.unstallingBehaviour", .player, "tweaksConfig.unstallingBehaviour", .choice(["relaxed", "aggressive"])),
            .init("TweaksConfig.sourceFailureAction", .player, "tweaksConfig.sourceFailureAction", .choice(["none", "drop"])),
            .init("TweaksConfig.dateBasedTimeShiftingForLiveStreams", .player, "tweaksConfig.dateBasedTimeShiftingForLiveStreams", .boolean, "Deprecated; prefer current source live configuration."),
            .init("TweaksConfig.delayInitialSubtitleSelection", .player, "tweaksConfig.delayInitialSubtitleSelection", .boolean, "Deprecated; the SDK documents this as having no effect."),
            .init("ThumbnailConfig.renderingMode", .player, "thumbnailConfig.renderingMode", .choice(["automatic", "trickPlay"])),
            .init("PlayerViewConfig.hideFirstFrame", .view, "hideFirstFrame", .boolean),
            .init("PictureInPictureConfig.isEnabled", .view, "pictureInPictureConfig.isEnabled", .boolean),
            .init("SystemUserInterfaceConfig.hideFirstFrame", .player, "styleConfig.userInterfaceConfig.hideFirstFrame", .boolean),
        ]
        #if os(tvOS)
        fields += [
            .init("StyleConfig.userInterfaceType", .player, "styleConfig.userInterfaceType", .choice(["system", "subtitle"])),
            .init("SystemUserInterfaceConfig.showAutoSubtitleOption", .player, "styleConfig.userInterfaceConfig.showAutoSubtitleOption", .boolean),
            .init("SystemUserInterfaceConfig.showInfoViews", .player, "styleConfig.userInterfaceConfig.showInfoViews", .boolean),
            .init("SystemUserInterfaceConfig.showSeekBar", .player, "styleConfig.userInterfaceConfig.showSeekBar", .boolean),
            .init("SystemUserInterfaceConfig.showTitleInSeekBar", .player, "styleConfig.userInterfaceConfig.showTitleInSeekBar", .boolean),
        ]
        #else
        fields += [
            .init("RemoteControlConfig.allowsAirPlay", .player, "remoteControlConfig.allowsAirPlay", .boolean),
            .init("RemoteControlConfig.isAirPlayEnabled", .player, "remoteControlConfig.isAirPlayEnabled", .boolean),
            .init("RemoteControlConfig.isCastEnabled", .player, "remoteControlConfig.isCastEnabled", .boolean, "Requires an initialized Cast manager and receiver."),
            .init("RemoteControlConfig.sendDrmLicenseRequestsWithCredentials", .player, "remoteControlConfig.sendDrmLicenseRequestsWithCredentials", .boolean),
            .init("RemoteControlConfig.sendManifestRequestsWithCredentials", .player, "remoteControlConfig.sendManifestRequestsWithCredentials", .boolean),
            .init("RemoteControlConfig.sendSegmentRequestsWithCredentials", .player, "remoteControlConfig.sendSegmentRequestsWithCredentials", .boolean),
            .init("RemoteControlConfig.usesExternalPlaybackWhileExternalScreenIsActive", .player, "remoteControlConfig.usesExternalPlaybackWhileExternalScreenIsActive", .boolean),
            .init("RemoteControlConfig.receiverStylesheetUrl", .player, "remoteControlConfig.receiverStylesheetUrl", .url),
            .init("TweaksConfig.discardAdsWhileCasting", .player, "tweaksConfig.discardAdsWhileCasting", .boolean),
            .init("TweaksConfig.restoreAirPlayPlaybackPosition", .player, "tweaksConfig.restoreAirPlayPlaybackPosition", .boolean),
            .init("StyleConfig.userInterfaceType", .player, "styleConfig.userInterfaceType", .choice(["bitmovin", "system", "subtitle"])),
            .init("StyleConfig.playerUiJs", .player, "styleConfig.playerUiJs", .url),
            .init("StyleConfig.playerUiCss", .player, "styleConfig.playerUiCss", .url),
            .init("StyleConfig.supplementalPlayerUiCss", .player, "styleConfig.supplementalPlayerUiCss", .url),
            .init("BitmovinUserInterfaceConfig.uiManagerFactoryFunction", .player, "styleConfig.userInterfaceConfig.uiManagerFactoryFunction", .text),
            .init("BitmovinUserInterfaceConfig.enableSeekPreview", .player, "styleConfig.userInterfaceConfig.enableSeekPreview", .boolean),
            .init("BitmovinUserInterfaceConfig.enableWebViewInspecting", .player, "styleConfig.userInterfaceConfig.enableWebViewInspecting", .boolean),
            .init("BitmovinUserInterfaceConfig.forceSubtitlesIntoViewContainer", .player, "styleConfig.userInterfaceConfig.forceSubtitlesIntoViewContainer", .boolean),
            .init("BitmovinUserInterfaceConfig.hideFirstFrame", .player, "styleConfig.userInterfaceConfig.hideFirstFrame", .boolean),
            .init("BitmovinUserInterfaceConfig.playbackSpeedSelectionEnabled", .player, "styleConfig.userInterfaceConfig.playbackSpeedSelectionEnabled", .boolean),
            .init("BitmovinUserInterfaceMetadata.title", .player, "styleConfig.userInterfaceConfig.metadata.title", .text),
            .init("BitmovinUserInterfaceMetadata.sourceDescription", .player, "styleConfig.userInterfaceConfig.metadata.sourceDescription", .text),
            .init("PictureInPictureConfig.shouldEnterOnBackground", .view, "pictureInPictureConfig.shouldEnterOnBackground", .boolean),
            .init("PictureInPictureConfig.showSkipControls", .view, "pictureInPictureConfig.showSkipControls", .boolean),
            .init("PlayerViewTweaksConfig.hidePlaybackControlsInPictureInPicture", .view, "tweaksConfig.hidePlaybackControlsInPictureInPicture", .boolean),
        ]
        #endif
        if #available(iOS 18, tvOS 18, *) {
            fields.append(.init("CmcdConfig.isEnabled", .source, "cmcdConfig.isEnabled", .boolean, "Common Media Client Data adds client playback information to supported HTTP requests."))
        }
        if #available(iOS 27, tvOS 27, *) {
            fields.append(.init("TweaksConfig.includeMachineGeneratedSubtitles", .player, "tweaksConfig.includeMachineGeneratedSubtitles", .boolean))
        }
        return fields + Self.sourceObjectFields
    }

    func apply(to config: SourceConfig) {
        for (id, value) in values {
            switch id {
            case "SourceConfig.sourceDescription": config.sourceDescription = value.isEmpty ? nil : value
            case "SourceConfig.isPosterPersistent": config.isPosterPersistent = value == "true"
            case "SourceLiveConfig.targetLatency": config.liveConfig.targetLatency = Double(value)!
            case "SourceLiveConfig.minTimeshiftBufferDepth": config.liveConfig.minTimeshiftBufferDepth = Double(value)!
            case "SourceLiveConfig.automaticallyPreservesLatency": config.liveConfig.automaticallyPreservesLatency = value == "true"
            case "SourceOptions.sharePlayIdentifier": config.options.sharePlayIdentifier = value.isEmpty ? nil : value
            case "CmcdConfig.isEnabled": if #available(iOS 18, tvOS 18, *) { config.cmcdConfig.isEnabled = value == "true" }
            default: break
            }
        }
        applySourceObjects(to: config)
    }

    func apply(to config: PlayerConfig) {
        for (id, value) in values {
            switch id {
            case "PlaybackConfig.isBackgroundPlaybackEnabled": config.playbackConfig.isBackgroundPlaybackEnabled = value == "true"
            case "NowPlayingConfig.isNowPlayingInfoEnabled": config.nowPlayingConfig.isNowPlayingInfoEnabled = value == "true"
            #if !os(tvOS)
            case "RemoteControlConfig.allowsAirPlay": config.remoteControlConfig.allowsAirPlay = value == "true"
            case "RemoteControlConfig.isAirPlayEnabled": config.remoteControlConfig.isAirPlayEnabled = value == "true"
            case "RemoteControlConfig.isCastEnabled": config.remoteControlConfig.isCastEnabled = value == "true"
            case "RemoteControlConfig.sendDrmLicenseRequestsWithCredentials": config.remoteControlConfig.sendDrmLicenseRequestsWithCredentials = value == "true"
            case "RemoteControlConfig.sendManifestRequestsWithCredentials": config.remoteControlConfig.sendManifestRequestsWithCredentials = value == "true"
            case "RemoteControlConfig.sendSegmentRequestsWithCredentials": config.remoteControlConfig.sendSegmentRequestsWithCredentials = value == "true"
            case "RemoteControlConfig.usesExternalPlaybackWhileExternalScreenIsActive": config.remoteControlConfig.usesExternalPlaybackWhileExternalScreenIsActive = value == "true"
            case "RemoteControlConfig.receiverStylesheetUrl": config.remoteControlConfig.receiverStylesheetUrl = value.isEmpty ? nil : URL(string: value)
            #endif
            case "StyleConfig.isUiEnabled": config.styleConfig.isUiEnabled = value == "true"
            case "TweaksConfig.isCustomHlsLoadingEnabled": config.tweaksConfig.isCustomHlsLoadingEnabled = value == "true"
            case "TweaksConfig.isNativeHlsParsingEnabled": config.tweaksConfig.isNativeHlsParsingEnabled = value == "true"
            case "TweaksConfig.parseAdditionalMediaAttributes": config.tweaksConfig.parseAdditionalMediaAttributes = value == "true"
            case "TweaksConfig.enforcedMinimumBufferLevelForPlayback": config.tweaksConfig.enforcedMinimumBufferLevelForPlayback = Double(value)!
            case "TweaksConfig.seekToEndThreshold": config.tweaksConfig.seekToEndThreshold = Double(value)!
            case "TweaksConfig.timeChangedInterval": config.tweaksConfig.timeChangedInterval = Double(value)!
            case "TweaksConfig.playbackStartBehaviour": config.tweaksConfig.playbackStartBehaviour = value == "relaxed" ? .relaxed : .aggressive
            case "TweaksConfig.unstallingBehaviour": config.tweaksConfig.unstallingBehaviour = value == "relaxed" ? .relaxed : .aggressive
            case "TweaksConfig.sourceFailureAction": config.tweaksConfig.sourceFailureAction = value == "none" ? .none : .drop
            #if !os(tvOS)
            case "TweaksConfig.discardAdsWhileCasting": config.tweaksConfig.discardAdsWhileCasting = value == "true"
            case "TweaksConfig.restoreAirPlayPlaybackPosition": config.tweaksConfig.restoreAirPlayPlaybackPosition = value == "true"
            #endif
            case "TweaksConfig.dateBasedTimeShiftingForLiveStreams": config.tweaksConfig.dateBasedTimeShiftingForLiveStreams = value == "true"
            case "TweaksConfig.delayInitialSubtitleSelection": config.tweaksConfig.delayInitialSubtitleSelection = value == "true"
            case "TweaksConfig.includeMachineGeneratedSubtitles": if #available(iOS 27, tvOS 27, *) { config.tweaksConfig.includeMachineGeneratedSubtitles = value == "true" }
            case "ThumbnailConfig.renderingMode": config.thumbnailConfig.renderingMode = value == "automatic" ? .automatic : .trickPlay
            case "StyleConfig.userInterfaceType":
                #if os(tvOS)
                config.styleConfig.userInterfaceType = value == "system" ? .system : .subtitle
                #else
                config.styleConfig.userInterfaceType = value == "bitmovin" ? .bitmovin : value == "system" ? .system : .subtitle
                #endif
            default: break
            }
        }
    }

    /// Apply after the selected bundled UI factory, so explicit user overrides take precedence.
    func applyUI(to config: PlayerConfig) {
        if values.keys.contains(where: { $0.hasPrefix("SystemUserInterfaceConfig.") }) {
            let ui = SystemUserInterfaceConfig()
            if let value = values["SystemUserInterfaceConfig.hideFirstFrame"] { ui.hideFirstFrame = value == "true" }
            #if os(tvOS)
            if let value = values["SystemUserInterfaceConfig.showAutoSubtitleOption"] { ui.showAutoSubtitleOption = value == "true" }
            if let value = values["SystemUserInterfaceConfig.showInfoViews"] { ui.showInfoViews = value == "true" }
            if let value = values["SystemUserInterfaceConfig.showSeekBar"] { ui.showSeekBar = value == "true" }
            if let value = values["SystemUserInterfaceConfig.showTitleInSeekBar"] { ui.showTitleInSeekBar = value == "true" }
            #endif
            config.styleConfig.userInterfaceConfig = ui
        }
        #if !os(tvOS)
        if values.keys.contains(where: { $0.hasPrefix("BitmovinUserInterface") }) {
            let ui = config.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig ?? BitmovinUserInterfaceConfig()
            if let value = values["BitmovinUserInterfaceConfig.uiManagerFactoryFunction"] { ui.uiManagerFactoryFunction = value }
            if let value = values["BitmovinUserInterfaceConfig.enableSeekPreview"] { ui.enableSeekPreview = value == "true" }
            if let value = values["BitmovinUserInterfaceConfig.enableWebViewInspecting"] { ui.enableWebViewInspecting = value == "true" }
            if let value = values["BitmovinUserInterfaceConfig.forceSubtitlesIntoViewContainer"] { ui.forceSubtitlesIntoViewContainer = value == "true" }
            if let value = values["BitmovinUserInterfaceConfig.hideFirstFrame"] { ui.hideFirstFrame = value == "true" }
            if let value = values["BitmovinUserInterfaceConfig.playbackSpeedSelectionEnabled"] { ui.playbackSpeedSelectionEnabled = value == "true" }
            if let value = values["BitmovinUserInterfaceMetadata.title"] { ui.metadata.title = value.isEmpty ? nil : value }
            if let value = values["BitmovinUserInterfaceMetadata.sourceDescription"] { ui.metadata.sourceDescription = value.isEmpty ? nil : value }
            config.styleConfig.userInterfaceConfig = ui
        }
        if let value = values["StyleConfig.playerUiJs"], !value.isEmpty { config.styleConfig.playerUiJs = URL(string: value)! }
        if let value = values["StyleConfig.playerUiCss"], !value.isEmpty { config.styleConfig.playerUiCss = URL(string: value)! }
        if let value = values["StyleConfig.supplementalPlayerUiCss"] { config.styleConfig.supplementalPlayerUiCss = value.isEmpty ? nil : URL(string: value) }
        #endif
        applySourceObjectUI(to: config)
    }

    func apply(to config: PlayerViewConfig) {
        if let value = values["PlayerViewConfig.hideFirstFrame"] { config.hideFirstFrame = value == "true" }
        if let value = values["PictureInPictureConfig.isEnabled"] { config.pictureInPictureConfig.isEnabled = value == "true" }
        #if !os(tvOS)
        if let value = values["PictureInPictureConfig.shouldEnterOnBackground"] { config.pictureInPictureConfig.shouldEnterOnBackground = value == "true" }
        if let value = values["PictureInPictureConfig.showSkipControls"] { config.pictureInPictureConfig.showSkipControls = value == "true" }
        if let value = values["PlayerViewTweaksConfig.hidePlaybackControlsInPictureInPicture"] { config.tweaksConfig.hidePlaybackControlsInPictureInPicture = value == "true" }
        #endif
    }

    var code: [String] {
        var lines: [String] = []
        if values.keys.contains(where: { $0.hasPrefix("SystemUserInterfaceConfig.") }) {
            lines += ["let systemUiConfig = SystemUserInterfaceConfig()"]
        }
        #if !os(tvOS)
        if values.keys.contains(where: { $0.hasPrefix("BitmovinUserInterface") }) {
            lines += ["let webUiConfig = playerConfig.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig ?? BitmovinUserInterfaceConfig()"]
        }
        #endif
        for field in Self.fields {
            guard let value = values[field.id] else { continue }
            if Self.sourceObjectFields.contains(where: { $0.id == field.id }) { continue }
            let root = field.owner == .source ? "sourceConfig" : field.owner == .view ? "playerViewConfig" : "playerConfig"
            var path = root + "." + field.path
            if field.id.hasPrefix("SystemUserInterfaceConfig.") { path = "systemUiConfig." + field.id.components(separatedBy: ".").last! }
            if field.id.hasPrefix("BitmovinUserInterfaceConfig.") { path = "webUiConfig." + field.id.components(separatedBy: ".").last! }
            if field.id.hasPrefix("BitmovinUserInterfaceMetadata.") { path = "webUiConfig.metadata." + field.id.components(separatedBy: ".").last! }
            var assignment = path + " = " + field.input.code(value)
            if field.id == "BitmovinUserInterfaceConfig.uiManagerFactoryFunction" { assignment = path + " = " + swiftString(value) }
            if ["StyleConfig.playerUiJs", "StyleConfig.playerUiCss"].contains(field.id) { assignment += "!" }
            if field.id == "CmcdConfig.isEnabled" { assignment = "if #available(iOS 18, tvOS 18, *) { \(assignment) }" }
            if field.id == "TweaksConfig.includeMachineGeneratedSubtitles" { assignment = "if #available(iOS 27, tvOS 27, *) { \(assignment) }" }
            lines.append(assignment)
        }
        lines += sourceObjectCode
        if values.keys.contains(where: { $0.hasPrefix("SystemUserInterfaceConfig.") }) { lines.append("playerConfig.styleConfig.userInterfaceConfig = systemUiConfig") }
        #if !os(tvOS)
        if values.keys.contains(where: { $0.hasPrefix("BitmovinUserInterface") }) { lines.append("playerConfig.styleConfig.userInterfaceConfig = webUiConfig") }
        #endif
        return lines
    }
}
