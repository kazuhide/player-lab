import Foundation
import BitmovinPlayer

enum NativeRemoteExample {
    static var factorySource: String {
        guard let url = Bundle(for: NativeRemoteSourceFactory.self).url(forResource: "NativeRemoteSourceFactory.swift", withExtension: "txt"), let source = try? String(contentsOf: url, encoding: .utf8) else { return "// NativeRemoteSourceFactory.swift is missing from this build's resources. Regenerate the Xcode project from project.yml." }
        return source
    }
}

extension AdvancedConfiguration {
    static var nativeRemoteCallbacks: [AdvancedConfigurationField] {
        #if os(tvOS)
        return []
        #else
        return [.init("RemoteControlConfig.prepareSource", .player, "remoteControlConfig.prepareSource", .script(initial: "return 'original';"), "input.type is cast; input.source has URL, numeric SourceType, title, description, poster, persistence, options and live settings. Return 'original', null, or a source patch. Live numeric null values preserve the SDK unset state. Native DRM, labeling, subtitles, metadata and thumbnails are preserved unless overridden. drmConfig may be a typed widevine/playReady/clearKey object for the receiver; the existing FairPlay object is preserved by omission or 'original'.")]
        #endif
    }
    func applyNativeRemoteCallback(to config: PlayerConfig, runtime: NativeScriptRuntime, sources: [String: String]) {
        #if !os(tvOS)
        let id = "RemoteControlConfig.prepareSource"
        if sources[id] != nil {
            config.remoteControlConfig.prepareSource = { type, original in
                runtime.call(id, input: ["type": type == .cast ? "cast" : "unknown", "source": NativeRemoteSourceFactory.input(original)], fallback: Optional(original)) { value -> SourceConfig?? in
                    do { return .some(try NativeRemoteSourceFactory.prepare(value, original: original)) } catch { return nil }
                }
            }
        }
        #endif
    }
    func nativeRemoteCode(sources: [String: String], name: String) -> [String] {
        #if !os(tvOS)
        if sources["RemoteControlConfig.prepareSource"] != nil {
            return [NativeRemoteExample.factorySource,
                "playerConfig.remoteControlConfig.prepareSource = { type, original in",
                "    guard let output = \(name)(\"RemoteControlConfig.prepareSource\", [\"type\": type == .cast ? \"cast\" : \"unknown\", \"source\": NativeRemoteSourceFactory.input(original)]) else { return original }",
                "    do { return try NativeRemoteSourceFactory.prepare(output, original: original) } catch { return original }",
                "}"]
        }
        #endif
        return []
    }
}

extension ApiOperation {
    static var remoteBooleanNames: [String] { ["isAirPlayEnabled", "allowsAirPlay", "isCastEnabled", "usesExternalPlaybackWhileExternalScreenIsActive", "sendManifestRequestsWithCredentials", "sendSegmentRequestsWithCredentials", "sendDrmLicenseRequestsWithCredentials"] }
    var remoteArguments: [ApiArgument] {
        switch self {
        case .remoteConfigPreview, .cafWidevine, .cafPlayReady, .cafClearKey:
            return Self.remoteBooleanNames.map { .init($0, "RemoteControlConfig." + $0, .choice(["SDK default", "true", "false"])) } + [
                .init("receiverStylesheetUrl", "RemoteControlConfig.receiverStylesheetUrl", .url),
                .init("customReceiverConfig", "RemoteControlConfig.customReceiverConfig", .json(initial: "{}"), note: "A string dictionary passed to the actual native RemoteControlConfig constructor."),
                .init("prepareSource", "RemoteControlConfig.prepareSource body", .script(initial: "return 'original';"), note: "Returns a source patch, 'original' or null. On tvOS this creates a detached native RemoteControlConfig used by receiver DRM conversion; PlayerConfig.remoteControlConfig itself is unavailable on tvOS."),
            ] + (self == .remoteConfigPreview ? [] : [.init("drm", "Receiver DRM settings", .json(initial: self == .cafClearKey ? "{\"type\":\"clearKey\",\"decryptionKeys\":[{\"kid\":\"<KEY_ID>\",\"key\":\"<LOCAL_KEY>\"}]}" : "{\"type\":\"\(self == .cafWidevine ? "widevine" : "playReady")\",\"licenseUrl\":\"https://example.com/license\"}"), note: "Fields: type, licenseUrl, uuid, licenseRequestHeaders, licenseRequestRetryDelay, maxLicenseRequestRetries, mediaKeySystemConfig; ClearKey uses decryptionKeys [{key,kid}]. Enter a real local test key before converting encrypted media. Header and decryption-key values are excluded from code.")])
        default: return []
        }
    }

