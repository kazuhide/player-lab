import Foundation
import BitmovinPlayer

/// Public SDK constructors only. The same source is bundled for the exported Swift example.
final class NativeRemoteSourceFactory: NSObject {
    static func input(_ source: SourceConfig) -> [String: Any] {
        ["url": source.url.absoluteString, "type": source.type.rawValue, "title": source.title as Any? ?? NSNull(),
         "sourceDescription": source.sourceDescription as Any? ?? NSNull(), "posterSource": source.posterSource?.absoluteString as Any? ?? NSNull(),
         "isPosterPersistent": source.isPosterPersistent,
         "options": ["startOffset": source.options.startOffset.isFinite ? source.options.startOffset as Any : NSNull(), "startOffsetTimelineReference": source.options.startOffsetTimelineReference.rawValue, "sharePlayIdentifier": source.options.sharePlayIdentifier as Any? ?? NSNull()],
         "liveConfig": ["targetLatency": source.liveConfig.targetLatency.isFinite ? source.liveConfig.targetLatency as Any : NSNull(), "minTimeshiftBufferDepth": source.liveConfig.minTimeshiftBufferDepth.isFinite ? source.liveConfig.minTimeshiftBufferDepth as Any : NSNull(), "automaticallyPreservesLatency": source.liveConfig.automaticallyPreservesLatency]]
    }

    static func prepare(_ value: Any?, original: SourceConfig) throws -> SourceConfig? {
        guard let value, !(value is NSNull) else { return nil }
        if value as? String == "original" { return original }
        guard let object = value as? [String: Any] else { throw invalid("Return null, 'original', or a source object.") }
        let url = try optionalURL(object, "url") ?? original.url
        let type: SourceType
        if let raw = object["type"] {
            if let text = raw as? String, let parsed = ["hls": SourceType.hls, "dash": .dash, "progressive": .progressive, "movpkg": .movpkg][text] { type = parsed }
            else if let number = integer(raw), let parsed = SourceType(rawValue: number) { type = parsed }
            else { throw invalid("Unknown SourceType.") }
        } else { type = original.type }
        guard type != .none else { throw invalid("SourceType.none cannot construct a SourceConfig. Choose hls, dash, progressive or movpkg.") }
        let result = SourceConfig(url: url, type: type)
        result.title = original.title; result.sourceDescription = original.sourceDescription; result.posterSource = original.posterSource
        result.isPosterPersistent = original.isPosterPersistent
        result.labelingConfig = original.labelingConfig; result.drmConfig = original.drmConfig
        for track in original.tracks.compactMap({ $0 as? SubtitleTrack }) { result.add(subtitleTrack: track) }
        result.thumbnailTrack = original.thumbnailTrack; result.metadata = original.metadata
        result.options = original.options.copy() as! SourceOptions
        result.liveConfig.targetLatency = original.liveConfig.targetLatency
        result.liveConfig.minTimeshiftBufferDepth = original.liveConfig.minTimeshiftBufferDepth
        result.liveConfig.automaticallyPreservesLatency = original.liveConfig.automaticallyPreservesLatency
        #if os(tvOS)
        result.markers = original.markers
        #endif
        if #available(iOS 18, tvOS 18, *) { result.cmcdConfig.isEnabled = original.cmcdConfig.isEnabled }
        if object.keys.contains("title") { result.title = try optionalString(object, "title") }
        if object.keys.contains("sourceDescription") { result.sourceDescription = try optionalString(object, "sourceDescription") }
        if object.keys.contains("posterSource") { result.posterSource = try optionalURL(object, "posterSource") }
        if let value = object["isPosterPersistent"] { guard let flag = boolean(value) else { throw invalid("isPosterPersistent must be boolean.") }; result.isPosterPersistent = flag }
        if let value = object["metadata"] { guard let object = value as? [String: Any] else { throw invalid("metadata must be a JSON object.") }; result.metadata = object }
        if let value = object["thumbnailTrack"] {
            if value is NSNull { result.thumbnailTrack = nil }
            else { guard let text = value as? String, let url = URL(string: text), url.scheme != nil else { throw invalid("thumbnailTrack requires an absolute URL or null.") }; result.thumbnailTrack = ThumbnailTrack(url: url, label: original.thumbnailTrack?.label ?? "Thumbnails", identifier: original.thumbnailTrack?.identifier ?? "player-lab-remote-thumbnails", isDefaultTrack: original.thumbnailTrack?.isDefaultTrack ?? false) }
        }
        if let value = object["drmConfig"] {
            if value is NSNull { result.drmConfig = nil }
            else if value as? String == "original" { result.drmConfig = original.drmConfig }
            else { guard let object = value as? [String: Any] else { throw invalid("drmConfig requires a receiver DRM object, 'original' or null.") }; result.drmConfig = try receiverDrm(object) }
        }
        if let value = object["options"] {
            guard let options = value as? [String: Any] else { throw invalid("options requires an object.") }
            if let value = options["startOffset"] { if value is NSNull { result.options.startOffset = .nan } else { guard let number = number(value) else { throw invalid("startOffset must be finite or null.") }; result.options.startOffset = number } }
            if let raw = options["startOffsetTimelineReference"] {
                if let text = raw as? String, let value = ["auto": TimelineReferencePoint.auto, "start": .start, "end": .end][text] { result.options.startOffsetTimelineReference = value }
                else if let integer = integer(raw), let value = TimelineReferencePoint(rawValue: integer) { result.options.startOffsetTimelineReference = value }
                else { throw invalid("Unknown timeline reference.") }
            }
            if options.keys.contains("sharePlayIdentifier") { result.options.sharePlayIdentifier = try optionalString(options, "sharePlayIdentifier") }
        }
        if let value = object["liveConfig"] {
            guard let live = value as? [String: Any] else { throw invalid("liveConfig requires an object.") }
            for name in ["targetLatency", "minTimeshiftBufferDepth"] {
                if let raw = live[name] {
                    // A null target latency preserves the SDK's unset sentinel in a complete snapshot.
                    if raw is NSNull { continue }
                    guard let value = number(raw) else { throw invalid("\(name) requires finite seconds or null to preserve the SDK value.") }
                    if name == "targetLatency" {
                        guard value >= 0 else { throw invalid("targetLatency requires nonnegative seconds or null to preserve the SDK value.") }
                        result.liveConfig.targetLatency = value
                    } else {
                        guard value <= 0 else { throw invalid("minTimeshiftBufferDepth requires zero or negative seconds, matching maxTimeShift.") }
                        result.liveConfig.minTimeshiftBufferDepth = value
                    }
                }
            }
            if let raw = live["automaticallyPreservesLatency"] { guard let flag = boolean(raw) else { throw invalid("automaticallyPreservesLatency requires boolean.") }; result.liveConfig.automaticallyPreservesLatency = flag }
        }
        if let raw = object["cmcdEnabled"] {
            guard let flag = boolean(raw) else { throw invalid("cmcdEnabled requires boolean.") }
            if #available(iOS 18, tvOS 18, *) { result.cmcdConfig.isEnabled = flag }
            else { throw invalid("CMCD requires iOS/tvOS 18.") }
        }
        return result
    }

