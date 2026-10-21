import Foundation
import BitmovinPlayer

extension AdvancedConfiguration {
    static var nativeUiCallbackFields: [AdvancedConfigurationField] {
        var fields: [AdvancedConfigurationField] = [
            .init("PictureInPictureConfig.restoreUserInterfaceHandler-swift.property", .view, "pictureInPictureConfig.restoreUserInterfaceHandler", .script(initial: "return false;"), "Return a boolean for the SDK completion handler. Return true only after restoring the app's player interface. A script error completes with false, exactly once."),
        ]
        #if os(tvOS)
        fields.append(.init("SystemUserInterfaceConfig.timeToSeekAfterUserSeeked", .player, "styleConfig.userInterfaceConfig.timeToSeekAfterUserSeeked", .script(initial: "return input.targetTime;"), "input.oldTime and input.targetTime are seconds. Return the finite target position. Errors preserve targetTime."))
        #else
        fields += [
            .init("BitmovinUserInterfaceConfig.customMessageHandler", .player, "styleConfig.userInterfaceConfig.customMessageHandler", .boolean, "Creates a native CustomMessageHandler. The API inspector sends messages through this same instance; a custom Web UI can deliver messages back to the delegate."),
            .init("CustomMessageHandler.receivedSynchronousMessage", .player, "customMessageHandler.delegate.receivedSynchronousMessage", .script(initial: "return input.data;"), "input.message and input.data contain the Web UI message. Return a string or null. Errors return nil. Enable BitmovinUserInterfaceConfig.customMessageHandler first."),
            .init("CustomMessageHandler.receivedAsynchronousMessage", .player, "customMessageHandler.delegate.receivedAsynchronousMessage", .script(initial: "storage.lastMessage = input.message;"), "input.message and input.data contain the Web UI message. The return value is ignored. Enable BitmovinUserInterfaceConfig.customMessageHandler first."),
        ]
        #endif
        return fields
    }

    func applyNativeViewCallbacks(to config: PlayerViewConfig, journal: NativeCallbackJournal?) {
        let id = "PictureInPictureConfig.restoreUserInterfaceHandler-swift.property"
        guard let body = values[id] else { return }
        let runtime = journal?.runtime(sources: [id: body], owner: "view") ?? NativeScriptRuntime(sources: [id: body])
        config.pictureInPictureConfig.restoreUserInterfaceHandler = { completion in
            completion(runtime.call(id, input: [:], fallback: false, convert: NativeScriptRuntime.boolean))
        }
    }

    func applyNativeUiCallbacks(to config: PlayerConfig, journal: NativeCallbackJournal?) {
        let sources = callbackSources(owner: .player)
        let runtime = journal?.runtime(sources: sources, owner: "player") ?? NativeScriptRuntime(sources: sources)
        #if os(tvOS)
        let id = "SystemUserInterfaceConfig.timeToSeekAfterUserSeeked"
        if sources[id] != nil, let ui = config.styleConfig.userInterfaceConfig as? SystemUserInterfaceConfig {
            ui.timeToSeekAfterUserSeeked = { old, target in
                runtime.call(id, input: ["oldTime": old, "targetTime": target], fallback: target, convert: NativeScriptRuntime.number)
            }
        }
        #else
        if values["BitmovinUserInterfaceConfig.customMessageHandler"] == "true" {
            let ui = config.styleConfig.userInterfaceConfig as? BitmovinUserInterfaceConfig ?? BitmovinUserInterfaceConfig()
            let handler = CustomMessageHandler()
            let delegate = NativeWebMessageDelegate(runtime: runtime, configured: Set(sources.keys))
            handler.delegate = delegate
            // The SDK delegate is weak. Retain it for the lifetime of this exact handler.
            objc_setAssociatedObject(handler, &NativeWebMessageDelegate.retentionKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            ui.customMessageHandler = handler
            config.styleConfig.userInterfaceConfig = ui
            journal?.setMessageHandler(handler)
        }
        #endif
    }

    func nativeUiCallbackCode(sources: [String: String], name: String) -> [String] {
        var lines: [String] = []
        let restore = "PictureInPictureConfig.restoreUserInterfaceHandler-swift.property"
        if sources[restore] != nil {
            lines += ["playerViewConfig.pictureInPictureConfig.restoreUserInterfaceHandler = { completion in", "    let value = \(name)(\(swiftString(restore)), [:]) as? NSNumber", "    completion(value.map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false)", "}"]
        }
        #if os(tvOS)
        let seek = "SystemUserInterfaceConfig.timeToSeekAfterUserSeeked"
        if sources[seek] != nil {
            lines += ["systemUiConfig.timeToSeekAfterUserSeeked = { old, target in", "    let value = \(name)(\(swiftString(seek)), [\"oldTime\": old, \"targetTime\": target]) as? NSNumber", "    guard let value, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return target }", "    return value.doubleValue", "}"]
        }
        #else
        if values["BitmovinUserInterfaceConfig.customMessageHandler"] == "true", name == "playerScript" {
            lines += ["final class ExampleWebMessageDelegate: NSObject, CustomMessageHandlerDelegate {", "    let call: (String, [String: Any]) -> Any?", "    init(call: @escaping (String, [String: Any]) -> Any?) { self.call = call }", "    func receivedSynchronousMessage(_ message: String, withData data: String?) -> String? {", "        call(\"CustomMessageHandler.receivedSynchronousMessage\", [\"message\": message, \"data\": data as Any? ?? NSNull()]) as? String", "    }", "    func receivedAsynchronousMessage(_ message: String, withData data: String?) {", "        _ = call(\"CustomMessageHandler.receivedAsynchronousMessage\", [\"message\": message, \"data\": data as Any? ?? NSNull()])", "    }", "}", "let webMessageHandler = CustomMessageHandler()", "// Keep the delegate alive; CustomMessageHandler.delegate is weak.", "let webMessageDelegate = ExampleWebMessageDelegate(call: \(name))", "webMessageHandler.delegate = webMessageDelegate", "webUiConfig.customMessageHandler = webMessageHandler"]
        }
        #endif
        return lines
    }
}

#if !os(tvOS)
import ObjectiveC

private final class NativeWebMessageDelegate: NSObject, CustomMessageHandlerDelegate {
    static var retentionKey: UInt8 = 0
    let runtime: NativeScriptRuntime
    let configured: Set<String>
    init(runtime: NativeScriptRuntime, configured: Set<String>) { self.runtime = runtime; self.configured = configured }
    func receivedSynchronousMessage(_ message: String, withData data: String?) -> String? {
        guard configured.contains("CustomMessageHandler.receivedSynchronousMessage") else { return nil }
        return runtime.call("CustomMessageHandler.receivedSynchronousMessage", input: ["message": message, "data": data as Any? ?? NSNull()], fallback: Optional<String>.none) { value -> String?? in
            if value == nil { return .some(nil) }
            return (value as? String).map { .some($0) }
        }
    }
    func receivedAsynchronousMessage(_ message: String, withData data: String?) {
        guard configured.contains("CustomMessageHandler.receivedAsynchronousMessage") else { return }
        runtime.call("CustomMessageHandler.receivedAsynchronousMessage", input: ["message": message, "data": data as Any? ?? NSNull()], fallback: ()) { _ in () }
    }
}
#endif
