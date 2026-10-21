import Foundation
import BitmovinPlayer
#if os(tvOS)
import UIKit

/// Client-owned markers conform to the SDK's public input protocol.
final class NativeTimelineMarker: NSObject, TimelineMarker, @unchecked Sendable {
    var time: TimeInterval
    var duration: TimeInterval
    init(time: TimeInterval, duration: TimeInterval) { self.time = time; self.duration = duration }
}

enum NativeTVControls {
    static let operations: [String: ApiOperation] = [
        "play": .play, "pause": .pause, "mute": .mute, "unmute": .unmute,
        "seek": .seek, "timeShift": .timeShift, "volume": .volume, "speed": .speed,
        "bitrate": .bitrate, "audio": .audio, "subtitle": .subtitle, "removeSubtitle": .removeSubtitle,
        "bufferTarget": .bufferTarget, "nowPlaying": .nowPlaying, "sourceLatency": .sourceLatency,
        "allowsAirPlay": .allowsAirPlay, "airPlayPicker": .airPlayPicker, "cast": .cast,
        "stopCast": .stopCast, "cancelThumbnails": .cancelThumbnails, "thumbnailMode": .thumbnailMode,
        "skipAd": .advertisingSkip,
    ]

    struct MenuItem {
        let title: String
        let identifier: String?
        let image: String?
        let attributes: UIMenuElement.Attributes
        let state: UIMenuElement.State
        let options: UIMenu.Options
        let operation: ApiOperation?
        let arguments: [String: String]
        let children: [MenuItem]?

        init(_ object: [String: Any], depth: Int = 0) throws {
            guard depth < 16, let title = object["title"] as? String else { throw NativeTVControls.invalid("Menu items require a title and at most 16 nesting levels.") }
            self.title = title
            identifier = try NativeTVControls.optionalString(object, "identifier")
            image = try NativeTVControls.optionalString(object, "systemImage")
            let attributeNames = object["attributes"] as? [String] ?? []
            guard attributeNames.allSatisfy({ ["disabled", "destructive", "hidden"].contains($0) }) else { throw NativeTVControls.invalid("Unknown action attribute.") }
            attributes = attributeNames.reduce(into: UIMenuElement.Attributes()) { result, value in
                result.insert(value == "disabled" ? .disabled : value == "destructive" ? .destructive : .hidden)
            }
            let stateName = object["state"] as? String ?? "off"
            guard ["off", "on", "mixed"].contains(stateName) else { throw NativeTVControls.invalid("State must be off, on or mixed.") }
            state = stateName == "on" ? .on : stateName == "mixed" ? .mixed : .off
            let optionNames = object["options"] as? [String] ?? []
            guard optionNames.allSatisfy({ ["displayInline", "destructive", "singleSelection"].contains($0) }) else { throw NativeTVControls.invalid("Unknown menu option.") }
            options = optionNames.reduce(into: UIMenu.Options()) { result, value in result.insert(value == "displayInline" ? .displayInline : value == "destructive" ? .destructive : .singleSelection) }
            if let children = object["children"] {
                guard let array = children as? [[String: Any]] else { throw NativeTVControls.invalid("Menu children must be an object array.") }
                self.children = try array.map { try MenuItem($0, depth: depth + 1) }
                operation = nil; arguments = [:]
            } else {
                children = nil
                if let name = object["operation"] {
                    guard let name = name as? String, let selected = NativeTVControls.operations[name] else { throw NativeTVControls.invalid("Unknown menu operation.") }
                    operation = selected
                    guard object["arguments"] == nil || object["arguments"] is [String: String] else { throw NativeTVControls.invalid("Action arguments must be a string dictionary.") }
                    arguments = try selected.validated(object["arguments"] as? [String: String] ?? [:])
                } else { operation = nil; arguments = [:] }
            }
        }

        func make(journal: NativeCallbackJournal?) -> UIMenuElement {
            if let children {
                return UIMenu(title: title, image: image.flatMap(UIImage.init(systemName:)), identifier: identifier.map(UIMenu.Identifier.init(rawValue:)), options: options, children: children.map { $0.make(journal: journal) })
            }
            return UIAction(title: title, image: image.flatMap(UIImage.init(systemName:)), identifier: identifier.map(UIAction.Identifier.init(rawValue:)), attributes: attributes, state: state) { [weak journal] _ in
                guard let operation, let model = journal?.model else { return }
                do { try model.executeApi(operation, arguments: arguments); journal?.record("SystemUiApi.action") }
                catch { journal?.record("SystemUiApi.action", failure: "The configured SDK operation rejected its current execution context.") }
            }
        }

