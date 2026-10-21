import Foundation
import BitmovinPlayer

struct NativeInterstitialPatch {
    struct Registration {
        let trigger: InterstitialTrackingEventTrigger
        let events: [InterstitialTrackingEvent]
        let individually: Bool
    }
    let changesClickThrough: Bool
    let clickThrough: URL?
    let registrations: [Registration]

    init(_ value: Any?) throws {
        func invalid() -> ConfigurationValidationError { .init(message: "Return an interstitial mapping object with an optional clickThroughUrl and tracking array.") }
        guard let object = value as? [String: Any] else { throw invalid() }
        changesClickThrough = object.keys.contains("clickThroughUrl")
        if let value = object["clickThroughUrl"], !(value is NSNull) {
            guard let text = value as? String, let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { throw invalid() }
            clickThrough = url
        } else { clickThrough = nil }
        guard object["tracking"] == nil || object["tracking"] is [[String: Any]] else { throw invalid() }
        registrations = try (object["tracking"] as? [[String: Any]] ?? []).map { item in
            guard let name = item["trigger"] as? String, let trigger = Self.trigger(name), let events = item["events"] as? [[String: Any]] else { throw invalid() }
            let parsed = try events.map { event -> InterstitialTrackingEvent in
                guard let uris = event["uris"] as? [String] else { throw invalid() }
                let offset: Double?
                if let value = event["offset"], !(value is NSNull) {
                    guard let number = NativeScriptRuntime.number(value) else { throw invalid() }; offset = number
                } else { offset = nil }
                return InterstitialTrackingEvent(uris: uris, offset: offset)
            }
            let mode = item["registration"] as? String ?? "multiple"
            guard ["single", "multiple"].contains(mode) else { throw invalid() }
            return Registration(trigger: trigger, events: parsed, individually: mode == "single")
        }
    }

    func apply(to registry: any InterstitialCustomAttributesMappingRegistry) {
        if changesClickThrough { registry.clickThroughUrl = clickThrough }
        for registration in registrations {
            if registration.individually {
                for event in registration.events { registry.tracking.register(trackingEvent: event, for: registration.trigger) }
            } else { registry.tracking.register(trackingEvents: registration.events, for: registration.trigger) }
        }
    }

    static func trigger(_ name: String) -> InterstitialTrackingEventTrigger? {
        guard let index = triggers.firstIndex(of: name) else { return nil }
        return InterstitialTrackingEventTrigger(rawValue: index)
    }
    static let triggers = ["mute", "unmute", "pause", "resume", "loaded", "start", "progress", "firstQuartile", "midpoint", "thirdQuartile", "complete", "error", "impression", "clicked", "skip", "viewable", "notViewable", "viewUndetermined"]
}

extension AdvancedConfiguration {
    static var nativeInterstitialFields: [AdvancedConfigurationField] { [
        .init("InterstitialsConfig.customAttributesMapping", .player, "interstitialsConfig.customAttributesMapping", .script(initial: "return {tracking: []};"), "input.customAttributes contains the SDK mapping data. Return {clickThroughUrl: URL or null, tracking: [{trigger: 'start', registration: 'single' or 'multiple', events: [{uris: [URL], offset: seconds or null}]}]}. Omitted fields preserve existing values; an invalid result makes no changes. Tracking triggers: " + NativeInterstitialPatch.triggers.joined(separator: ", ") + "."),
        .init("InterstitialsConfig.macroValueProvider", .player, "interstitialsConfig.macroValueProvider", .script(initial: "return input.values;"), "input.name and input.values describe the SDK macro. Return an array of replacement strings. Errors preserve its values."),
        .init("InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling", .player, "interstitialsConfig.customAttributesMapping", .boolean, "Use the SDK's ad creative signaling mapping preset. An enabled custom mapping script takes precedence."),
    ] }