    static func remoteObject(_ arguments: [String: String]) throws -> [String: Any] {
        var object: [String: Any] = [:]
        for name in remoteBooleanNames where arguments[name] != nil && arguments[name] != "SDK default" { object[name] = arguments[name] == "true" }
        if let url = arguments["receiverStylesheetUrl"], !url.isEmpty { object["receiverStylesheetUrl"] = url }
        let value = try JSONSerialization.jsonObject(with: Data((arguments["customReceiverConfig"] ?? "{}").utf8))
        guard value is [String: String] else { throw ConfigurationValidationError(message: "customReceiverConfig requires a string dictionary.") }; object["customReceiverConfig"] = value
        return object
    }
    func remoteCode(_ arguments: [String: String]) throws -> String {
        switch self {
        case .remoteConfigPreview, .cafWidevine, .cafPlayReady, .cafClearKey:
            let object = try Self.remoteObject(arguments); _ = try NativeRemoteSourceFactory.remote(object)
            let json = String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
            var lines = [NativeRemoteExample.factorySource, "let remoteObject = try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8)) as! [String: Any]", "let remote = try! NativeRemoteSourceFactory.remote(remoteObject)"]
            if self == .remoteConfigPreview {
                let body = arguments["prepareSource"] ?? "return 'original';"
                try NativeScriptRuntime.validate(body, id: "RemoteControlConfig.prepareSource")
                lines += ["import JavaScriptCore"] + NativeScriptRuntime.codePreamble(["prepare": body], name: "remoteScript") + [
                    "remote.prepareSource = { type, original in",
                    "    guard let output = remoteScript(\"prepare\", [\"type\": type == .cast ? \"cast\" : \"unknown\", \"source\": NativeRemoteSourceFactory.input(original)]) else { return original }",
                    "    do { return try NativeRemoteSourceFactory.prepare(output, original: original) } catch { return original }",
                    "}", "let prepared = remote.prepareSource?(.cast, sourceConfig)"]

            } else {
                guard var drm = try JSONSerialization.jsonObject(with: Data((arguments["drm"] ?? "{}").utf8)) as? [String: Any] else { throw ConfigurationValidationError(message: "Receiver DRM needs an object.") }
                _ = try NativeRemoteSourceFactory.receiverDrm(drm)
                if let headers = drm["licenseRequestHeaders"] as? [String: String] { drm["licenseRequestHeaders"] = headers.mapValues { _ in "<LOCAL_HEADER_VALUE>" } }
                if let keys = drm["decryptionKeys"] as? [[String: Any]] { drm["decryptionKeys"] = keys.map { item -> [String: Any] in var item = item; item["key"] = "<LOCAL_CLEAR_KEY>"; return item } }
                let json = String(decoding: try JSONSerialization.data(withJSONObject: drm, options: [.sortedKeys]), as: UTF8.self)
                let type = self == .cafWidevine ? "WidevineConfig" : self == .cafPlayReady ? "PlayReadyConfig" : "ClearKeyConfig"
                lines += ["let drmObject = try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8)) as! [String: Any]", "let drm = try! NativeRemoteSourceFactory.receiverDrm(drmObject) as! \(type)", "let converted = drm.toCafDrmConfig(remoteControlConfig: remote)", "// The SDK owns the returned receiver configuration; no internal factory or serializer is used."]
            }
            return lines.joined(separator: "\n")
        default: return try televisionCode(arguments)
        }
    }
}

extension PlayerModel {
    @MainActor
    func executeRemoteApi(_ operation: ApiOperation, arguments: [String: String]) throws -> String {
        switch operation {
        case .remoteConfigPreview, .cafWidevine, .cafPlayReady, .cafClearKey:
            let remote = try NativeRemoteSourceFactory.remote(ApiOperation.remoteObject(arguments))
            let runtime = NativeScriptRuntime(sources: ["prepare": arguments["prepareSource"] ?? "return 'original';"], journal: playerCallbackJournal)
            remote.prepareSource = { type, original in
                runtime.call("prepare", input: ["type": type == .cast ? "cast" : "unknown", "source": NativeRemoteSourceFactory.input(original)], fallback: Optional(original)) { value -> SourceConfig?? in do { return .some(try NativeRemoteSourceFactory.prepare(value, original: original)) } catch { return nil } }
            }
            if operation == .remoteConfigPreview {
                guard let source = player.source?.sourceConfig ?? sourceSettings?.makeSourceConfig() else { throw ConfigurationValidationError(message: "Configure a source before preparing it for remote playback.") }
                let prepared = remote.prepareSource?(.cast, source)
                return "Typed RemoteControlConfig: cast=\(remote.isCastEnabled); AirPlay=\(remote.allowsAirPlay); externalScreen=\(remote.usesExternalPlaybackWhileExternalScreenIsActive); manifestCredentials=\(remote.sendManifestRequestsWithCredentials); segmentCredentials=\(remote.sendSegmentRequestsWithCredentials); DRMCredentials=\(remote.sendDrmLicenseRequestsWithCredentials); receiverSettings=\(remote.customReceiverConfig.count). Prepared source: \(prepared == nil ? "nil" : prepared === source ? "original instance" : "new native SourceConfig"). URL values are omitted."
            }
            guard let object = try JSONSerialization.jsonObject(with: Data((arguments["drm"] ?? "{}").utf8)) as? [String: Any] else { throw ConfigurationValidationError(message: "Receiver DRM needs an object.") }
            let drm = try NativeRemoteSourceFactory.receiverDrm(object)
            let converted: Bool
            switch operation {
            case .cafWidevine: guard let drm = drm as? WidevineConfig else { throw ConfigurationValidationError(message: "Choose type widevine for this operation.") }; converted = drm.toCafDrmConfig(remoteControlConfig: remote) != nil
            case .cafPlayReady: guard let drm = drm as? PlayReadyConfig else { throw ConfigurationValidationError(message: "Choose type playReady for this operation.") }; converted = drm.toCafDrmConfig(remoteControlConfig: remote) != nil
            default: guard let drm = drm as? ClearKeyConfig else { throw ConfigurationValidationError(message: "Choose type clearKey for this operation.") }; converted = drm.toCafDrmConfig(remoteControlConfig: remote) != nil
            }
            return "The public SDK receiver conversion returned \(converted ? "a receiver DRM configuration" : "nil"). This is configuration conversion, not remote device playback or license acquisition."
        default: return try executeTelevisionApi(operation, arguments: arguments)
        }
    }
}
