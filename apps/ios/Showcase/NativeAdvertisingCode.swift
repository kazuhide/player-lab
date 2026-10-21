import Foundation

extension AdvancedConfiguration {
    var nativeAdvertisingCode: [String] {
        var lines: [String] = []
        if let json = values["AdvertisingConfig.schedule"], let items = try? NativeAdItemDraft.parse(json) {
            for (index, item) in items.enumerated() { lines += item.code(name: "configuredAd\(index)") }
            lines.append("playerConfig.advertisingConfig.schedule = [" + items.indices.map { "configuredAd\($0)" }.joined(separator: ", ") + "]")
        }
        #if !os(tvOS)
        for field in ["preferredUiType", "shouldPauseOnTap"] {
            if let value = values["ImaAdvertisingConfig." + field] {
                lines.append("playerConfig.advertisingConfig.ima.\(field) = \(field == "preferredUiType" ? "." + value : value)")
            }
        }
        if let value = values["ImaAdvertisingConfig.adAttributionUiMode"] {
            let code = value == "attribution" ? ".attribution(countdown: false)" : value == "attributionWithCountdown" ? ".attribution(countdown: true)" : "." + value
            lines.append("playerConfig.advertisingConfig.ima.adAttributionUiMode = \(code)")
        }
        #endif
        if values["AdvertisingConfig.beforeInitialization"] == nil, !imaSettingsCode.isEmpty {
            lines += ["playerConfig.advertisingConfig.beforeInitialization = { settings in"]
            lines += imaSettingsCode.map { "    " + $0 }
            lines.append("}")
        }
        return lines
    }

    var imaSettingsCode: [String] {
        values.keys.filter { $0.hasPrefix("ImaSettings.") }.sorted().map { id in
            let value = values[id]!
            let field = String(id.dropFirst("ImaSettings.".count))
            let code: String
            if ["maxRedirects", "enableBackgroundPlayback", "disableNowPlayingInfo", "sameAppKeyEnabled"].contains(field) { code = value }
            else if ["ppid", "sessionId"].contains(field) { code = value.isEmpty ? "nil" : "\"<LOCAL_IDENTIFIER>\"" }
            else if field == "playerVersion" { code = value.isEmpty ? "nil" : swiftString(value) }
            else { code = swiftString(value) }
            return "settings.\(field) = \(code)"
        }
    }

