import Foundation
import AVFoundation
import BitmovinPlayer

extension ApiOperation {
    var callbackArguments: [ApiArgument] {
        switch self {
        case .loggerLog, .consoleLoggerLog:
            return [.init("json", "Log entry", .json(initial: "{\"message\":\"Example message\",\"level\":\"warning\",\"sender\":\"Player Lab\"}"), note: "Fields: message, level, sender, optional integer code, ISO 8601 date and data:{domain,code,message,userInfo}. Uses the current global Logger or the inspector's owned ConsoleLogger.")] + (self == .consoleLoggerLog ? [.init("minimumLevel", "ConsoleLogger minimum level", .choice(["verbose", "info", "warning", "error"]), initial: "warning")] : [])
        case .macroPreview, .interstitialMacroPreview:
            return [.init("name", "Macro name", .text), .init("values", "Macro values", .json(initial: "[]"), note: "An array of strings. The inspector creates the public SDK macro object and calls the currently configured provider.")] + (self == .macroPreview ? [.init("scope", "Macro scope", .choice(["requestUri", "tracking"]))] : [])
        case .trackingRegister, .trackingRegisterMultiple:
            return [.init("trigger", "Tracking trigger", .choice(NativeInterstitialPatch.triggers)), .init("json", "Tracking event objects", .json(initial: "[{\"uris\":[\"https://example.com/tracking\"],\"offset\":null}]"), note: "Uses the actual registry most recently supplied by an interstitial custom mapping callback. No SDK registry is fabricated. The single-event operation registers each entered object individually.")]
        case .trackingQuery:
            return [.init("trigger", "Tracking trigger", .choice(NativeInterstitialPatch.triggers))]
        case .sharePlayBegin:
            return [.init("reason", "Suspension reason", .text, initial: "Player Lab inspection", note: "Creates and retains the actual SDK suspension. End it explicitly, or recreate the player to retire all owned suspensions.")]
        case .sharePlayEnd, .sharePlayEndAt:
            return [.init("index", "Owned suspension index (see state)", .text, initial: "0")] + (self == .sharePlayEndAt ? [.init("time", "Proposed time (seconds)", .number(minimum: 0))] : [])
        #if !os(tvOS)
        case .messageSend, .messageSendWithData:
            return [.init("message", "Message name", .text)] + (self == .messageSendWithData ? [.init("data", "Message data (empty sends nil)", .text)] : [])
        #endif
        default: return televisionArguments + remoteArguments
        }
    }

    func callbackCode(_ values: [String: String]) throws -> String {
        switch self {
        case .loggerLog, .consoleLoggerLog:
            let entry = try NativeLogEntryDraft(values["json"] ?? "{}")
            if self == .loggerLog { return "DebugConfig.logging.logger?.log(\(entry.code))" }
            return "let logger = ConsoleLogger()\nlogger.level = .\(values["minimumLevel"] ?? "warning")\nlogger.log(\(entry.code))"
        case .macroPreview, .interstitialMacroPreview:
            let array = try Self.macroValues(values["values"] ?? "[]")
            let type = self == .macroPreview ? "VastMacro" : "InterstitialMacro"
            let provider = self == .macroPreview ? "player.config.advertisingConfig.bitmovin.macro.valueProvider" : "player.config.interstitialsConfig.macroValueProvider"
            return "let macro = \(type)(name: \(swiftString(values["name"] ?? "")), values: \(Self.swiftStrings(array)))\nlet name = macro.name\nlet values = macro.values\nlet replacements = \(provider)?(macro\(self == .macroPreview ? ", VastMacroContext(scope: ." + (values["scope"] ?? "requestUri") + ")" : ""))"
        case .trackingRegister, .trackingRegisterMultiple:
            let json = values["json"] ?? "[]"
            let patch = try Self.trackingPatch(values)
            guard let first = patch.registrations.first else { throw callbackInvalid("Enter tracking events.") }
            let events = first.events.map { "InterstitialTrackingEvent(uris: \(Self.swiftStrings($0.uris)), offset: \($0.offset.map(String.init(describing:)) ?? "nil"))" }.joined(separator: ", ")
            return "// Use the actual registry supplied by the SDK's interstitial mapping callback.\nlet events = [\(events)]\n" + (self == .trackingRegister ? "for event in events { registry.tracking.register(trackingEvent: event, for: .\(values["trigger"]!)) }" : "registry.tracking.register(trackingEvents: events, for: .\(values["trigger"]!))") + "\n// Validated input: \(json.utf8.count) JSON bytes."
        case .trackingQuery: return "let trackingEvents = registry.tracking.trackingEvents(for: .\(values["trigger"]!))"
        case .sharePlayBegin:
            guard !(values["reason"] ?? "").isEmpty else { throw callbackInvalid("Enter a suspension reason.") }
            return "let suspension = player.sharePlay.beginSuspension(for: AVCoordinatedPlaybackSuspension.Reason(rawValue: \(swiftString(values["reason"]!))))\n// Retain this exact suspension with its player until ending it."
        case .sharePlayEnd, .sharePlayEndAt:
            guard Int(values["index"] ?? "").map({ $0 >= 0 }) == true else { throw callbackInvalid("Enter a nonnegative suspension index.") }
            return "// Use an actual retained suspension from this player.\nplayer.sharePlay.endSuspension(suspension\(self == .sharePlayEndAt ? ", proposingNewTime: " + (values["time"] ?? "0") : ""))"
        #if !os(tvOS)
        case .messageSend: return "webMessageHandler.sendMessage(\(swiftString(values["message"] ?? "")))"
        case .messageSendWithData:
            let data = values["data"] ?? ""
            return "webMessageHandler.sendMessage(\(swiftString(values["message"] ?? "")), withData: \(data.isEmpty ? "nil" : swiftString(data)))"
        #endif
        default: return try remoteCode(values)
        }
    }

