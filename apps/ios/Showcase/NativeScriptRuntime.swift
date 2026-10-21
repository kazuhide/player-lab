import Foundation
import JavaScriptCore
import BitmovinPlayer

final class NativeCallbackJournal: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String: (calls: Int, failures: Int, result: String)] = [:]
    private var retainedObjects: [AnyObject] = []
    private weak var currentAdsManager: (any ImaAdsManager)?

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
    private var functions: [String: JSValue] = [:]
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
            journal?.record(id, failure: "Callback failed; the documented fallback was used.")
            return fallback
        }
    }

    static func validate(_ source: String, id: String) throws {
        guard source.utf8.count <= 65_536 else { throw invalid("\(id): function body exceeds 64 KiB.") }
        let key = source as NSString
        if let cached = syntaxCache.object(forKey: key) {
            if !cached.isEqual(to: "") { throw invalid("\(id): invalid JavaScript function body.") }
            return
        }
        do {
            let runtime = NativeScriptRuntime(sources: [id: source])
            _ = try runtime.prepare(id)
            syntaxCache.setObject("", forKey: key)
        } catch {
            syntaxCache.setObject("invalid", forKey: key)
            throw error
        }
    }

    func evaluate(_ id: String, input: Any) throws -> Any? {
        lock.lock()
        defer { lock.unlock() }
        let function = try prepare(id)
        guard let context else { throw Self.invalid("\(id): JavaScript runtime is unavailable.") }
        context.exception = nil
        let value = function.call(withArguments: [input])
        guard context.exception == nil else { throw Self.invalid("\(id): JavaScript callback threw an exception.") }
        guard let value, !value.isUndefined, !value.isNull else { return nil }
        return value.toObject()
    }

    private func prepare(_ id: String) throws -> JSValue {
        if let function = functions[id] { return function }
        guard let source = sources[id] else { throw Self.invalid("\(id): function is not configured.") }
        if context == nil {
            guard let created = JSContext() else { throw Self.invalid("Unable to create a JavaScript runtime.") }
            created.evaluateScript("globalThis.storage = Object.create(null);")
            context = created
        }
        guard let context else { throw Self.invalid("\(id): JavaScript runtime is unavailable.") }
        context.exception = nil
        guard let constructor = context.objectForKeyedSubscript("Function"),
              let function = constructor.construct(withArguments: ["input", source]),
              context.exception == nil else { throw Self.invalid("\(id): invalid JavaScript function body.") }
        functions[id] = function
        return function
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
