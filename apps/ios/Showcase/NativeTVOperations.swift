import Foundation
import BitmovinPlayer

extension ApiOperation {
    var televisionArguments: [ApiArgument] {
        #if os(tvOS)
        switch self {
        case .tvMenu, .tvContextActions, .tvInfoActions:
            return [.init("json", "Native menu/action objects", .json(initial: "[]"), note: "Uses the same native factory as SystemUserInterfaceConfig.transportBarCustomMenuItems. Contextual and info actions accept action objects only; nested menus are supported by transport bar menus.")]
        case .tvInfoControllers:
            return [.init("json", "Info view controllers", .json(initial: "[{\"title\":\"Source\",\"text\":\"Custom source information\"}]"), note: "Each {title, text} creates a real native UIViewController with a readable multiline label.")]
        case .tvMarkers:
            return [.init("json", "Timeline markers", .json(initial: "[{\"time\":5,\"duration\":10}]"), note: "Updates Source.markers with native objects conforming to the public TimelineMarker input protocol.")]
        default: return []
        }
        #else
        return []
        #endif
    }

    func televisionCode(_ values: [String: String]) throws -> String {
        #if os(tvOS)
        let json = values["json"] ?? "[]"
        switch self {
        case .tvMenu, .tvContextActions, .tvInfoActions:
            let items = try NativeTVControls.menu(json)
            if self != .tvMenu, items.contains(where: { $0.children != nil }) { throw ConfigurationValidationError(message: "This SDK property accepts UIAction objects, not nested menus.") }
            let property = self == .tvMenu ? "transportBarCustomMenuItems" : self == .tvContextActions ? "contextualActions" : "infoViewActions"
            return "final class RuntimeMenuPlayerReference { weak var player: Player? }\nlet menuPlayerReference = RuntimeMenuPlayerReference()\nmenuPlayerReference.player = player\nplayerView.systemUi?.\(property) = [\(try items.map { try $0.code() }.joined(separator: ", "))]"
        case .tvMarkers:
            let markers = try NativeTVControls.markers(json)
            return "final class RuntimeTimelineMarker: NSObject, TimelineMarker, @unchecked Sendable { var time: TimeInterval; var duration: TimeInterval; init(time: TimeInterval, duration: TimeInterval) { self.time = time; self.duration = duration } }\nplayer.source?.markers = [\(markers.map { "RuntimeTimelineMarker(time: \($0.time), duration: \($0.duration))" }.joined(separator: ", "))]"
        case .tvInfoControllers:
            _ = try NativeTVControls.infoControllers(json)
            return "let descriptions = try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8)) as! [[String: String]]\nplayerView.systemUi?.customInfoViewControllers = descriptions.map { item in\n    let controller = UIViewController(); controller.title = item[\"title\"]\n    controller.view.backgroundColor = .black\n    let label = UILabel(); label.text = item[\"text\"]; label.textColor = .white; label.numberOfLines = 0; label.frame = CGRect(x: 40, y: 20, width: 720, height: 200)\n    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]; controller.view.addSubview(label)\n    controller.preferredContentSize = CGSize(width: 800, height: 240)\n    return controller\n}"
        default: break
        }
        #endif
        throw ConfigurationValidationError(message: "This operation has no television implementation.")
    }
}

extension PlayerModel {
    @MainActor
    func executeTelevisionApi(_ operation: ApiOperation, arguments: [String: String]) throws -> String {
        #if os(tvOS)
        let json = arguments["json"] ?? "[]"
        if operation == .tvMarkers {
            guard let source = player.source else { throw ConfigurationValidationError(message: "Load a source first.") }
            source.markers = try NativeTVControls.markers(json)
            return "Source.markers updated with \(source.markers.count) native timeline markers."
        }
        guard let ui = try requireApiView().systemUi else { throw ConfigurationValidationError(message: "Select the System UI engine and use the native PlayerView host first.") }
        switch operation {
        case .tvMenu: ui.transportBarCustomMenuItems = try NativeTVControls.menu(json).map { $0.make(journal: playerCallbackJournal) }
        case .tvContextActions, .tvInfoActions:
            let items = try NativeTVControls.menu(json)
            guard items.allSatisfy({ $0.children == nil }) else { throw ConfigurationValidationError(message: "This SDK property accepts actions, not nested menus.") }
            let actions = items.map { $0.make(journal: playerCallbackJournal) as! UIAction }
            if operation == .tvContextActions { ui.contextualActions = actions } else { ui.infoViewActions = actions }
        case .tvInfoControllers: ui.customInfoViewControllers = try NativeTVControls.infoControllers(json)
        default: throw ConfigurationValidationError(message: "This operation has no television implementation.")
        }
        return operation.rawValue + " updated on the actual SDK SystemUiApi. Open the native controls to inspect presentation."
        #else
        throw ConfigurationValidationError(message: "This operation is available on tvOS.")
        #endif
    }
}

#if os(tvOS)
import UIKit
#endif
