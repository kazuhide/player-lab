import Foundation
import JavaScriptCore
import Darwin
import BitmovinPlayer

final class NativeCallbackJournal: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private var entries: [String: (calls: Int, failures: Int, result: String)] = [:]
    private var retainedObjects: [AnyObject] = []
    private var runtimes: [String: NativeScriptRuntime] = [:]
    func runtime(sources: [String: String], owner: String) -> NativeScriptRuntime {
        lock.lock(); defer { lock.unlock() }
        if let runtime = runtimes[owner] { return runtime }
        let runtime = NativeScriptRuntime(sources: sources, journal: self)
        runtimes[owner] = runtime
        return runtime
    }
    private weak var currentAdsManager: (any ImaAdsManager)?
    private weak var currentModel: PlayerModel?
    var model: PlayerModel? { lock.lock(); defer { lock.unlock() }; return currentModel }
    func setModel(_ model: PlayerModel) { lock.lock(); defer { lock.unlock() }; currentModel = model }
    #if !os(tvOS)
    private weak var currentMessageHandler: CustomMessageHandler?
    #endif
    private weak var currentInterstitialRegistry: (any InterstitialCustomAttributesMappingRegistry)?

    #if !os(tvOS)
    var messageHandler: CustomMessageHandler? {
        lock.lock(); defer { lock.unlock() }; return currentMessageHandler
    }
    func setMessageHandler(_ handler: CustomMessageHandler) {
        lock.lock(); defer { lock.unlock() }; currentMessageHandler = handler
    }
    #endif
    var interstitialRegistry: (any InterstitialCustomAttributesMappingRegistry)? {
        lock.lock(); defer { lock.unlock() }; return currentInterstitialRegistry
    }
    func setInterstitialRegistry(_ registry: any InterstitialCustomAttributesMappingRegistry) {
        lock.lock(); defer { lock.unlock() }; currentInterstitialRegistry = registry
    }

    var adsManager: (any ImaAdsManager)? {
        lock.lock()
        defer { lock.unlock() }
        return currentAdsManager
    }
    func setAdsManager(_ manager: any ImaAdsManager) {
        lock.lock()
        defer { lock.unlock() }
        currentAdsManager = manager
    }

    func configure(_ ids: Dictionary<String, String>.Keys) {
        lock.lock()
        defer { lock.unlock() }
        for id in ids where entries[id] == nil { entries[id] = (0, 0, "Configured; no invocation observed") }
    }

    func retain(_ object: AnyObject) {
        lock.lock()
        defer { lock.unlock() }
        retainedObjects.append(object)
    }

    func record(_ id: String, failure: String? = nil) {
        lock.lock()
        defer { lock.unlock() }
        let previous = entries[id] ?? (0, 0, "")
        entries[id] = (previous.calls + 1, previous.failures + (failure == nil ? 0 : 1), failure ?? "Returned a valid value")
    }

    var snapshot: [(id: String, value: String)] {
        lock.lock()
        defer { lock.unlock() }
        return entries.keys.sorted().map { id in
            let entry = entries[id]!
            return (id, "Calls: \(entry.calls); failures: \(entry.failures). \(entry.result)")
        }
    }
}

