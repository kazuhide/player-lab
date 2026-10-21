import Foundation

extension AdvancedConfiguration {
    var nativeCallbackCode: [String] {
        var lines: [String] = []
        for owner in [ConfigurationOwner.player, .source, .view] {
            let sources = callbackSources(owner: owner)
            let needsPlayerSetup = owner == .player && (values["BitmovinUserInterfaceConfig.customMessageHandler"] == "true" || values["InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling"] == "true")
            guard !sources.isEmpty || needsPlayerSetup else { continue }
            let name = owner == .player ? "playerScript" : owner == .source ? "sourceScript" : "viewScript"
            lines += scriptPreamble(sources, name: name)
            lines += nativeNetworkCode(sources: sources, name: name)
            lines += nativeAdvertisingCallbackCode(sources: sources, name: name)
            lines += nativeUiCallbackCode(sources: sources, name: name)
            lines += nativeInterstitialCode(sources: sources, name: name)
            lines += nativeLoggingCallbackCode(sources: sources, name: name)
            lines += nativeRemoteCode(sources: sources, name: name)
            if sources["PlaybackConfig.isForcedSubtitleCallback"] != nil {
                lines += ["playerConfig.playbackConfig.isForcedSubtitleCallback = { track in",
                    "    \(name)(\"PlaybackConfig.isForcedSubtitleCallback\", \(subtitleInputCode)) as? Bool ?? track.isForced", "}"]
            }
            for kind in ["audioLabel", "subtitleLabel"] where sources["LabelingConfig." + kind] != nil {
                let input = kind == "audioLabel" ? audioInputCode : subtitleInputCode
                lines += ["sourceConfig.labelingConfig.\(kind) = { track in", "    \(name)(\"LabelingConfig.\(kind)\", \(input)) as? String ?? track.label", "}"]
            }
            guard sources.keys.contains(where: { $0.hasPrefix("FairplayConfig.") }) else { continue }
            lines.append("if let callbackFairplay = sourceConfig.drmConfig as? FairplayConfig {")
            for field in ["prepareContentId", "prepareLicenseServerUrl"] where sources["FairplayConfig." + field] != nil {
                let key = field == "prepareContentId" ? "contentId" : "url"
                lines.append("    callbackFairplay.\(field) = { original in \(name)(\"FairplayConfig.\(field)\", [\"\(key)\": original]) as? String ?? original }")
            }
            for field in ["prepareMessage", "prepareSyncMessage", "prepareCertificate", "prepareLicense"] where sources["FairplayConfig." + field] != nil {
                let hasAsset = ["prepareMessage", "prepareSyncMessage"].contains(field)
                lines += ["    callbackFairplay.\(field) = { data\(hasAsset ? ", assetId" : "") in",
                    "        \(name)Data(\(name)(\"FairplayConfig.\(field)\", \(dataInputCode(asset: hasAsset)))) ?? data", "    }"]
            }
            if sources["FairplayConfig.prepareOfflineDrmLicenseInformation"] != nil {
                lines += ["    callbackFairplay.prepareOfflineDrmLicenseInformation = { data in",
                    "        let output = \(name)(\"FairplayConfig.prepareOfflineDrmLicenseInformation\", \(dataInputCode())) as? [String: Any]",
                    "        let license = output?[\"licenseDuration\"] as? Double ?? 0",
                    "        let playback = output?[\"playbackDuration\"] as? Double ?? 0",
                    "        return DrmLicenseInformation(licenseDuration: license.isFinite ? license : 0, playbackDuration: playback.isFinite ? playback : 0)", "    }"]
            }
            #if !os(tvOS)
            if sources["FairplayConfig.provideLicenseData"] != nil {
                lines.append("    callbackFairplay.provideLicenseData = { assetId in \(name)Data(\(name)(\"FairplayConfig.provideLicenseData\", [\"assetId\": assetId])) }")
            }
            if sources["FairplayConfig.persistLicenseData"] != nil {
                lines += ["    callbackFairplay.persistLicenseData = { assetId, data in", "        _ = \(name)(\"FairplayConfig.persistLicenseData\", \(dataInputCode(asset: true)))", "    }"]
            }
            #endif
            lines.append("}")
        }
        return lines
    }

    private var trackInputCode: String {
        "[\"id\": track.identifier, \"label\": track.label, \"language\": track.language as Any? ?? NSNull(), \"associatedLanguage\": track.associatedLanguage as Any? ?? NSNull(), \"characteristics\": track.characteristics, \"isDefaultTrack\": track.isDefaultTrack]"
    }
    private var audioInputCode: String {
        String(trackInputCode.dropLast()) + ", \"url\": track.url?.absoluteString as Any? ?? NSNull(), \"codec\": track.codec as Any? ?? NSNull(), \"channelCount\": track.channelCount as Any? ?? NSNull()]"
    }
    private var subtitleInputCode: String {
        String(trackInputCode.dropLast()) + ", \"isForced\": track.isForced, \"format\": track.format.rawValue, \"url\": track.url?.absoluteString as Any? ?? NSNull()]"
    }
    private func dataInputCode(asset: Bool = false) -> String {
        "[\"base64\": data.base64EncodedString(), \"bytes\": Array(data), \"utf8\": String(data: data, encoding: .utf8) as Any? ?? NSNull()" + (asset ? ", \"assetId\": assetId]" : "]")
    }

    private func scriptPreamble(_ sources: [String: String], name: String) -> [String] {
        return NativeScriptRuntime.codePreamble(sources, name: name) + [
            "func \(name)Data(_ value: Any?) -> Data? {",
            "    if let base64 = value as? String { return Data(base64Encoded: base64) }",
            "    if let object = value as? [String: Any], let text = object[\"utf8\"] as? String { return Data(text.utf8) }",
            "    guard let bytes = value as? [NSNumber] else { return nil }",
            "    var data = Data(capacity: bytes.count)",
            "    for byte in bytes {",
            "        guard CFGetTypeID(byte) != CFBooleanGetTypeID(), byte.doubleValue.isFinite, byte.doubleValue.rounded(.towardZero) == byte.doubleValue, (0...255).contains(byte.doubleValue) else { return nil }",
            "        data.append(byte.uint8Value)",
            "    }",
            "    return data",
            "}",
        ]
    }
}
