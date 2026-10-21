import Foundation
import BitmovinPlayer

extension AdvancedConfiguration {
    static var nativeCallbackFields: [AdvancedConfigurationField] {
        let dataNote = "input.base64 and input.bytes contain the bytes; input.utf8 is text or null. Return base64, a byte array, or {utf8: text}. Errors preserve the original bytes and appear in the API state inspector."
        var fields: [AdvancedConfigurationField] = [
            .init("FairplayConfig.prepareContentId", .source, "drmConfig.prepareContentId", .script(initial: "return input.contentId;"), "input.contentId is a string; return the content identifier string. Errors preserve the original identifier."),
            .init("FairplayConfig.prepareMessage", .source, "drmConfig.prepareMessage", .script(initial: "return input.base64;"), dataNote + " input.assetId identifies this request."),
            .init("FairplayConfig.prepareSyncMessage", .source, "drmConfig.prepareSyncMessage", .script(initial: "return input.base64;"), dataNote + " input.assetId identifies this request."),
            .init("FairplayConfig.prepareCertificate", .source, "drmConfig.prepareCertificate", .script(initial: "return input.base64;"), dataNote),
            .init("FairplayConfig.prepareLicense", .source, "drmConfig.prepareLicense", .script(initial: "return input.base64;"), dataNote),
            .init("FairplayConfig.prepareLicenseServerUrl", .source, "drmConfig.prepareLicenseServerUrl", .script(initial: "return input.url;"), "input.url is the proposed license URL; return a replacement string. Errors preserve the original URL."),
            .init("FairplayConfig.prepareOfflineDrmLicenseInformation", .source, "drmConfig.prepareOfflineDrmLicenseInformation", .script(initial: "return {licenseDuration: 0, playbackDuration: 0};"), dataNote + " Return {licenseDuration: seconds, playbackDuration: seconds}; errors return zero durations."),
            .init("LabelingConfig.audioLabel", .source, "labelingConfig.audioLabel", .script(initial: "return input.label;"), "input contains id, label, language, associatedLanguage and characteristics. Return a label string; errors preserve the SDK label."),
            .init("LabelingConfig.subtitleLabel", .source, "labelingConfig.subtitleLabel", .script(initial: "return input.label;"), "input also contains isForced and format. Return a label string; errors preserve the SDK label."),
            .init("PlaybackConfig.isForcedSubtitleCallback", .player, "playbackConfig.isForcedSubtitleCallback", .script(initial: "return input.isForced;"), "input contains the subtitle track fields. Return true or false; errors return the track's isForced value."),
        ]
        #if !os(tvOS)
        fields += [
            .init("FairplayConfig.persistLicenseData", .source, "drmConfig.persistLicenseData", .script(initial: "storage[input.assetId] = input.base64;"), dataNote + " input.assetId is the asset identifier. Its return value is ignored. storage is shared by this source's callbacks in memory."),
            .init("FairplayConfig.provideLicenseData", .source, "drmConfig.provideLicenseData", .script(initial: "return storage[input.assetId] ?? null;"), "input.assetId identifies the asset. Return base64, bytes, {utf8: text}, or null. Errors return nil. storage is in memory, so it does not survive restarting the app."),
        ]
        #endif
        return fields + nativeNetworkFields + nativeAdvertisingCallbacks + nativeUiCallbackFields + nativeInterstitialFields + nativeLoggingCallbacks + nativeRemoteCallbacks
    }

