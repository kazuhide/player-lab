import Foundation
import BitmovinPlayer

final class NativeGuiLogger: NSObject, Logger, @unchecked Sendable {
    private let lock = NSLock()
    private var minimum = LogLevel.warning
    private var count = 0
    private var recent: [String] = []
    let runtime: NativeScriptRuntime
    init(runtime: NativeScriptRuntime) { self.runtime = runtime }
    var level: LogLevel {
        get { lock.lock(); defer { lock.unlock() }; return minimum }
        set { lock.lock(); defer { lock.unlock() }; minimum = newValue }
    }
    func log(_ entry: LogEntry) {
        lock.lock()
        guard entry.level.rawValue >= minimum.rawValue else { lock.unlock(); return }
        count += 1
        recent.insert("level=\(entry.level.rawValue); code=\(entry.code.map(String.init) ?? "nil"); messageBytes=\(entry.message.utf8.count); senderBytes=\(entry.sender.utf8.count)", at: 0)
        if recent.count > 80 { recent.removeLast(recent.count - 80) }
        lock.unlock()
        runtime.call("Logger.customLog", input: ["message": entry.message, "level": entry.level.rawValue, "code": entry.code as Any? ?? NSNull(), "sender": entry.sender, "date": ISO8601DateFormatter().string(from: entry.currentDate), "data": entry.data.map { ["code": $0.code, "message": $0.message] } as Any? ?? NSNull()], fallback: ()) { _ in () }
    }
    var summary: String { lock.lock(); defer { lock.unlock() }; return "\(count) entries; payload text is not retained.\n" + recent.joined(separator: "\n") }
}

enum NativeLoggingOwner {
    private static let lock = NSRecursiveLock()
    private static var capturedDefault = false
    private static var original: Logger?
    private static var originalLevel: LogLevel?

    static func apply(_ advanced: AdvancedConfiguration, journal: NativeCallbackJournal?) {
        lock.lock(); defer { lock.unlock() }
        if !capturedDefault { original = DebugConfig.logging.logger; originalLevel = original?.level; capturedDefault = true }
        let logging = DebugConfig.logging
        switch advanced.values["LoggingConfig.logger"] {
        case "disabled": logging.logger = nil
        case "console": logging.logger = ConsoleLogger()
        case "javascript":
            let sources = advanced.callbackSources(owner: .player)
            let runtime = journal?.runtime(sources: sources, owner: "player") ?? NativeScriptRuntime(sources: sources)
            logging.logger = NativeGuiLogger(runtime: runtime)
        default:
            logging.logger = original
            if let originalLevel { original?.level = originalLevel }
        }
        if let name = advanced.values["Logger.level"], let level = level(name) { logging.logger?.level = level }
        if let name = advanced.values["ConsoleLogger.level"], let level = level(name), let logger = logging.logger as? ConsoleLogger { logger.level = level }
        DebugConfig.logging = logging
    }
    static func level(_ name: String) -> LogLevel? {
        switch name { case "verbose": return .verbose; case "info": return .info; case "warning": return .warning; case "error": return .error; default: return nil }
    }
}

struct NativeLogEntryDraft {
    let entry: LogEntry
    let code: String
    init(_ json: String) throws {
        func invalid() -> ConfigurationValidationError { .init(message: "A log entry requires message, sender and level; code and date are optional, and data may describe an NSError.") }
        guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any], let message = object["message"] as? String, let sender = object["sender"] as? String, let name = object["level"] as? String, let level = NativeLoggingOwner.level(name) else { throw invalid() }
        let number: Int?
        if let value = object["code"], !(value is NSNull) { guard let integer = Self.integer(value) else { throw invalid() }; number = integer } else { number = nil }
        let date: Date
        let dateCode: String
        if let text = object["date"] {
            guard let text = text as? String, let parsed = ISO8601DateFormatter().date(from: text) else { throw invalid() }; date = parsed; dateCode = "ISO8601DateFormatter().date(from: \(swiftString(text)))!"
        } else { date = Date(); dateCode = "Date()" }
        let data: DeficiencyData?
        let dataCode: String
        if let value = object["data"], !(value is NSNull) {
            guard let value = value as? [String: Any], let domain = value["domain"] as? String, let code = Self.integer(value["code"]), let description = value["message"] as? String else { throw invalid() }
            var info = value["userInfo"] as? [String: Any] ?? [:]
            if value["userInfo"] != nil, !(value["userInfo"] is [String: Any]) { throw invalid() }
            info[NSLocalizedDescriptionKey] = description
            data = DeficiencyData(error: NSError(domain: domain, code: code, userInfo: info))
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]), as: UTF8.self)
            dataCode = "DeficiencyData(error: NSError(domain: \(swiftString(domain)), code: \(code), userInfo: try! JSONSerialization.jsonObject(with: Data(\(swiftString(encoded)).utf8)) as! [String: Any]))"
        } else { data = nil; dataCode = "nil" }
        entry = LogEntry(message: message, level: level, code: number, sender: sender, data: data, currentDate: date)
        code = "LogEntry(message: \(swiftString(message)), level: .\(name), code: \(number.map(String.init) ?? "nil"), sender: \(swiftString(sender)), data: \(dataCode), currentDate: \(dateCode))"
    }
    private static func integer(_ value: Any?) -> Int? {
        if let text = value as? String { return Int(text) }
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        if let value = Int(number.stringValue) { return value }
        return Int(exactly: number.doubleValue)
    }
}

