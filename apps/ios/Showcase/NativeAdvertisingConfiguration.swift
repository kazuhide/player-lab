import Foundation
import BitmovinPlayer

extension AdvancedConfiguration {
    static var nativeAdvertisingFields: [AdvancedConfigurationField] {
        var fields: [AdvancedConfigurationField] = [
            .init("AdvertisingConfig.schedule", .player, "advertisingConfig.schedule", .json(initial: "[]"), "Array of ad items. Example: [{\"sources\":[{\"tag\":\"https://example.com/vast.xml\",\"type\":\"ima\",\"vastLoadTimeout\":8,\"videoLoadTimeout\":8}],\"trigger\":\"pre\",\"linearUi\":{\"requestsUi\":true,\"message\":\"Advertisement\"}}]. Trigger also accepts post, {seconds: 10} or {percentage: 25}. An optional legacy position string can replace trigger. Each item may have multiple fallback sources. linearUi also accepts untilSkippableMessage and skippableMessage."),
            .init("ImaSettings.ppid", .player, "advertisingConfig.beforeInitialization.ppid", .secret, "Optional publisher-provided identifier, applied to the SDK's ImaSettings before initialization. Exported values are redacted."),
            .init("ImaSettings.language", .player, "advertisingConfig.beforeInitialization.language", .text),
            .init("ImaSettings.maxRedirects", .player, "advertisingConfig.beforeInitialization.maxRedirects", .text, "Unsigned whole number. Applied before IMA initialization."),
            .init("ImaSettings.enableBackgroundPlayback", .player, "advertisingConfig.beforeInitialization.enableBackgroundPlayback", .boolean),
            .init("ImaSettings.disableNowPlayingInfo", .player, "advertisingConfig.beforeInitialization.disableNowPlayingInfo", .boolean, "Deprecated by the SDK; prefer NowPlayingConfig.isNowPlayingInfoEnabled."),
            .init("ImaSettings.playerVersion", .player, "advertisingConfig.beforeInitialization.playerVersion", .text),
            .init("ImaSettings.sessionId", .player, "advertisingConfig.beforeInitialization.sessionId", .secret, "Optional session identifier. Exported values are redacted."),
        ]
        #if !os(tvOS)
        fields += [
            .init("ImaSettings.sameAppKeyEnabled", .player, "advertisingConfig.beforeInitialization.sameAppKeyEnabled", .boolean),
            .init("ImaAdvertisingConfig.preferredUiType", .player, "advertisingConfig.ima.preferredUiType", .choice(["ima", "disabled"])),
            .init("ImaAdvertisingConfig.shouldPauseOnTap", .player, "advertisingConfig.ima.shouldPauseOnTap", .boolean),
            .init("ImaAdvertisingConfig.adAttributionUiMode", .player, "advertisingConfig.ima.adAttributionUiMode", .choice(["imaDefault", "noAttribution", "attribution", "attributionWithCountdown"])),
        ]
        #endif
        return fields
    }

    static var nativeAdvertisingCallbacks: [AdvancedConfigurationField] {
        [
            .init("AdvertisingConfig.shouldLoadAdItem", .player, "advertisingConfig.shouldLoadAdItem", .script(initial: "return true;"), "input.item contains sources, position, trigger and linearUi. Return true or false. Errors return true."),
            .init("AdvertisingConfig.shouldPlayAdItem", .player, "advertisingConfig.shouldPlayAdItem", .script(initial: "return true;"), "input.item contains the SDK ad item. Return true or false. Errors return true."),
            .init("AdvertisingConfig.shouldPlaySeekedOverAdItems", .player, "advertisingConfig.shouldPlaySeekedOverAdItems", .script(initial: "return input.items.map((item, index) => index);"), "Return indices of input.items in the order to play. The adapter returns those actual SDK objects. Invalid indices or duplicate indices preserve the original list."),
            .init("AdvertisingConfig.beforeInitialization", .player, "advertisingConfig.beforeInitialization", .script(initial: "return input.settings;"), "input.settings contains the actual IMA settings after the individual overrides above. Return a settings object with changed fields. maxRedirects is a decimal string to preserve UInt precision. Invalid output leaves those settings unchanged."),
            .init("AdvertisingConfig.onAdsManagerAvailable", .player, "advertisingConfig.onAdsManagerAvailable", .script(initial: "return {};"), "input.adCuePoints contains the SDK cue points. Return {clicked: true} or {discardAdBreak: true} to invoke those manager actions. The current SDK manager is also available to API operations. Invalid output performs no action."),
            .init("BitmovinAdvertisingConfig.onSelectAdQuality", .player, "advertisingConfig.bitmovin.onSelectAdQuality", .script(initial: "return input.suggestedIndex;"), "input.available contains the SDK media files. Return an array index or null to keep the suggested file. Files include url, delivery, type, width, height, bitrate, minBitrate, maxBitrate and codec. Invalid output keeps the SDK suggestion."),
            .init("VastMacroConfig.valueProvider", .player, "advertisingConfig.bitmovin.macro.valueProvider", .script(initial: "return input.macro.values;"), "input.macro contains name and values; input.scope is requestUri or tracking. Return an array of strings. Invalid output preserves the original values."),
        ]
    }