    static func macroValues(_ text: String) throws -> [String] {
        guard let values = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String] else { throw ConfigurationValidationError(message: "Macro values require a string array.") }
        return values
    }
    static func trackingPatch(_ values: [String: String]) throws -> NativeInterstitialPatch {
        let events = try JSONSerialization.jsonObject(with: Data((values["json"] ?? "[]").utf8))
        return try NativeInterstitialPatch(["tracking": [["trigger": values["trigger"] ?? "start", "events": events, "registration": "multiple"]]])
    }
    private static func swiftStrings(_ values: [String]) -> String { "[" + values.map(swiftString).joined(separator: ", ") + "]" }
    private func callbackInvalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}

extension PlayerModel {
    @MainActor
    func executeCallbackApi(_ operation: ApiOperation, arguments: [String: String]) throws -> String {
        switch operation {
        case .loggerLog, .consoleLoggerLog:
            let entry = try NativeLogEntryDraft(arguments["json"] ?? "{}").entry
            if operation == .loggerLog {
                guard let logger = DebugConfig.logging.logger else { throw callbackInputError("Enable a global logger in LoggingConfig.logger first.") }
                logger.log(entry)
            } else {
                apiObjects.consoleLogger.level = NativeLoggingOwner.level(arguments["minimumLevel"] ?? "warning")!
                apiObjects.consoleLogger.log(entry)
            }
        case .macroPreview, .interstitialMacroPreview:
            let name = arguments["name"] ?? "", values = try ApiOperation.macroValues(arguments["values"] ?? "[]")
            if operation == .macroPreview {
                let macro = VastMacro(name: name, values: values)
                let context = VastMacroContext(scope: arguments["scope"] == "tracking" ? .tracking : .requestUri)
                let result = player.config.advertisingConfig.bitmovin.macro.valueProvider?(macro, context)
                return "VastMacro.name: \(macro.name); values: \(macro.values); provider result: \(String(describing: result))"
            }
            let macro = InterstitialMacro(name: name, values: values)
            let result = player.config.interstitialsConfig.macroValueProvider?(macro)
            return "InterstitialMacro.name: \(macro.name); values: \(macro.values); provider result: \(String(describing: result))"
        case .trackingRegister, .trackingRegisterMultiple:
            guard let registry = playerCallbackJournal.interstitialRegistry else { throw callbackInputError("Wait for the SDK to supply a registry through an interstitial mapping callback.") }
            let patch = try ApiOperation.trackingPatch(arguments)
            for registration in patch.registrations {
                if operation == .trackingRegister { for event in registration.events { registry.tracking.register(trackingEvent: event, for: registration.trigger) } }
                else { registry.tracking.register(trackingEvents: registration.events, for: registration.trigger) }
            }
        case .trackingQuery:
            guard let registry = playerCallbackJournal.interstitialRegistry, let trigger = NativeInterstitialPatch.trigger(arguments["trigger"] ?? "") else { throw callbackInputError("Wait for an SDK interstitial mapping registry and choose a trigger.") }
            let events = registry.tracking.trackingEvents(for: trigger)
            return events.enumerated().map { "\($0.offset): \($0.element.uris.count) URIs; offset=\($0.element.offset.map(String.init(describing:)) ?? "nil")" }.joined(separator: "\n")
        case .sharePlayBegin:
            guard let reason = arguments["reason"], !reason.isEmpty else { throw callbackInputError("Enter a suspension reason.") }
            let suspension = player.sharePlay.beginSuspension(for: AVCoordinatedPlaybackSuspension.Reason(rawValue: reason))
            apiObjects.sharePlaySuspensions.append(.init(player: player, suspension: suspension))
            return "Retained SDK suspension at index \(apiObjects.sharePlaySuspensions.count - 1)."
        case .sharePlayEnd, .sharePlayEndAt:
            guard let index = Int(arguments["index"] ?? ""), apiObjects.sharePlaySuspensions.indices.contains(index) else { throw callbackInputError("Choose an owned suspension index shown in the API state.") }
            let entry = apiObjects.sharePlaySuspensions[index]
            guard entry.player === player else { throw callbackInputError("This suspension belongs to a retired player.") }
            if operation == .sharePlayEndAt { player.sharePlay.endSuspension(entry.suspension, proposingNewTime: Double(arguments["time"]!)!) }
            else { player.sharePlay.endSuspension(entry.suspension) }
            apiObjects.sharePlaySuspensions.remove(at: index)
        #if !os(tvOS)
        case .messageSend, .messageSendWithData:
            guard let handler = playerCallbackJournal.messageHandler else { throw callbackInputError("Enable BitmovinUserInterfaceConfig.customMessageHandler and apply the player configuration first.") }
            let message = arguments["message"] ?? ""
            if operation == .messageSend { handler.sendMessage(message) }
            else { let data = arguments["data"] ?? ""; handler.sendMessage(message, withData: data.isEmpty ? nil : data) }
        #endif
        default: return try executeRemoteApi(operation, arguments: arguments)
        }
        return operation.rawValue + " invoked. Inspect SDK state and events; invocation does not establish delivery or playback."
    }
    private func callbackInputError(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