        func code() throws -> String {
            let image = image.map { "UIImage(systemName: \(swiftString($0)))" } ?? "nil"
            let identifier = identifier.map { swiftString($0) }
            if let children {
                return "UIMenu(title: \(swiftString(title)), image: \(image), identifier: \(identifier.map { "UIMenu.Identifier(rawValue: \($0))" } ?? "nil"), options: UIMenu.Options(rawValue: \(options.rawValue)), children: [\(try children.map { try $0.code() }.joined(separator: ", "))])"
            }
            let actionCode = try operation?.code(arguments: arguments) ?? "// No player operation assigned."
            return "UIAction(title: \(swiftString(title)), image: \(image), identifier: \(identifier.map { "UIAction.Identifier(rawValue: \($0))" } ?? "nil"), attributes: UIMenuElement.Attributes(rawValue: \(attributes.rawValue)), state: UIMenuElement.State(rawValue: \(state.rawValue))!) { _ in\n    guard let player = menuPlayerReference.player else { return }\n    \(actionCode.replacingOccurrences(of: "\n", with: "\n    "))\n}"
        }
    }

    static func menu(_ json: String) throws -> [MenuItem] {
        guard let items = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else { throw invalid("Menu input requires an object array.") }
        return try items.map { try MenuItem($0) }
    }
    static func markers(_ json: String) throws -> [NativeTimelineMarker] {
        guard let items = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else { throw invalid("Markers require an object array.") }
        return try items.map {
            guard let time = NativeScriptRuntime.number($0["time"]), let duration = NativeScriptRuntime.number($0["duration"]), time >= 0, duration >= 0 else { throw invalid("Marker time and duration must be finite nonnegative seconds.") }
            return NativeTimelineMarker(time: time, duration: duration)
        }
    }
    static func infoControllers(_ json: String) throws -> [UIViewController] {
        guard let items = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: String]] else { throw invalid("Info controllers require an array of {title, text} string dictionaries.") }
        return try items.map { item in
            guard let title = item["title"], let text = item["text"] else { throw invalid("An info controller requires title and text.") }
            let controller = UIViewController(); controller.title = title
            controller.view.backgroundColor = .black
            let label = UILabel(); label.text = text; label.numberOfLines = 0; label.textColor = .white; label.font = .preferredFont(forTextStyle: .body)
            controller.view.addSubview(label); label.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: 40), label.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -40), label.topAnchor.constraint(equalTo: controller.view.topAnchor, constant: 20), label.bottomAnchor.constraint(lessThanOrEqualTo: controller.view.bottomAnchor, constant: -20)])
            controller.preferredContentSize = CGSize(width: 800, height: 240)
            return controller
        }
    }
    private static func optionalString(_ object: [String: Any], _ key: String) throws -> String? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        guard let value = value as? String else { throw invalid("\(key) must be a string or null.") }; return value
    }
    private static func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
#endif

extension AdvancedConfiguration {
    static var nativeTVFields: [AdvancedConfigurationField] {
        #if os(tvOS)
        return [
            .init("SourceConfig.markers", .source, "markers", .json(initial: "[]"), "An array of {time, duration}, in seconds. These are client-owned objects conforming to the public TimelineMarker protocol."),
            .init("SystemUserInterfaceConfig.transportBarCustomMenuItems", .player, "styleConfig.userInterfaceConfig.transportBarCustomMenuItems", .json(initial: "[]"), "An array of native menu/action objects: {title, systemImage?, identifier?, children?}. An action may set attributes, state, operation and arguments. Supported operation names: " + NativeTVControls.operations.keys.sorted().joined(separator: ", ") + ". Arguments match the API inspector and use string values."),
        ]
        #else
        return []
        #endif
    }
    func validateNativeTVFields() throws {
        #if os(tvOS)
        if let value = values["SourceConfig.markers"] { _ = try NativeTVControls.markers(value) }
        if let value = values["SystemUserInterfaceConfig.transportBarCustomMenuItems"] { _ = try NativeTVControls.menu(value) }
        #endif
    }
    func applyNativeTVSource(to config: SourceConfig) {
        #if os(tvOS)
        if let value = values["SourceConfig.markers"] { config.markers = try! NativeTVControls.markers(value) }
        #endif
    }
    func applyNativeTVUI(to config: PlayerConfig, journal: NativeCallbackJournal?) {
        #if os(tvOS)
        if let value = values["SystemUserInterfaceConfig.transportBarCustomMenuItems"], let ui = config.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig {
            ui.transportBarCustomMenuItems = try! NativeTVControls.menu(value).map { $0.make(journal: journal) }
        }
        #endif
    }
    var nativeTVCode: [String] {
        #if os(tvOS)
        var result: [String] = []
        if let value = values["SourceConfig.markers"] {
            let markers = try! NativeTVControls.markers(value)
            result += ["final class ExampleTimelineMarker: NSObject, TimelineMarker, @unchecked Sendable { var time: TimeInterval; var duration: TimeInterval; init(time: TimeInterval, duration: TimeInterval) { self.time = time; self.duration = duration } }", "sourceConfig.markers = [\(markers.map { "ExampleTimelineMarker(time: \($0.time), duration: \($0.duration))" }.joined(separator: ", "))]"]
        }
        if let value = values["SystemUserInterfaceConfig.transportBarCustomMenuItems"] {
            result += ["final class ExampleMenuPlayerReference { weak var player: Player? }", "let menuPlayerReference = ExampleMenuPlayerReference()", "systemUiConfig.transportBarCustomMenuItems = [\(try! NativeTVControls.menu(value).map { try $0.code() }.joined(separator: ", "))]"]
        }
        return result
        #else
        return []
        #endif
    }
}