    func applyInterstitialCallbacks(to config: InterstitialsConfig, runtime: NativeScriptRuntime, sources: [String: String], journal: NativeCallbackJournal?) {
        if values["InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling"] == "true" {
            let preset = InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling
            config.customAttributesMapping = { [weak journal] data, registry in journal?.setInterstitialRegistry(registry); preset(data, registry) }
        }
        if sources["InterstitialsConfig.customAttributesMapping"] != nil {
            config.customAttributesMapping = { [weak journal] data, registry in
                journal?.setInterstitialRegistry(registry)
                let patch = runtime.call("InterstitialsConfig.customAttributesMapping", input: ["customAttributes": data.customAttributes], fallback: Optional<NativeInterstitialPatch>.none) { value -> NativeInterstitialPatch?? in
                    guard let patch = try? NativeInterstitialPatch(value) else { return nil }; return .some(patch)
                }
                patch?.apply(to: registry)
            }
        }
        if sources["InterstitialsConfig.macroValueProvider"] != nil {
            config.macroValueProvider = { macro in
                runtime.call("InterstitialsConfig.macroValueProvider", input: ["name": macro.name, "values": macro.values], fallback: macro.values, convert: NativeScriptRuntime.strings)
            }
        }
    }

    func nativeInterstitialCode(sources: [String: String], name: String) -> [String] {
        guard name == "playerScript" else { return [] }
        var lines: [String] = []
        if values["InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling"] == "true" {
            lines.append("playerConfig.interstitialsConfig.customAttributesMapping = InterstitialsConfig.CustomAttributesMappingPresets.adCreativeSignaling")
        }
        if sources["InterstitialsConfig.customAttributesMapping"] != nil {
            lines += [
                "playerConfig.interstitialsConfig.customAttributesMapping = { data, registry in",
                "    guard let output = \(name)(\"InterstitialsConfig.customAttributesMapping\", [\"customAttributes\": data.customAttributes]) as? [String: Any] else { return }",
                "    let click: URL?",
                "    if let text = output[\"clickThroughUrl\"] as? String {",
                "        guard let url = URL(string: text), [\"http\", \"https\"].contains(url.scheme?.lowercased() ?? \"\"), url.host != nil else { return }; click = url",
                "    } else { guard output[\"clickThroughUrl\"] == nil || output[\"clickThroughUrl\"] is NSNull else { return }; click = nil }",
                "    guard output[\"tracking\"] == nil || output[\"tracking\"] is [[String: Any]] else { return }",
                "    var registrations: [(InterstitialTrackingEventTrigger, [InterstitialTrackingEvent], Bool)] = []",
                "    for item in output[\"tracking\"] as? [[String: Any]] ?? [] {",
                "        let triggerNames = [\"mute\", \"unmute\", \"pause\", \"resume\", \"loaded\", \"start\", \"progress\", \"firstQuartile\", \"midpoint\", \"thirdQuartile\", \"complete\", \"error\", \"impression\", \"clicked\", \"skip\", \"viewable\", \"notViewable\", \"viewUndetermined\"]",
                "        guard let triggerName = item[\"trigger\"] as? String, let index = triggerNames.firstIndex(of: triggerName), let trigger = InterstitialTrackingEventTrigger(rawValue: index), let events = item[\"events\"] as? [[String: Any]] else { return }",
                "        var parsed: [InterstitialTrackingEvent] = []",
                "        for event in events {",
                "            guard let uris = event[\"uris\"] as? [String] else { return }",
                "            var offset: Double?",
                "            if let raw = event[\"offset\"], !(raw is NSNull) { guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return }; offset = number.doubleValue }",
                "            parsed.append(InterstitialTrackingEvent(uris: uris, offset: offset))",
                "        }",
                "        let mode = item[\"registration\"] as? String ?? \"multiple\"; guard [\"single\", \"multiple\"].contains(mode) else { return }",
                "        registrations.append((trigger, parsed, mode == \"single\"))",
                "    }",
                "    if output.keys.contains(\"clickThroughUrl\") { registry.clickThroughUrl = click }",
                "    for (trigger, events, individually) in registrations { if individually { for event in events { registry.tracking.register(trackingEvent: event, for: trigger) } } else { registry.tracking.register(trackingEvents: events, for: trigger) } }",
                "}",
            ]
        }
        if sources["InterstitialsConfig.macroValueProvider"] != nil {
            lines += ["playerConfig.interstitialsConfig.macroValueProvider = { macro in", "    \(name)(\"InterstitialsConfig.macroValueProvider\", [\"name\": macro.name, \"values\": macro.values]) as? [String] ?? macro.values", "}"]
        }
        return lines
    }
}