    static func nativeCallbackSource(_ source: String, id: String) -> String {
        // Preserve the earlier example selectors while storing editable function bodies.
        switch (id, source) {
        case ("FairplayConfig.prepareContentId", "identity"): return "return input.contentId;"
        case ("FairplayConfig.prepareContentId", "removeSkdScheme"): return "return input.contentId.toLowerCase().startsWith('skd://') ? input.contentId.slice(6) : input.contentId;"
        case ("FairplayConfig.prepareLicenseServerUrl", _):
            if source.isEmpty { return "return input.url;" }
            if URL(string: source)?.scheme != nil { return "return \(swiftString(source));" }
        default: break
        }
        if ["FairplayConfig.prepareMessage", "FairplayConfig.prepareSyncMessage"].contains(id) {
            switch source {
            case "identity": return "return input.base64;"
            case "base64": return "return {utf8: input.base64};"
            case "formSpc": return "return {utf8: 'spc=' + encodeURIComponent(input.base64).split('%2F').join('/') + '&assetId=' + encodeURIComponent(input.assetId)};"
            case "jsonSpc": return "return {utf8: JSON.stringify({spc: input.base64, assetId: input.assetId})};"
            default: break
            }
        }
        if ["FairplayConfig.prepareCertificate", "FairplayConfig.prepareLicense"].contains(id) {
            switch source {
            case "identity": return "return input.base64;"
            case "base64": return "return input.utf8.trim();"
            case "jsonCkc": return "return JSON.parse(input.utf8).ckc;"
            default: break
            }
        }
        return source
    }

    func callbackSources(owner: ConfigurationOwner) -> [String: String] {
        let ids = Set(Self.nativeCallbackFields.filter { field in
            guard field.owner == owner else { return false }
            if case .script = field.input { return true }; return false
        }.map(\.id))
        return values.filter { ids.contains($0.key) }
    }

    func applyNativeSourceCallbacks(to config: SourceConfig, journal: NativeCallbackJournal?) {
        let sources = callbackSources(owner: .source)
        guard !sources.isEmpty else { return }
        let runtime = journal?.runtime(sources: sources, owner: "source") ?? NativeScriptRuntime(sources: sources)
        if sources["LabelingConfig.audioLabel"] != nil {
            config.labelingConfig.audioLabel = { track in
                runtime.call("LabelingConfig.audioLabel", input: Self.audioInput(track), fallback: track.label, convert: NativeScriptRuntime.string)
            }
        }
        if sources["LabelingConfig.subtitleLabel"] != nil {
            config.labelingConfig.subtitleLabel = { track in
                runtime.call("LabelingConfig.subtitleLabel", input: Self.subtitleInput(track), fallback: track.label, convert: NativeScriptRuntime.string)
            }
        }
        guard let fairplay = config.drmConfig as? FairplayConfig else { return }
        if sources["FairplayConfig.prepareContentId"] != nil {
            fairplay.prepareContentId = { original in runtime.call("FairplayConfig.prepareContentId", input: ["contentId": original], fallback: original, convert: NativeScriptRuntime.string) }
        }
        if sources["FairplayConfig.prepareLicenseServerUrl"] != nil {
            fairplay.prepareLicenseServerUrl = { original in runtime.call("FairplayConfig.prepareLicenseServerUrl", input: ["url": original], fallback: original, convert: NativeScriptRuntime.string) }
        }
        if sources["FairplayConfig.prepareMessage"] != nil {
            fairplay.prepareMessage = { data, asset in runtime.call("FairplayConfig.prepareMessage", input: Self.dataInput(data, assetId: asset), fallback: data, convert: NativeScriptRuntime.data) }
        }
        if sources["FairplayConfig.prepareSyncMessage"] != nil {
            fairplay.prepareSyncMessage = { data, asset in runtime.call("FairplayConfig.prepareSyncMessage", input: Self.dataInput(data, assetId: asset), fallback: data, convert: NativeScriptRuntime.data) }
        }
        if sources["FairplayConfig.prepareCertificate"] != nil {
            fairplay.prepareCertificate = { data in runtime.call("FairplayConfig.prepareCertificate", input: Self.dataInput(data), fallback: data, convert: NativeScriptRuntime.data) }
        }
        if sources["FairplayConfig.prepareLicense"] != nil {
            fairplay.prepareLicense = { data in runtime.call("FairplayConfig.prepareLicense", input: Self.dataInput(data), fallback: data, convert: NativeScriptRuntime.data) }
        }
        if sources["FairplayConfig.prepareOfflineDrmLicenseInformation"] != nil {
            fairplay.prepareOfflineDrmLicenseInformation = { data in
                runtime.call("FairplayConfig.prepareOfflineDrmLicenseInformation", input: Self.dataInput(data), fallback: DrmLicenseInformation(licenseDuration: 0, playbackDuration: 0)) { output in
                    guard let object = output as? [String: Any], let license = NativeScriptRuntime.number(object["licenseDuration"]),
                          let playback = NativeScriptRuntime.number(object["playbackDuration"]) else { return nil }
                    return DrmLicenseInformation(licenseDuration: license, playbackDuration: playback)
                }
            }
        }
        #if !os(tvOS)
        if sources["FairplayConfig.provideLicenseData"] != nil {
            fairplay.provideLicenseData = { asset in
                runtime.call("FairplayConfig.provideLicenseData", input: ["assetId": asset], fallback: Optional<Data>.none) { value -> Data?? in
                    if value == nil { return .some(nil) }
                    return NativeScriptRuntime.data(value).map { .some($0) }
                }
            }
        }
        if sources["FairplayConfig.persistLicenseData"] != nil {
            fairplay.persistLicenseData = { asset, data in
                runtime.call("FairplayConfig.persistLicenseData", input: Self.dataInput(data, assetId: asset), fallback: ()) { _ in () }
            }
        }
        #endif
    }