    static func normalizeAdvertisingValue(_ value: String, id: String) throws -> String {
        if id == "AdvertisingConfig.schedule" {
            _ = try NativeAdItemDraft.parse(value)
            let json = try JSONSerialization.jsonObject(with: Data(value.utf8))
            return String(decoding: try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]), as: UTF8.self)
        }
        if id == "ImaSettings.maxRedirects" {
            guard let value = UInt(value) else { throw ConfigurationValidationError(message: "ImaSettings.maxRedirects needs an unsigned whole number.") }
            return String(value)
        }
        return try normalizeRichValue(value, id: id)
    }

    func applyAdvertisingFields(to config: PlayerConfig) {
        if let schedule = values["AdvertisingConfig.schedule"] {
            config.advertisingConfig.schedule = try! NativeAdItemDraft.parse(schedule).map { $0.make() }
        }
        #if !os(tvOS)
        if let value = values["ImaAdvertisingConfig.preferredUiType"] { config.advertisingConfig.ima.preferredUiType = value == "ima" ? .ima : .disabled }
        if let value = values["ImaAdvertisingConfig.shouldPauseOnTap"] { config.advertisingConfig.ima.shouldPauseOnTap = value == "true" }
        if let value = values["ImaAdvertisingConfig.adAttributionUiMode"] {
            switch value {
            case "noAttribution": config.advertisingConfig.ima.adAttributionUiMode = .noAttribution
            case "attribution": config.advertisingConfig.ima.adAttributionUiMode = .attribution(countdown: false)
            case "attributionWithCountdown": config.advertisingConfig.ima.adAttributionUiMode = .attribution(countdown: true)
            default: config.advertisingConfig.ima.adAttributionUiMode = .imaDefault
            }
        }
        #endif
    }

    func applyAdvertisingCallbacks(to config: AdvertisingConfig, runtime: NativeScriptRuntime, sources: [String: String], journal: NativeCallbackJournal?) {
        let imaValues = values.filter { $0.key.hasPrefix("ImaSettings.") }
        if !imaValues.isEmpty || sources["AdvertisingConfig.beforeInitialization"] != nil {
            config.beforeInitialization = { settings in
                Self.applyImaOverrides(imaValues, to: settings)
                if sources["AdvertisingConfig.beforeInitialization"] != nil {
                    let patch = runtime.call("AdvertisingConfig.beforeInitialization", input: ["settings": Self.imaInput(settings)], fallback: [String: Any]()) { Self.validImaPatch($0) }
                    Self.applyImaPatch(patch, to: settings)
                }
            }
        }
        if sources["AdvertisingConfig.onAdsManagerAvailable"] != nil {
            config.onAdsManagerAvailable = { manager in
                journal?.setAdsManager(manager)
                let actions = runtime.call("AdvertisingConfig.onAdsManagerAvailable", input: ["adCuePoints": manager.adCuePoints], fallback: [String: Bool]()) { output in
                    guard let object = output as? [String: Any], object.keys.allSatisfy({ ["clicked", "discardAdBreak"].contains($0) }) else { return nil }
                    var actions: [String: Bool] = [:]
                    for (key, value) in object { guard let value = NativeScriptRuntime.boolean(value) else { return nil }; actions[key] = value }
                    return actions
                }
                if actions["clicked"] == true { manager.clicked() }
                if actions["discardAdBreak"] == true { manager.discardAdBreak() }
            }
        }
        if sources["AdvertisingConfig.shouldLoadAdItem"] != nil {
            config.shouldLoadAdItem = { item in runtime.call("AdvertisingConfig.shouldLoadAdItem", input: ["item": NativeAdItemDraft.input(item)], fallback: true, convert: NativeScriptRuntime.boolean) }
        }
        if sources["AdvertisingConfig.shouldPlayAdItem"] != nil {
            config.shouldPlayAdItem = { item in runtime.call("AdvertisingConfig.shouldPlayAdItem", input: ["item": NativeAdItemDraft.input(item)], fallback: true, convert: NativeScriptRuntime.boolean) }
        }
        if sources["AdvertisingConfig.shouldPlaySeekedOverAdItems"] != nil {
            config.shouldPlaySeekedOverAdItems = { items in
                runtime.call("AdvertisingConfig.shouldPlaySeekedOverAdItems", input: ["items": items.map(NativeAdItemDraft.input)], fallback: items) { output in
                    guard let values = output as? [Any] else { return nil }
                    var indices = Set<Int>()
                    var selected: [AdItem] = []
                    for value in values {
                        guard let number = NativeScriptRuntime.number(value), let index = Int(exactly: number), items.indices.contains(index), indices.insert(index).inserted else { return nil }
                        selected.append(items[index])
                    }
                    return selected
                }
            }
        }
        if sources["BitmovinAdvertisingConfig.onSelectAdQuality"] != nil {
            config.bitmovin.onSelectAdQuality = { context in
                let input: [String: Any] = ["available": context.available.map(Self.adMediaInput), "suggestedIndex": context.available.firstIndex(where: { $0 === context.suggested }) as Any? ?? NSNull()]
                return runtime.call("BitmovinAdvertisingConfig.onSelectAdQuality", input: input, fallback: context.suggested) { output in
                    guard let output else { return context.suggested }
                    guard let number = NativeScriptRuntime.number(output), let index = Int(exactly: number), context.available.indices.contains(index) else { return nil }
                    return context.available[index]
                }
            }
        }
        if sources["VastMacroConfig.valueProvider"] != nil {
            config.bitmovin.macro.valueProvider = { macro, context in
                runtime.call("VastMacroConfig.valueProvider", input: ["macro": ["name": macro.name, "values": macro.values], "scope": context.scope == .tracking ? "tracking" : "requestUri"], fallback: macro.values, convert: NativeScriptRuntime.strings)
            }
        }
    }

    static func adMediaInput(_ file: AdMediaFile) -> [String: Any] {
        ["url": file.url.absoluteString, "delivery": file.delivery.rawValue, "type": file.type, "width": file.width, "height": file.height,
         "bitrate": file.bitrate as Any? ?? NSNull(), "minBitrate": file.minBitrate as Any? ?? NSNull(), "maxBitrate": file.maxBitrate as Any? ?? NSNull(), "codec": file.codec as Any? ?? NSNull()]
    }

    static func imaInput(_ settings: ImaSettings) -> [String: Any] {
        var input: [String: Any] = ["ppid": settings.ppid as Any? ?? NSNull(), "language": settings.language, "maxRedirects": String(settings.maxRedirects),
            "enableBackgroundPlayback": settings.enableBackgroundPlayback, "disableNowPlayingInfo": settings.disableNowPlayingInfo,
            "playerVersion": settings.playerVersion as Any? ?? NSNull(), "sessionId": settings.sessionId as Any? ?? NSNull()]
        #if !os(tvOS)
        input["sameAppKeyEnabled"] = settings.sameAppKeyEnabled
        #endif
        return input
    }

    static func validImaPatch(_ value: Any?) -> [String: Any]? {
        guard let object = value as? [String: Any] else { return nil }
        var strings = Set(["ppid", "language", "playerVersion", "sessionId"])
        var booleans = Set(["enableBackgroundPlayback", "disableNowPlayingInfo"])
        #if !os(tvOS)
        booleans.insert("sameAppKeyEnabled")
        #endif
        strings.insert("maxRedirects")
        guard object.keys.allSatisfy({ strings.contains($0) || booleans.contains($0) }) else { return nil }
        for (key, value) in object {
            if booleans.contains(key) { guard NativeScriptRuntime.boolean(value) != nil else { return nil } }
            else if key == "maxRedirects" { guard let string = value as? String, UInt(string) != nil else { return nil } }
            else if value is NSNull { guard key != "language" else { return nil } }
            else if !(value is String) { return nil }
        }
        return object
    }

    static func applyImaOverrides(_ values: [String: String], to settings: ImaSettings) {
        var patch: [String: Any] = [:]
        for (id, value) in values {
            let key = String(id.dropFirst("ImaSettings.".count))
            if ["enableBackgroundPlayback", "disableNowPlayingInfo", "sameAppKeyEnabled"].contains(key) { patch[key] = value == "true" }
            else if ["ppid", "sessionId", "playerVersion"].contains(key) { patch[key] = value.isEmpty ? NSNull() : value as Any }
            else { patch[key] = value }
        }
        applyImaPatch(patch, to: settings)
    }

    static func applyImaPatch(_ patch: [String: Any], to settings: ImaSettings) {
        if let value = patch["ppid"] { settings.ppid = value as? String }
        if let value = patch["language"] as? String { settings.language = value }
        if let value = patch["maxRedirects"] as? String, let value = UInt(value) { settings.maxRedirects = value }
        if let value = patch["enableBackgroundPlayback"] as? Bool { settings.enableBackgroundPlayback = value }
        if let value = patch["disableNowPlayingInfo"] as? Bool { settings.disableNowPlayingInfo = value }
        if let value = patch["playerVersion"] { settings.playerVersion = value as? String }
        if let value = patch["sessionId"] { settings.sessionId = value as? String }
        #if !os(tvOS)
        if let value = patch["sameAppKeyEnabled"] as? Bool { settings.sameAppKeyEnabled = value }
        #endif
    }
}