/// A player or source owns its runtime. Calls share local JavaScript state and are serialized.
final class NativeScriptRuntime: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private var context: JSContext?
    private let sources: [String: String]
    private weak var journal: NativeCallbackJournal?
    private var engine: JSValue?
    private var executionMetrics: [String: [String: Double]] = [:]
    private static let validationLock = NSRecursiveLock()
    private static var validationContext: JSContext?
    private static let interpreterSource: Result<String, Error> = Result { try loadBundledEngineSource() }
    private static let syntaxCache: NSCache<NSString, NSString> = {
        let cache = NSCache<NSString, NSString>()
        cache.countLimit = 128
        return cache
    }()

    init(sources: [String: String], journal: NativeCallbackJournal? = nil) {
        self.sources = sources
        self.journal = journal
        journal?.configure(sources.keys)
    }

    func call<T>(_ id: String, input: [String: Any], fallback: T, convert: (Any?) -> T?) -> T {
        do {
            guard let converted = convert(try evaluate(id, input: input)) else {
                throw Self.invalid("The callback returned a value with the wrong type.")
            }
            journal?.record(id)
            return converted
        } catch {
            let detail: String
            if let failure = error as? NativeScriptExecutionFailure {
                let metrics = failure.metrics
                let timing = ["cpuMs", "wallMs", "instructions"].compactMap { key -> String? in
                    guard let value = metrics[key] else { return nil }; return key + "=" + String(format: "%.3f", value)
                }.joined(separator: "; ")
                detail = failure.reason + (timing.isEmpty ? " " : " (" + timing + ") ")
            } else if let failure = error as? ConfigurationValidationError,
               failure.message.contains("interpreter") || failure.message.contains("budget") || failure.message.contains("limit was exceeded") {
                detail = failure.message.contains("elapsed-time budget") ? "The elapsed-time budget was exceeded. " : "An interpreter work or value-size limit was exceeded. "
            } else if let failure = error as? ConfigurationValidationError, failure.message == "The callback returned a value with the wrong type." {
                detail = "The returned value has the wrong native type. "
            } else { detail = "The callback could not return a supported value. " }
            journal?.record(id, failure: detail + "The documented fallback was used.")
            return fallback
        }
    }

    static func validateSources(_ sources: [String: String]) throws {
        guard sources.count <= 128, sources.values.reduce(0, { $0 + $1.utf8.count }) <= 1_048_576 else {
            throw invalid("Callbacks for one owner must fit within 128 functions and 1 MiB of source text.")
        }
        for (id, source) in sources { try validate(source, id: id) }
    }

    static func validate(_ source: String, id: String) throws {
        guard source.utf8.count <= 65_536 else { throw invalid("\(id): function body exceeds 64 KiB.") }
        let key = source as NSString
        if let cached = syntaxCache.object(forKey: key) {
            if !cached.isEqual(to: "") { throw invalid("\(id): invalid JavaScript function body.") }
            return
        }
        validationLock.lock(); defer { validationLock.unlock() }
        do {
            if validationContext == nil {
                let created = try makeContext()
                guard created.exception == nil else { throw invalid("The bounded callback validator could not be loaded.") }
                validationContext = created
            }
            guard let context = validationContext, let api = context.objectForKeyedSubscript("PlayerLabScriptEngine"), !api.isUndefined else { throw invalid("The bounded callback validator is unavailable.") }
            context.exception = nil
            _ = api.invokeMethod("validate", withArguments: [source])
            guard context.exception == nil else { throw invalid("\(id): invalid or unsupported callback body.") }
            syntaxCache.setObject("", forKey: key)
        } catch {
            syntaxCache.setObject("invalid", forKey: key)
            throw error
        }
    }

    func evaluate(_ id: String, input: Any) throws -> Any? {
        lock.lock()
        defer { lock.unlock() }
        let engine = try prepare(id)
        guard let context else { throw Self.invalid("\(id): JavaScript runtime is unavailable.") }
        context.exception = nil
        let value = engine.invokeMethod("call", withArguments: [id, input])
        let exception = context.exception
        context.exception = nil
        if engine.hasProperty("lastMetrics"), let metrics = engine.invokeMethod("lastMetrics", withArguments: [])?.toDictionary() as? [String: NSNumber] {
            executionMetrics[id] = metrics.reduce(into: [:]) { result, item in if item.value.doubleValue.isFinite { result[item.key] = item.value.doubleValue } }
        }
        context.exception = exception
        if let exception {
            if exception.forProperty("name")?.toString() == "ScriptBudgetError" {
                let labels: Set<String> = ["The instruction budget was exceeded.", "The elapsed-time budget was exceeded.", "The allocation budget was exceeded.", "The string length limit was exceeded.", "The array length limit was exceeded.", "The value depth limit was exceeded.", "The retained storage limit was exceeded.", "The callback call-depth limit was exceeded."]
                let message = exception.forProperty("message")?.toString() ?? ""
                throw NativeScriptExecutionFailure(reason: labels.contains(message) ? message : "The callback exceeded an interpreter work or value-size limit.", metrics: executionMetrics[id] ?? [:])
            }
            throw Self.invalid("\(id): the callback could not return a supported value.")
        }
        guard let value, !value.isUndefined, !value.isNull else { return nil }
        return value.toObject()
    }

    func metricsSnapshot() -> [String: [String: Double]] {
        lock.lock(); defer { lock.unlock() }; return executionMetrics
    }

    private func prepare(_ id: String) throws -> JSValue {
        guard sources[id] != nil else { throw Self.invalid("\(id): function is not configured.") }
        if let engine { return engine }
        let created = try Self.makeContext()
        guard created.exception == nil,
              let api = created.objectForKeyedSubscript("PlayerLabScriptEngine"), !api.isUndefined else {
            throw Self.invalid("The bounded callback interpreter could not be loaded.")
        }
        try Self.validateSources(sources)
        guard let configured = api.invokeMethod("create", withArguments: [sources]),
              !configured.isNull, !configured.isUndefined, created.exception == nil else {
            throw Self.invalid("\(id): invalid or unsupported callback body.")
        }
        context = created
        engine = configured
        return configured
    }

    private static func makeContext() throws -> JSContext {
        guard let context = JSContext() else { throw invalid("Unable to create a JavaScript runtime.") }
        let clock: @convention(block) () -> Double = {
            var value = timespec()
            guard clock_gettime(CLOCK_THREAD_CPUTIME_ID, &value) == 0 else { return .nan }
            return Double(value.tv_sec) * 1_000 + Double(value.tv_nsec) / 1_000_000
        }
        // Only the trusted interpreter receives this clock; the AST environment exposes no host globals.
        context.setObject(clock, forKeyedSubscript: "__playerLabThreadCPUTimeMilliseconds" as NSString)
        context.evaluateScript(try bundledEngineSource())
        return context
    }

    static func bundledEngineSource() throws -> String { try interpreterSource.get() }

    private static func loadBundledEngineSource() throws -> String {
        let bundle = Bundle(for: NativeScriptResourceMarker.self)
        guard let licenseURL = bundle.url(forResource: "ACORN-LICENSE", withExtension: "txt") else {
            throw invalid("The callback parser license is missing from this build.")
        }
        let license = try String(contentsOf: licenseURL, encoding: .utf8)
        return "/*\n" + license + "\n*/\n" + (try ["acorn", "engine"].map { name in
            guard let url = bundle.url(forResource: name, withExtension: "js") else {
                throw invalid("The bounded callback interpreter is missing from this build. Regenerate the Xcode project from project.yml.")
            }
            return try String(contentsOf: url, encoding: .utf8)
        }.joined(separator: "\n"))
    }

    /// The example loads the same public interpreter resources without hiding configuration in a giant literal.
    static func codePreamble(_ sources: [String: String], name: String) -> [String] {
        let definitions = sources.isEmpty ? "[:]" : "[" + sources.keys.sorted().map { swiftString($0) + ": " + swiftString(sources[$0]!) }.joined(separator: ", ") + "]"
        return [
            "// Bounded plain-value callbacks; keep this owner alive with its player/source.",
            "// Add acorn.js, engine.js and ACORN-LICENSE.txt from apps/ios/Showcase/NativeScripts to this app's bundle resources.",
            "// Source and supported syntax: https://github.com/kazuhide/player-lab/tree/main/apps/ios/Showcase/NativeScripts",
            "// Acorn 8.17.0 is MIT licensed; retain ACORN-LICENSE.txt when copying its source.",
            "let \(name)Lock = NSRecursiveLock()",
            "let \(name)Context = JSContext()!",
            "let \(name)Clock: @convention(block) () -> Double = {",
            "    var value = timespec()",
            "    guard clock_gettime(CLOCK_THREAD_CPUTIME_ID, &value) == 0 else { return .nan }",
            "    return Double(value.tv_sec) * 1_000 + Double(value.tv_nsec) / 1_000_000",
            "}",
            "\(name)Context.setObject(\(name)Clock, forKeyedSubscript: \"__playerLabThreadCPUTimeMilliseconds\" as NSString)",
            "var \(name)ResourcesLoaded = true",
            "for resource in [\"acorn\", \"engine\"] {",
            "    guard let url = Bundle.main.url(forResource: resource, withExtension: \"js\"), let source = try? String(contentsOf: url, encoding: .utf8) else { \(name)ResourcesLoaded = false; break }",
            "    \(name)Context.evaluateScript(source)",
            "    if \(name)Context.exception != nil { \(name)ResourcesLoaded = false; break }",
            "}",
            "let \(name)Definitions: [String: String] = \(definitions)",
            "let \(name)Engine: JSValue? = {",
            "    guard \(name)ResourcesLoaded, let api = \(name)Context.objectForKeyedSubscript(\"PlayerLabScriptEngine\"), !api.isUndefined else { return nil }",
            "    for body in \(name)Definitions.values {",
            "        _ = api.invokeMethod(\"validate\", withArguments: [body])",
            "        guard \(name)Context.exception == nil else { return nil }",
            "    }",
            "    return api.invokeMethod(\"create\", withArguments: [\(name)Definitions])",
            "}()",
            "let \(name): (String, [String: Any]) -> Any? = { id, input in",
            "    \(name)Lock.lock(); defer { \(name)Lock.unlock() }",
            "    \(name)Context.exception = nil",
            "    let result = \(name)Engine?.invokeMethod(\"call\", withArguments: [id, input])",
            "    guard \(name)Context.exception == nil, let result else { return nil }",
            "    if result.isNull || result.isUndefined { return NSNull() } // Successful cancellation is distinct from evaluation failure.",
            "    return result.toObject()",
            "}",
        ]
    }

    static func string(_ value: Any?) -> String? { value as? String }
    static func boolean(_ value: Any?) -> Bool? {
        guard let value = value as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
        return value.boolValue
    }
    static func number(_ value: Any?) -> Double? {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return nil }
        return value.doubleValue
    }
    static func data(_ value: Any?) -> Data? {
        if let value = value as? String { return Data(base64Encoded: value) }
        if let object = value as? [String: Any], let text = object["utf8"] as? String { return Data(text.utf8) }
        if let bytes = value as? [NSNumber] {
            var data = Data(capacity: bytes.count)
            for byte in bytes {
                guard CFGetTypeID(byte) != CFBooleanGetTypeID(), byte.doubleValue.isFinite,
                      byte.doubleValue.rounded(.towardZero) == byte.doubleValue, (0...255).contains(byte.doubleValue) else { return nil }
                data.append(byte.uint8Value)
            }
            return data
        }
        return nil
    }
    static func strings(_ value: Any?) -> [String]? { value as? [String] }
    private static func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}

private final class NativeScriptResourceMarker: NSObject {}

private struct NativeScriptExecutionFailure: Error {
    let reason: String
    let metrics: [String: Double]
}
