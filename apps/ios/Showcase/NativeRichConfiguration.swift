import Foundation
import AVFoundation
import BitmovinPlayer

extension AdvancedConfiguration {
    static var richFields: [AdvancedConfigurationField] {
        var fields: [AdvancedConfigurationField] = [
            .init("PlayerConfig.key", .player, "key", .secret, "Optional local Player license override. A value is required when enabled. The value is kept in memory and excluded from exported code."),
            .init("PlaybackConfig.isPictureInPictureEnabled", .player, "playbackConfig.isPictureInPictureEnabled", .boolean, "Deprecated SDK setting. Prefer PlayerViewConfig.pictureInPictureConfig.isEnabled."),
            .init("LiveConfig.minTimeshiftBufferDepth", .player, "liveConfig.minTimeshiftBufferDepth", .nonPositiveNumber, "Deprecated player-level setting in seconds. Prefer SourceLiveConfig.minTimeshiftBufferDepth."),
            .init("ClearKeyConfig.decryptionKeys", .source, "drmConfig.decryptionKeys", .json(initial: "[]"), "Array of {key: hexadecimal content key, kid: optional hexadecimal key identifier}. Select ClearKey first. Values remain local; exported keys are placeholders. Can be combined with the single-key fields."),
        ]
        for owner in ["WidevineConfig", "PlayReadyConfig"] {
            fields += [
                .init(owner + ".licenseRequestHeaders", .source, "drmConfig.licenseRequestHeaders", .json(initial: "{}"), "Receiver license request headers as a string dictionary. Values are excluded from code. Select the matching receiver DRM system first."),
                .init(owner + ".licenseRequestRetryDelay", .source, "drmConfig.licenseRequestRetryDelay", .text, "Unsigned whole-number retry delay in milliseconds."),
                .init(owner + ".maxLicenseRequestRetries", .source, "drmConfig.maxLicenseRequestRetries", .text, "Unsigned whole-number retry count."),
                .init(owner + ".mediaKeySystemConfig", .source, "drmConfig.mediaKeySystemConfig", .text, "Optional JSON MediaKeySystemConfiguration object encoded as text. Empty clears it. This config is used by a compatible receiver, not local Apple DRM playback."),
            ]
        }
        #if !os(tvOS)
        fields += [
            .init("RemoteControlConfig.customReceiverConfig", .player, "remoteControlConfig.customReceiverConfig", .json(initial: "{}"), "Custom receiver options as a JSON string dictionary."),
            .init("BitmovinUserInterfaceConfig.customOptions", .player, "styleConfig.userInterfaceConfig.customOptions", .json(initial: "{}"), "Options passed to the Web UI as a JSON object. Requires Bitmovin UI."),
        ]
        #endif
        return fields
    }

    static func normalizeRichValue(_ value: String, id: String) throws -> String {
        if id == "PlayerConfig.key", value.isEmpty { throw ConfigurationValidationError(message: "PlayerConfig.key needs a nonempty license value when overridden.") }
        if id == "ClearKeyConfig.decryptionKeys" { _ = try decryptionKeys(value); return try canonicalJson(value) }
        if id.hasPrefix("WidevineConfig.") || id.hasPrefix("PlayReadyConfig.") {
            if id.hasSuffix("licenseRequestHeaders") { _ = try headerDictionary(value); return try canonicalJson(value) }
            if id.hasSuffix("RetryDelay") || id.hasSuffix("Retries") {
                guard let number = UInt(value) else { throw ConfigurationValidationError(message: "\(id) needs an unsigned whole number.") }
                return String(number)
            }
            if id.hasSuffix("mediaKeySystemConfig"), !value.isEmpty {
                guard (try JSONSerialization.jsonObject(with: Data(value.utf8))) is [String: Any] else { throw ConfigurationValidationError(message: "\(id) needs a JSON object or empty text.") }
                return try canonicalJson(value)
            }
        }
        if id == "RemoteControlConfig.customReceiverConfig" {
            guard (try JSONSerialization.jsonObject(with: Data(value.utf8))) is [String: String] else { throw ConfigurationValidationError(message: "Custom receiver configuration needs a JSON string dictionary.") }
            return try canonicalJson(value)
        }
        if id == "BitmovinUserInterfaceConfig.customOptions" {
            guard (try JSONSerialization.jsonObject(with: Data(value.utf8))) is [String: Any] else { throw ConfigurationValidationError(message: "Web UI custom options need a JSON object.") }
            return try canonicalJson(value)
        }
        return value
    }

    static func decryptionKeys(_ json: String) throws -> [DecryptionKey] {
        guard let objects = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else { throw ConfigurationValidationError(message: "ClearKey decryptionKeys needs an array of key objects.") }
        return try objects.map { object in
            guard object.keys.allSatisfy({ ["key", "kid"].contains($0) }), let key = object["key"] as? String,
                  !key.isEmpty, key.count.isMultiple(of: 2), key.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { throw ConfigurationValidationError(message: "Each ClearKey object needs a complete hexadecimal key and optional kid only.") }
            var kid: String?
            if let value = object["kid"], !(value is NSNull) {
                guard let value = value as? String, value.count.isMultiple(of: 2), value.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { throw ConfigurationValidationError(message: "ClearKey kid must contain hexadecimal byte pairs or null.") }
                kid = value.isEmpty ? nil : value.lowercased()
            }
            return DecryptionKey(kid: kid, key: key.lowercased())
        }
    }