extension AdvancedConfiguration {
    static var nativeLoggingFields: [AdvancedConfigurationField] { [
        .init("LoggingConfig.logger", .player, "DebugConfig.logging.logger", .choice(["disabled", "console", "javascript"]), "Global SDK logging. Disabled assigns nil; console uses ConsoleLogger; javascript uses a client Logger with an editable function body. Removing this override restores the logger captured at app startup."),
        .init("Logger.level", .player, "DebugConfig.logging.logger.level", .choice(["verbose", "info", "warning", "error"]), "The current logger's minimum level. ConsoleLogger.level takes precedence if both overrides are enabled."),
        .init("ConsoleLogger.level", .player, "DebugConfig.logging.logger.level", .choice(["verbose", "info", "warning", "error"]), "Applies to an actual ConsoleLogger instance."),
    ] }
    static var nativeLoggingCallbacks: [AdvancedConfigurationField] { [
        .init("Logger.customLog", .player, "DebugConfig.logging.logger.log", .script(initial: "storage.entries = (storage.entries ?? 0) + 1;"), "Requires LoggingConfig.logger = javascript. input has message, numeric level, code, sender, date and optional deficiency data. Payloads stay local; the inspector retains bounded counts and lengths rather than SDK log text."),
    ] }
    func validateNativeLogging() throws {
        if values["Logger.customLog"] != nil && values["LoggingConfig.logger"] != "javascript" { throw ConfigurationValidationError(message: "Select javascript in LoggingConfig.logger before editing Logger.customLog.") }
        if values["LoggingConfig.logger"] == "javascript" && values["Logger.customLog"] == nil { throw ConfigurationValidationError(message: "Enable Logger.customLog and enter its function body for the javascript logger.") }
        if values["ConsoleLogger.level"] != nil, let kind = values["LoggingConfig.logger"], kind != "console" { throw ConfigurationValidationError(message: "ConsoleLogger.level requires the console logger.") }
    }
    var nativeLoggingCode: [String] {
        guard values["LoggingConfig.logger"] != nil || values["Logger.level"] != nil || values["ConsoleLogger.level"] != nil else { return [] }
        var lines: [String] = []
        if let kind = values["LoggingConfig.logger"] {
            if kind == "disabled" { lines.append("DebugConfig.logging.logger = nil") }
            if kind == "console" { lines.append("DebugConfig.logging.logger = ConsoleLogger()") }
        }
        if let level = values["Logger.level"] { lines.append("DebugConfig.logging.logger?.level = .\(level)") }
        if let level = values["ConsoleLogger.level"] { lines.append("(DebugConfig.logging.logger as? ConsoleLogger)?.level = .\(level)") }
        lines.append("// DebugConfig.logging is global to this process.")
        return lines
    }
    func nativeLoggingCallbackCode(sources: [String: String], name: String) -> [String] {
        guard name == "playerScript", sources["Logger.customLog"] != nil else { return [] }
        return ["final class ExampleGuiLogger: NSObject, Logger {", "    var level = LogLevel.warning", "    let call: (String, [String: Any]) -> Any?", "    init(call: @escaping (String, [String: Any]) -> Any?) { self.call = call }", "    func log(_ entry: LogEntry) {", "        guard entry.level.rawValue >= level.rawValue else { return }", "        _ = call(\"Logger.customLog\", [\"message\": entry.message, \"level\": entry.level.rawValue, \"code\": entry.code as Any? ?? NSNull(), \"sender\": entry.sender, \"date\": ISO8601DateFormatter().string(from: entry.currentDate), \"data\": entry.data.map { [\"code\": $0.code, \"message\": $0.message] } as Any? ?? NSNull()])", "    }", "}", "DebugConfig.logging.logger = ExampleGuiLogger(call: \(name))"]
    }
}