    func nativeAdvertisingCallbackCode(sources: [String: String], name: String) -> [String] {
        guard sources.keys.contains(where: { $0.hasPrefix("AdvertisingConfig.") || $0.hasPrefix("BitmovinAdvertisingConfig.") || $0.hasPrefix("VastMacroConfig.") }) else { return [] }
        let inputSupport = #"""
        func \#(name)AdInput(_ item: AdItem) -> [String: Any] {
            let trigger: Any
            switch item.trigger {
            case .pre: trigger = "pre"
            case .post: trigger = "post"
            case .percentage(let value): trigger = ["percentage": value]
            case .seconds(let value): trigger = ["seconds": value]
            @unknown default: trigger = "unknown"
            }
            return ["sources": item.sources.map { ["tag": $0.tag.absoluteString, "type": $0.type.rawValue, "vastLoadTimeout": $0.vastLoadTimeout, "videoLoadTimeout": $0.videoLoadTimeout] as [String: Any] },
                "position": item.position as Any? ?? NSNull(), "trigger": trigger,
                "linearUi": ["requestsUi": item.linearAdUiConfig.requestsUi, "message": item.linearAdUiConfig.message as Any? ?? NSNull(), "untilSkippableMessage": item.linearAdUiConfig.untilSkippableMessage as Any? ?? NSNull(), "skippableMessage": item.linearAdUiConfig.skippableMessage as Any? ?? NSNull()]]
        }
        func \#(name)Bool(_ value: Any?) -> Bool? {
            guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
            return number.boolValue
        }
        """#
        var lines = inputSupport.components(separatedBy: "\n")
        for field in ["shouldLoadAdItem", "shouldPlayAdItem"] where sources["AdvertisingConfig." + field] != nil {
            lines += ["playerConfig.advertisingConfig.\(field) = { item in", "    \(name)Bool(\(name)(\"AdvertisingConfig.\(field)\", [\"item\": \(name)AdInput(item)])) ?? true", "}"]
        }
        if sources["AdvertisingConfig.shouldPlaySeekedOverAdItems"] != nil {
            lines += ["playerConfig.advertisingConfig.shouldPlaySeekedOverAdItems = { items in",
                "    guard let output = \(name)(\"AdvertisingConfig.shouldPlaySeekedOverAdItems\", [\"items\": items.map(\(name)AdInput)]) as? [NSNumber] else { return items }",
                "    var indices = Set<Int>(); var selected: [AdItem] = []",
                "    for number in output {",
                "        guard CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, let index = Int(exactly: number.doubleValue), items.indices.contains(index), indices.insert(index).inserted else { return items }",
                "        selected.append(items[index])", "    }", "    return selected", "}"]
        }
        if sources["AdvertisingConfig.beforeInitialization"] != nil {
            lines += ["playerConfig.advertisingConfig.beforeInitialization = { settings in"]
            lines += imaSettingsCode.map { "    " + $0 }
            lines += ["    var input: [String: Any] = [\"ppid\": settings.ppid as Any? ?? NSNull(), \"language\": settings.language, \"maxRedirects\": String(settings.maxRedirects), \"enableBackgroundPlayback\": settings.enableBackgroundPlayback, \"disableNowPlayingInfo\": settings.disableNowPlayingInfo, \"playerVersion\": settings.playerVersion as Any? ?? NSNull(), \"sessionId\": settings.sessionId as Any? ?? NSNull()]"]
            #if !os(tvOS)
            lines.append("    input[\"sameAppKeyEnabled\"] = settings.sameAppKeyEnabled")
            #endif
            lines += ["    guard let output = \(name)(\"AdvertisingConfig.beforeInitialization\", [\"settings\": input]) as? [String: Any] else { return }",
                "    let stringFields = Set([\"ppid\", \"language\", \"playerVersion\", \"sessionId\"])",
                "    let boolFields = Set([\"enableBackgroundPlayback\", \"disableNowPlayingInfo\"\(isIosCode ? ", \"sameAppKeyEnabled\"" : "")])",
                "    for (key, value) in output {",
                "        if boolFields.contains(key) { guard \(name)Bool(value) != nil else { return } }",
                "        else if key == \"maxRedirects\" { guard let value = value as? String, UInt(value) != nil else { return } }",
                "        else if stringFields.contains(key) { guard value is String || (key != \"language\" && value is NSNull) else { return } }",
                "        else { return }", "    }",
                "    if let value = output[\"ppid\"] { settings.ppid = value as? String }",
                "    if let value = output[\"language\"] as? String { settings.language = value }",
                "    if let value = output[\"maxRedirects\"] as? String, let value = UInt(value) { settings.maxRedirects = value }",
                "    if let value = output[\"enableBackgroundPlayback\"] as? Bool { settings.enableBackgroundPlayback = value }",
                "    if let value = output[\"disableNowPlayingInfo\"] as? Bool { settings.disableNowPlayingInfo = value }",
                "    if let value = output[\"playerVersion\"] { settings.playerVersion = value as? String }",
                "    if let value = output[\"sessionId\"] { settings.sessionId = value as? String }"]
            #if !os(tvOS)
            lines.append("    if let value = output[\"sameAppKeyEnabled\"] as? Bool { settings.sameAppKeyEnabled = value }")
            #endif
            lines.append("}")
        }
        if sources["AdvertisingConfig.onAdsManagerAvailable"] != nil {
            lines += ["playerConfig.advertisingConfig.onAdsManagerAvailable = { manager in",
                "    guard let output = \(name)(\"AdvertisingConfig.onAdsManagerAvailable\", [\"adCuePoints\": manager.adCuePoints]) as? [String: Any], output.keys.allSatisfy({ [\"clicked\", \"discardAdBreak\"].contains($0) }), output.values.allSatisfy({ \(name)Bool($0) != nil }) else { return }",
                "    if \(name)Bool(output[\"clicked\"]) == true { manager.clicked() }",
                "    if \(name)Bool(output[\"discardAdBreak\"]) == true { manager.discardAdBreak() }", "}"]
        }
        if sources["BitmovinAdvertisingConfig.onSelectAdQuality"] != nil {
            lines += ["playerConfig.advertisingConfig.bitmovin.onSelectAdQuality = { context in",
                "    let files: [[String: Any]] = context.available.map { [\"url\": $0.url.absoluteString, \"delivery\": $0.delivery.rawValue, \"type\": $0.type, \"width\": $0.width, \"height\": $0.height, \"bitrate\": $0.bitrate as Any? ?? NSNull(), \"minBitrate\": $0.minBitrate as Any? ?? NSNull(), \"maxBitrate\": $0.maxBitrate as Any? ?? NSNull(), \"codec\": $0.codec as Any? ?? NSNull()] }",
                "    guard let number = \(name)(\"BitmovinAdvertisingConfig.onSelectAdQuality\", [\"available\": files, \"suggestedIndex\": context.available.firstIndex(where: { $0 === context.suggested }) as Any? ?? NSNull()]) as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite, let index = Int(exactly: number.doubleValue), context.available.indices.contains(index) else { return context.suggested }",
                "    return context.available[index]", "}"]
        }
        if sources["VastMacroConfig.valueProvider"] != nil {
            lines += ["playerConfig.advertisingConfig.bitmovin.macro.valueProvider = { macro, context in",
                "    \(name)(\"VastMacroConfig.valueProvider\", [\"macro\": [\"name\": macro.name, \"values\": macro.values], \"scope\": context.scope == .tracking ? \"tracking\" : \"requestUri\"]) as? [String] ?? macro.values", "}"]
        }
        return lines
    }

    private var isIosCode: Bool {
        #if os(tvOS)
        return false
        #else
        return true
        #endif
    }
}