    func configuredClearKeys() -> [DecryptionKey] {
        var keys = values["ClearKeyConfig.decryptionKeys"].map { try! Self.decryptionKeys($0) } ?? []
        if let key = values["DecryptionKey.key"] { keys.append(DecryptionKey(kid: nonempty("DecryptionKey.kid"), key: key)) }
        return keys
    }

    func makeReceiverDrm(_ kind: String) -> DrmConfig {
        let license = nonempty("DrmConfig.licenseUrl").flatMap(URL.init(string:))
        if kind == "widevine" {
            let drm = WidevineConfig(license: license)
            if let value = values["WidevineConfig.licenseRequestHeaders"] { drm.licenseRequestHeaders = try! Self.headerDictionary(value) }
            if let value = values["WidevineConfig.licenseRequestRetryDelay"] { drm.licenseRequestRetryDelay = UInt(value)! }
            if let value = values["WidevineConfig.maxLicenseRequestRetries"] { drm.maxLicenseRequestRetries = UInt(value)! }
            if values["WidevineConfig.mediaKeySystemConfig"] != nil { drm.mediaKeySystemConfig = nonempty("WidevineConfig.mediaKeySystemConfig") }
            return drm
        }
        let drm = PlayReadyConfig(license: license)
        if let value = values["PlayReadyConfig.licenseRequestHeaders"] { drm.licenseRequestHeaders = try! Self.headerDictionary(value) }
        if let value = values["PlayReadyConfig.licenseRequestRetryDelay"] { drm.licenseRequestRetryDelay = UInt(value)! }
        if let value = values["PlayReadyConfig.maxLicenseRequestRetries"] { drm.maxLicenseRequestRetries = UInt(value)! }
        if values["PlayReadyConfig.mediaKeySystemConfig"] != nil { drm.mediaKeySystemConfig = nonempty("PlayReadyConfig.mediaKeySystemConfig") }
        return drm
    }

    func applyRichPlayer(to config: PlayerConfig) {
        if let value = values["PlayerConfig.key"] { config.key = value }
        if let value = values["PlaybackConfig.isPictureInPictureEnabled"] { config.playbackConfig.isPictureInPictureEnabled = value == "true" }
        if let value = values["LiveConfig.minTimeshiftBufferDepth"] { config.liveConfig.minTimeshiftBufferDepth = Double(value)! }
        #if !os(tvOS)
        if let value = jsonValue("RemoteControlConfig.customReceiverConfig") as? [String: String] { config.remoteControlConfig.customReceiverConfig = value }
        #endif
    }

    var richCode: [String] {
        var lines: [String] = []
        if let value = values["PlayerConfig.key"] { lines.append("playerConfig.key = \(value.isEmpty ? "nil" : "\"<PLAYER_LICENSE_KEY>\"")") }
        if let value = values["PlaybackConfig.isPictureInPictureEnabled"] { lines.append("playerConfig.playbackConfig.isPictureInPictureEnabled = \(value)") }
        if let value = values["LiveConfig.minTimeshiftBufferDepth"] { lines.append("playerConfig.liveConfig.minTimeshiftBufferDepth = \(value)") }
        #if !os(tvOS)
        if let value = values["RemoteControlConfig.customReceiverConfig"] { lines.append("playerConfig.remoteControlConfig.customReceiverConfig = try! JSONSerialization.jsonObject(with: Data(\(swiftString(value)).utf8)) as! [String: String]") }
        if let value = values["BitmovinUserInterfaceConfig.customOptions"] { lines.append("webUiConfig.customOptions = try! JSONSerialization.jsonObject(with: Data(\(swiftString(value)).utf8)) as! [String: Any]") }
        #endif
        return lines
    }

    var receiverDrmCode: [String] {
        guard let kind = values["SourceConfig.drmConfig"], ["widevine", "playReady"].contains(kind) else { return [] }
        let owner = kind == "widevine" ? "WidevineConfig" : "PlayReadyConfig"
        let license = nonempty("DrmConfig.licenseUrl").map { "URL(string: \(swiftString($0)))" } ?? "nil"
        var lines = ["let receiverDrm = \(owner)(license: \(license))"]
        if let json = values[owner + ".licenseRequestHeaders"], let headers = try? Self.headerDictionary(json) { lines.append("receiverDrm.licenseRequestHeaders = \(Self.headersCode(headers))") }
        for member in ["licenseRequestRetryDelay", "maxLicenseRequestRetries"] { if let value = values[owner + "." + member] { lines.append("receiverDrm.\(member) = \(value)") } }
        if values[owner + ".mediaKeySystemConfig"] != nil { lines.append("receiverDrm.mediaKeySystemConfig = \(nonempty(owner + ".mediaKeySystemConfig").map(swiftString) ?? "nil")") }
        lines.append("sourceConfig.drmConfig = receiverDrm")
        return lines
    }

    private static func canonicalJson(_ value: String) throws -> String { String(decoding: try JSONSerialization.data(withJSONObject: JSONSerialization.jsonObject(with: Data(value.utf8), options: [.fragmentsAllowed]), options: [.sortedKeys, .fragmentsAllowed]), as: UTF8.self) }
    private static func headerDictionary(_ json: String) throws -> [String: String] {
        guard let headers = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String], headers.allSatisfy({ pair in
            !pair.key.isEmpty && pair.key.unicodeScalars.allSatisfy { (33...126).contains($0.value) && !"()<>@,;:\\\"/[]?={} \t".unicodeScalars.contains($0) } && !pair.value.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" })
        }) else { throw ConfigurationValidationError(message: "License headers need valid HTTP token names and string values without line breaks.") }
        return headers
    }
}