    func applyNativePlayerCallbacks(to config: PlayerConfig, journal: NativeCallbackJournal?) {
        let sources = callbackSources(owner: .player)
        guard !sources.isEmpty || values.keys.contains(where: { $0.hasPrefix("ImaSettings.") }) || values["InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling"] == "true" else { return }
        let runtime = journal?.runtime(sources: sources, owner: "player") ?? NativeScriptRuntime(sources: sources)
        if sources["PlaybackConfig.isForcedSubtitleCallback"] != nil {
            config.playbackConfig.isForcedSubtitleCallback = { track in
                runtime.call("PlaybackConfig.isForcedSubtitleCallback", input: Self.subtitleInput(track), fallback: track.isForced, convert: NativeScriptRuntime.boolean)
            }
        }
        applyNetworkCallbacks(to: config.networkConfig, runtime: runtime, sources: sources, journal: journal)
        applyAdvertisingCallbacks(to: config.advertisingConfig, runtime: runtime, sources: sources, journal: journal)
        applyInterstitialCallbacks(to: config.interstitialsConfig, runtime: runtime, sources: sources, journal: journal)
        applyNativeRemoteCallback(to: config, runtime: runtime, sources: sources)
    }

    static func dataInput(_ data: Data, assetId: String? = nil) -> [String: Any] {
        var input: [String: Any] = ["base64": data.base64EncodedString(), "bytes": Array(data), "utf8": String(data: data, encoding: .utf8) as Any? ?? NSNull()]
        if let assetId { input["assetId"] = assetId }
        return input
    }

    static func audioInput(_ track: AudioTrack) -> [String: Any] {
        ["id": track.identifier, "label": track.label, "language": track.language as Any? ?? NSNull(),
         "associatedLanguage": track.associatedLanguage as Any? ?? NSNull(), "characteristics": track.characteristics,
         "isDefaultTrack": track.isDefaultTrack, "url": track.url?.absoluteString as Any? ?? NSNull(),
         "codec": track.codec as Any? ?? NSNull(), "channelCount": track.channelCount as Any? ?? NSNull()]
    }

    static func subtitleInput(_ track: SubtitleTrack) -> [String: Any] {
        ["id": track.identifier, "label": track.label, "language": track.language as Any? ?? NSNull(),
         "associatedLanguage": track.associatedLanguage as Any? ?? NSNull(), "characteristics": track.characteristics,
         "isDefaultTrack": track.isDefaultTrack, "isForced": track.isForced, "format": track.format.rawValue,
         "url": track.url?.absoluteString as Any? ?? NSNull()]
    }
}