    static func remote(_ object: [String: Any]) throws -> RemoteControlConfig {
        let config = RemoteControlConfig()
        for (name, keyPath) in ["isAirPlayEnabled": \RemoteControlConfig.isAirPlayEnabled, "allowsAirPlay": \.allowsAirPlay, "isCastEnabled": \.isCastEnabled, "usesExternalPlaybackWhileExternalScreenIsActive": \.usesExternalPlaybackWhileExternalScreenIsActive, "sendManifestRequestsWithCredentials": \.sendManifestRequestsWithCredentials, "sendSegmentRequestsWithCredentials": \.sendSegmentRequestsWithCredentials, "sendDrmLicenseRequestsWithCredentials": \.sendDrmLicenseRequestsWithCredentials].sorted(by: { $0.key == "isAirPlayEnabled" && $1.key != "isAirPlayEnabled" }) {
            if let raw = object[name] { guard let flag = boolean(raw) else { throw invalid("\(name) requires boolean.") }; config[keyPath: keyPath] = flag }
        }
        if object.keys.contains("receiverStylesheetUrl") { config.receiverStylesheetUrl = try optionalURL(object, "receiverStylesheetUrl") }
        if let value = object["customReceiverConfig"] { guard let dictionary = value as? [String: String] else { throw invalid("customReceiverConfig requires a string dictionary.") }; config.customReceiverConfig = dictionary }
        return config
    }

