import Foundation
import BitmovinPlayer

/// JSON is decoded into public SDK constructors; arbitrary dictionaries never reach AdvertisingConfig.
struct NativeAdItemDraft {
    struct Source {
        let tag: URL
        let type: AdSourceType
        let typeCode: String
        let vastTimeout: TimeInterval
        let videoTimeout: TimeInterval
    }
    let sources: [Source]
    let position: String?
    let trigger: AdItemTrigger
    let triggerCode: String
    let requestsUi: Bool?
    let message: String?
    let untilSkippableMessage: String?
    let skippableMessage: String?

    static func parse(_ text: String) throws -> [NativeAdItemDraft] {
        guard let array = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]] else {
            throw invalid("AdvertisingConfig.schedule must be a JSON array of ad items.")
        }
        return try array.map(Self.init)
    }

    init(_ object: [String: Any]) throws {
        try Self.checkKeys(object, allowed: ["sources", "position", "trigger", "linearUi"])
        guard let sourceObjects = object["sources"] as? [[String: Any]], !sourceObjects.isEmpty else { throw Self.invalid("Each ad item needs a nonempty sources array.") }
        sources = try sourceObjects.map { source in
            try Self.checkKeys(source, allowed: ["tag", "type", "vastLoadTimeout", "videoLoadTimeout"])
            guard let rawUrl = source["tag"] as? String, let tag = URL(string: rawUrl), ["http", "https"].contains(tag.scheme?.lowercased() ?? ""), tag.host != nil else { throw Self.invalid("AdSource.tag needs an absolute HTTP or HTTPS URL.") }
            guard source["type"] == nil || source["type"] is String else { throw Self.invalid("AdSource.type needs an enum name string.") }
            let code = source["type"] as? String ?? "ima"
            let type: AdSourceType
            switch code {
            case "none": type = .none
            case "ima": type = .ima
            case "unknown": type = .unknown
            case "progressive": type = .progressive
            case "bitmovin": type = .bitmovin
            default: throw Self.invalid("AdSource.type must be none, ima, unknown, progressive or bitmovin.")
            }
            let vast = try Self.duration(source["vastLoadTimeout"], fallback: AdSource.DefaultValues.vastLoadTimeout)
            let video = try Self.duration(source["videoLoadTimeout"], fallback: AdSource.DefaultValues.videoLoadTimeout)
            return Source(tag: tag, type: type, typeCode: code, vastTimeout: vast, videoTimeout: video)
        }
        if object["position"] != nil && object["trigger"] != nil { throw Self.invalid("Choose position or trigger for each ad item, not both.") }
        if let rawPosition = object["position"] {
            guard let value = rawPosition as? String, value == "pre" || value == "post" || value.range(of: #"^\d+(\.\d+)?%?$"#, options: .regularExpression) != nil else { throw Self.invalid("AdItem.position needs pre, post, seconds or a percentage string.") }
            if value != "pre", value != "post" {
                let percentage = value.hasSuffix("%")
                guard let number = Double(percentage ? String(value.dropLast()) : value), number.isFinite,
                      !percentage || (0...100).contains(number) else { throw Self.invalid("AdItem.position must have finite seconds or a percentage from 0 to 100.") }
            }
            position = value
            trigger = .pre
            triggerCode = ".pre"
        } else {
            position = nil
            if let object = object["trigger"] as? [String: Any], object.count == 1 {
                if let seconds = NativeScriptRuntime.number(object["seconds"]), seconds >= 0 {
                    trigger = .seconds(seconds); triggerCode = ".seconds(\(seconds))"
                } else if let percentage = NativeScriptRuntime.number(object["percentage"]), let integer = Int(exactly: percentage), (0...100).contains(integer) {
                    trigger = .percentage(integer); triggerCode = ".percentage(\(integer))"
                } else { throw Self.invalid("AdItem.trigger needs nonnegative seconds or an integer percentage from 0 to 100.") }
            } else {
                let code = object["trigger"] as? String ?? "pre"
                guard object["trigger"] == nil || object["trigger"] is String else { throw Self.invalid("AdItem.trigger must be pre, post, {seconds: number} or {percentage: integer}.") }
                switch code {
                case "pre": trigger = .pre; triggerCode = ".pre"
                case "post": trigger = .post; triggerCode = ".post"
                default: throw Self.invalid("AdItem.trigger must be pre, post, {seconds: number} or {percentage: integer}.")
                }
            }
        }
        let ui: [String: Any]
        if let value = object["linearUi"] {
            guard let dictionary = value as? [String: Any] else { throw Self.invalid("AdItem.linearUi needs a JSON object.") }
            ui = dictionary
        } else { ui = [:] }
        try Self.checkKeys(ui, allowed: ["requestsUi", "message", "untilSkippableMessage", "skippableMessage"])
        if let value = ui["requestsUi"] {
            guard let value = NativeScriptRuntime.boolean(value) else { throw Self.invalid("LinearAdUiConfig.requestsUi needs true or false.") }
            requestsUi = value
        } else { requestsUi = nil }
        message = try Self.optionalString(ui, "message")
        untilSkippableMessage = try Self.optionalString(ui, "untilSkippableMessage")
        skippableMessage = try Self.optionalString(ui, "skippableMessage")
    }

    func make() -> AdItem {
        let sources = sources.map { AdSource(tag: $0.tag, ofType: $0.type, vastLoadTimeout: $0.vastTimeout, videoLoadTimeout: $0.videoTimeout) }
        let item = position.map { AdItem(adSources: sources, atPosition: $0) } ?? AdItem(adSources: sources, trigger: trigger)
        if let requestsUi { item.linearAdUiConfig.requestsUi = requestsUi }
        if let message { item.linearAdUiConfig.message = message }
        if let untilSkippableMessage { item.linearAdUiConfig.untilSkippableMessage = untilSkippableMessage }
        if let skippableMessage { item.linearAdUiConfig.skippableMessage = skippableMessage }
        return item
    }

    func code(name: String) -> [String] {
        let sourceCode = sources.map { "AdSource(tag: URL(string: \(swiftString($0.tag.absoluteString)))!, ofType: .\($0.typeCode), vastLoadTimeout: \($0.vastTimeout), videoLoadTimeout: \($0.videoTimeout))" }.joined(separator: ", ")
        let arguments = position.map { "atPosition: \(swiftString($0))" } ?? "trigger: \(triggerCode)"
        var lines = ["let \(name) = AdItem(adSources: [\(sourceCode)], \(arguments))"]
        if let requestsUi { lines.append("\(name).linearAdUiConfig.requestsUi = \(requestsUi)") }
        for (field, value) in [("message", message), ("untilSkippableMessage", untilSkippableMessage), ("skippableMessage", skippableMessage)] {
            if let value { lines.append("\(name).linearAdUiConfig.\(field) = \(swiftString(value))") }
        }
        return lines
    }

    static func input(_ item: AdItem) -> [String: Any] {
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
            "linearUi": ["requestsUi": item.linearAdUiConfig.requestsUi, "message": item.linearAdUiConfig.message as Any? ?? NSNull(),
                "untilSkippableMessage": item.linearAdUiConfig.untilSkippableMessage as Any? ?? NSNull(), "skippableMessage": item.linearAdUiConfig.skippableMessage as Any? ?? NSNull()]]
    }

    private static func checkKeys(_ object: [String: Any], allowed: Set<String>) throws {
        guard object.keys.allSatisfy(allowed.contains) else { throw invalid("Unknown ad schedule field. Use sources, position/trigger and linearUi with the documented child fields.") }
    }
    private static func duration(_ value: Any?, fallback: Double) throws -> Double {
        guard let value else { return fallback }
        guard let value = NativeScriptRuntime.number(value), value >= 0 else { throw invalid("AdSource timeouts must be finite nonnegative seconds.") }
        return value
    }
    private static func optionalString(_ object: [String: Any], _ key: String) throws -> String? {
        guard let value = object[key] else { return nil }
        if value is NSNull { return nil }
        guard let value = value as? String else { throw invalid("LinearAdUiConfig text fields need strings or null.") }
        return value
    }
    private static func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
