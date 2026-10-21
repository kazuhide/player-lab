import Foundation
import AVFoundation
import CoreMedia

/// Tagged native values are constructed explicitly; ordinary JSON metadata remains ordinary JSON.
struct NativeMetadataDraft {
    let values: [String: Any]
    let code: [String]

    init(json: String) throws {
        guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw Self.invalid("Metadata requires a JSON object.") }
        var metadata: [String: Any] = [:]
        var lines = ["var sourceMetadata: [String: Any] = [:]"]
        for (index, key) in object.keys.sorted().enumerated() {
            let value = object[key]!
            if let tagged = value as? [String: Any], let input = tagged["$avMetadataItem"] {
                guard tagged.count == 1, let fields = input as? [String: Any] else { throw Self.invalid("$avMetadataItem must be the only tag and contain an object.") }
                let name = "metadataItem\(index)"
                let (item, itemCode) = try Self.makeItem(fields, name: name)
                metadata[key] = item
                lines += itemCode + ["sourceMetadata[\(swiftString(key))] = \(name)"]
            } else {
                metadata[key] = value
                let json = try Self.json(value)
                lines.append("sourceMetadata[\(swiftString(key))] = try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8), options: [.fragmentsAllowed])")
            }
        }
        values = metadata
        code = lines
    }

    private static func makeItem(_ fields: [String: Any], name: String) throws -> (AVMutableMetadataItem, [String]) {
        let allowed: Set<String> = ["identifier", "key", "keySpace", "value", "dataType", "languageTag", "locale", "time", "duration", "startDate", "extraAttributes"]
        guard fields.keys.allSatisfy(allowed.contains) else { throw invalid("Unknown AVMetadataItem field.") }
        let item = AVMutableMetadataItem()
        var lines = ["let \(name) = AVMutableMetadataItem()"]
        if let id = try optionalString(fields["identifier"]) {
            let parts = id.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty }), !id.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { throw invalid("Metadata identifier needs keySpace/key; malformed identifiers raise an AVFoundation exception.") }
            item.identifier = AVMetadataIdentifier(rawValue: id)
            lines.append("\(name).identifier = AVMetadataIdentifier(rawValue: \(swiftString(id)))")
        }
        if let space = try optionalString(fields["keySpace"]) {
            guard (1...4).contains(space.utf8.count), space.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw invalid("Metadata keySpace needs one through four printable ASCII characters; use identifier for common/title.") }
            item.keySpace = AVMetadataKeySpace(rawValue: space)
            lines.append("\(name).keySpace = AVMetadataKeySpace(rawValue: \(swiftString(space)))")
        }
        if fields["key"] != nil {
            let (key, code) = try nativeValue(fields["key"])
            item.key = key
            lines.append("\(name).key = \(code)")
        }
        if fields["value"] != nil {
            let (value, code) = try nativeValue(fields["value"])
            item.value = value
            lines.append("\(name).value = \(code)")
        }
        if let dataType = try optionalString(fields["dataType"]) { item.dataType = dataType; lines.append("\(name).dataType = \(swiftString(dataType))") }
        if let language = try optionalString(fields["languageTag"]) { item.extendedLanguageTag = language; lines.append("\(name).extendedLanguageTag = \(swiftString(language))") }
        if let locale = try optionalString(fields["locale"]) { item.locale = Locale(identifier: locale); lines.append("\(name).locale = Locale(identifier: \(swiftString(locale)))") }
        if let value = fields["time"] { let (time, code) = try mediaTime(value); item.time = time; lines.append("\(name).time = \(code)") }
        if let value = fields["duration"] { let (time, code) = try mediaTime(value); item.duration = time; lines.append("\(name).duration = \(code)") }
        if let value = try optionalString(fields["startDate"]) {
            let date = try isoDate(value)
            item.startDate = date
            lines.append("\(name).startDate = Date(timeIntervalSince1970: \(date.timeIntervalSince1970))")
        }
        if let extra = fields["extraAttributes"], !(extra is NSNull) {
            guard let extra = extra as? [String: Any] else { throw invalid("Metadata extraAttributes must be a JSON object or null.") }
            item.extraAttributes = Dictionary(uniqueKeysWithValues: extra.map { (AVMetadataExtraAttributeKey(rawValue: $0.key), $0.value) })
            let json = try Self.json(extra)
            lines += ["let \(name)Extra = try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8)) as! [String: Any]",
                "\(name).extraAttributes = Dictionary(uniqueKeysWithValues: \(name)Extra.map { (AVMetadataExtraAttributeKey(rawValue: $0.key), $0.value) })"]
        }
        return (item, lines)
    }

    private static func nativeValue(_ value: Any?) throws -> ((any NSObjectProtocol & NSCopying)?, String) {
        guard let value, !(value is NSNull) else { return (nil, "nil") }
        if let string = value as? String { return (string as NSString, "\(swiftString(string)) as NSString") }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return (number, "NSNumber(value: \(number.boolValue))") }
            guard number.doubleValue.isFinite else { throw invalid("Metadata numeric values must be finite.") }
            let json = try Self.json(number)
            return (number, "(try! JSONSerialization.jsonObject(with: Data(\(swiftString(json)).utf8), options: [.fragmentsAllowed])) as! NSNumber")
        }
        if let object = value as? [String: Any], object.count == 1 {
            if let value = object["$base64"] as? String, let data = Data(base64Encoded: value) {
                return (data as NSData, "(Data(base64Encoded: \"<LOCAL_METADATA_BYTES>\") ?? Data()) as NSData")
            }
            if let value = object["$date"] as? String {
                let date = try isoDate(value)
                return (date as NSDate, "Date(timeIntervalSince1970: \(date.timeIntervalSince1970)) as NSDate")
            }
        }
        throw invalid("Native metadata key/value supports text, numbers, null, {$base64: bytes} or {$date: ISO8601}. Ordinary dictionaries can remain untagged source metadata.")
    }

    private static func mediaTime(_ value: Any) throws -> (CMTime, String) {
        if let code = value as? String {
            switch code {
            case "invalid": return (.invalid, ".invalid")
            case "indefinite": return (.indefinite, ".indefinite")
            case "positiveInfinity": return (.positiveInfinity, ".positiveInfinity")
            case "negativeInfinity": return (.negativeInfinity, ".negativeInfinity")
            default: throw invalid("Metadata time needs seconds, an exact CMTime object, or invalid/indefinite/positiveInfinity/negativeInfinity.")
            }
        }
        if let seconds = NativeScriptRuntime.number(value), abs(seconds) <= Double(Int64.max) / 1_000_000 {
            return (CMTime(seconds: seconds, preferredTimescale: 1_000_000), "CMTime(seconds: \(seconds), preferredTimescale: 1_000_000)")
        }
        if let object = value as? [String: Any], object.keys.allSatisfy({ ["value", "timescale", "epoch", "flags"].contains($0) }),
           let number = integerString(object["value"]).flatMap(Int64.init), let scale = integerString(object["timescale"]).flatMap(Int32.init),
           let epoch = integerString(object["epoch"] ?? "0").flatMap(Int64.init), let flags = integerString(object["flags"] ?? "1").flatMap(UInt32.init),
           scale != 0 || !CMTimeFlags(rawValue: flags).contains(.valid) {
            return (CMTime(value: number, timescale: scale, flags: CMTimeFlags(rawValue: flags), epoch: epoch),
                "CMTime(value: \(number), timescale: \(scale), flags: CMTimeFlags(rawValue: \(flags)), epoch: \(epoch))")
        }
        throw invalid("Metadata time needs finite representable seconds or {value: Int64 string, timescale: Int32, epoch: Int64 string, flags: UInt32}. Use explicit strings to preserve whole-number precision.")
    }
    private static func integerString(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { return number.stringValue }
        return nil
    }
    private static func optionalString(_ value: Any?) throws -> String? {
        guard let value, !(value is NSNull) else { return nil }
        guard let string = value as? String else { throw invalid("Metadata text fields must be strings or null.") }
        return string
    }
    private static func isoDate(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: value) else { throw invalid("Metadata dates must be ISO8601 timestamps with a timezone.") }
        return date
    }
    private static func json(_ object: Any) throws -> String { String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .fragmentsAllowed]), as: UTF8.self) }
    private static func invalid(_ value: String) -> ConfigurationValidationError { .init(message: value) }
}