    static func receiverDrm(_ object: [String: Any]) throws -> DrmConfig {
        guard let type = object["type"] as? String else { throw invalid("Receiver DRM requires type: widevine, playReady or clearKey.") }
        let result: DrmConfig
        if type == "clearKey" {
            guard let values = object["decryptionKeys"] as? [[String: Any]], !values.isEmpty else { throw invalid("ClearKey requires decryptionKeys [{key, keyId}].") }
            let keys = try values.map { object -> DecryptionKey in
                guard let key = object["key"] as? String, !key.isEmpty, key.count.isMultiple(of: 2), key.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { throw invalid("A decryption key requires complete hexadecimal byte pairs.") }
                let kid = try optionalString(object, "kid") ?? optionalString(object, "keyId")
                if let kid { guard kid.count.isMultiple(of: 2), kid.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { throw invalid("kid requires hexadecimal byte pairs or null.") } }
                return DecryptionKey(kid: kid, key: key)
            }
            result = ClearKeyConfig(decryptionKeys: keys)
        } else if type == "widevine" { result = WidevineConfig(license: try optionalURL(object, "licenseUrl")) }
        else if type == "playReady" { result = PlayReadyConfig(license: try optionalURL(object, "licenseUrl")) }
        else { throw invalid("Receiver DRM type must be widevine, playReady or clearKey. Omit drmConfig or return 'original' to preserve the existing FairPlay object and its callbacks.") }
        if object.keys.contains("licenseUrl") { result.licenseUrl = try optionalURL(object, "licenseUrl") }
        if let value = object["uuid"] { guard let text = value as? String, let uuid = UUID(uuidString: text) else { throw invalid("uuid requires a UUID string.") }; result.uuid = uuid }
        let headers: [String: String]?
        if let value = object["licenseRequestHeaders"] { guard let dictionary = value as? [String: String], dictionary.allSatisfy({ !$0.key.isEmpty && $0.key.range(of: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$", options: .regularExpression) != nil && !$0.value.contains("\r") && !$0.value.contains("\n") }) else { throw invalid("Invalid licenseRequestHeaders.") }; headers = dictionary } else { headers = nil }
        let retry = try unsigned(object, "licenseRequestRetryDelay"), maximum = try unsigned(object, "maxLicenseRequestRetries")
        let system = try optionalString(object, "mediaKeySystemConfig")
        if let system { guard let _ = try JSONSerialization.jsonObject(with: Data(system.utf8)) as? [String: Any] else { throw invalid("mediaKeySystemConfig requires serialized JSON object text.") } }
        if let drm = result as? WidevineConfig { if let headers { drm.licenseRequestHeaders = headers }; if let retry { drm.licenseRequestRetryDelay = retry }; if let maximum { drm.maxLicenseRequestRetries = maximum }; drm.mediaKeySystemConfig = system }
        if let drm = result as? PlayReadyConfig { if let headers { drm.licenseRequestHeaders = headers }; if let retry { drm.licenseRequestRetryDelay = retry }; if let maximum { drm.maxLicenseRequestRetries = maximum }; drm.mediaKeySystemConfig = system }
        return result
    }

    private static func boolean(_ value: Any?) -> Bool? { guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }; return number.boolValue }
    private static func number(_ value: Any?) -> Double? { guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return nil }; return number.doubleValue }
    private static func integer(_ value: Any?) -> Int? { if let text = value as? String { return Int(text) }; guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }; return Int(number.stringValue) ?? Int(exactly: number.doubleValue) }
    private static func unsigned(_ object: [String: Any], _ name: String) throws -> UInt? { guard let value = object[name] else { return nil }; if let text = value as? String, let number = UInt(text) { return number }; if let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), let number = UInt(value.stringValue) { return number }; throw invalid("\(name) requires a UInt; a decimal string preserves the full range.") }
    private static func optionalString(_ object: [String: Any], _ name: String) throws -> String? { guard let value = object[name], !(value is NSNull) else { return nil }; guard let string = value as? String else { throw invalid("\(name) requires string or null.") }; return string }
    private static func optionalURL(_ object: [String: Any], _ name: String) throws -> URL? { guard let text = try optionalString(object, name) else { return nil }; guard let url = URL(string: text), url.scheme != nil else { throw invalid("\(name) requires an absolute URL.") }; return url }
    private static func invalid(_ message: String) -> NSError { NSError(domain: "PlayerLab.RemoteSource", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
