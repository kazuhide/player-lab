import Foundation
import UIKit
import AVFoundation
import BitmovinPlayer

struct NativeCueDraft {
    let cue: Cue
    let parsedCueIndex: Int?
    let code: String

    init(json: String, parsedCues: [Cue]) throws {
        guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw Self.invalid("Cue input must be a JSON object.") }
        let allowed = Set(["startTime", "endTime", "html", "text", "rawText", "attributedText", "imageBase64", "position", "region", "regionStyle", "vttFromParsedCue"])
        guard object.keys.allSatisfy(allowed.contains), let start = NativeScriptRuntime.number(object["startTime"]),
              let end = NativeScriptRuntime.number(object["endTime"]), end >= start else { throw Self.invalid("Cue input needs finite startTime/endTime in seconds, with endTime >= startTime, and documented fields only.") }
        let html = try Self.string(object["html"])
        let text = try Self.string(object["text"])
        let raw = try Self.string(object["rawText"])
        let region = try Self.string(object["region"])
        let regionStyle = try Self.string(object["regionStyle"])
        var attributed: NSAttributedString?
        var attributedCode = "nil"
        if let value = object["attributedText"], !(value is NSNull) {
            if let string = value as? String {
                attributed = NSAttributedString(string: string)
                attributedCode = "NSAttributedString(string: \(swiftString(string)))"
            } else if let value = value as? [String: Any], value.keys.allSatisfy({ ["string", "fontSize", "foregroundColor"].contains($0) }), let string = value["string"] as? String {
                var attributes: [NSAttributedString.Key: Any] = [:]
                var fields: [String] = []
                if let value = value["fontSize"] {
                    guard let size = NativeScriptRuntime.number(value), size > 0 else { throw Self.invalid("Attributed cue fontSize needs finite positive points.") }
                    attributes[.font] = UIFont.systemFont(ofSize: CGFloat(size))
                    fields.append(".font: UIFont.systemFont(ofSize: \(size))")
                }
                if let value = value["foregroundColor"] {
                    guard let string = value as? String else { throw Self.invalid("Attributed cue foregroundColor needs #RRGGBB or #RRGGBBAA.") }
                    let (color, code) = try Self.color(string)
                    attributes[.foregroundColor] = color
                    fields.append(".foregroundColor: " + code)
                }
                attributed = NSAttributedString(string: string, attributes: attributes)
                attributedCode = "NSAttributedString(string: \(swiftString(string)), attributes: \(fields.isEmpty ? "[:]" : "[" + fields.joined(separator: ", ") + "]"))"
            } else { throw Self.invalid("attributedText must be text or {string, fontSize, foregroundColor}. Other native attribute values are not constructed by this editor.") }
        }
        var image: UIImage?
        var imageCode = "nil"
        if let value = try Self.string(object["imageBase64"]) {
            guard let data = Data(base64Encoded: value), let loaded = UIImage(data: data) else { throw Self.invalid("Cue imageBase64 must decode to an image supported by UIKit.") }
            image = loaded
            imageCode = "UIImage(data: Data(base64Encoded: \"<LOCAL_IMAGE_BASE64>\") ?? Data())"
        }
        var position: CuePosition?
        var positionCode = "nil"
        if let value = object["position"], !(value is NSNull) {
            guard let value = value as? [String: Any], value.keys.allSatisfy({ ["column", "row"].contains($0) }),
                  let column = Self.integer(value["column"]), let row = Self.integer(value["row"]) else { throw Self.invalid("Cue position needs integer column and row.") }
            position = CuePosition(column: column, row: row)
            positionCode = "CuePosition(column: \(column), row: \(row))"
        }
        var vtt: VttProperties?
        var vttCode = "nil"
        if let indexValue = object["vttFromParsedCue"], !(indexValue is NSNull) {
            guard let index = Self.integer(indexValue), parsedCues.indices.contains(index), let properties = parsedCues[index].vtt else { throw Self.invalid("Choose a currently retained parsed cue that has VTT properties.") }
            parsedCueIndex = index
            vtt = properties
            vttCode = "parsedCues[\(index)].vtt"
        } else { parsedCueIndex = nil }
        cue = Cue(startTime: start, endTime: end, html: html, text: text, rawText: raw, attributedText: attributed, image: image,
            position: position, region: region, regionStyle: regionStyle, vttProperties: vtt)
        code = "Cue(startTime: \(start), endTime: \(end), html: \(html.map(swiftString) ?? "nil"), text: \(text.map(swiftString) ?? "nil"), rawText: \(raw.map(swiftString) ?? "nil"), attributedText: \(attributedCode), image: \(imageCode), position: \(positionCode), region: \(region.map(swiftString) ?? "nil"), regionStyle: \(regionStyle.map(swiftString) ?? "nil"), vttProperties: \(vttCode))"
    }

    static func styles(_ json: String) throws -> [AVTextStyleRule]? {
        let object = try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
        if object is NSNull { return nil }
        guard let values = object as? [[String: Any]] else { throw invalid("Subtitle styles require null or an array of AVTextStyleRule attribute dictionaries.") }
        return try values.map { value in
            guard let rule = AVTextStyleRule(textMarkupAttributes: value) else { throw invalid("An AVTextStyleRule attribute dictionary is invalid.") }
            return rule
        }
    }

    private static func string(_ value: Any?) throws -> String? {
        guard let value else { return nil }
        if value is NSNull { return nil }
        guard let string = value as? String else { throw invalid("Cue text fields need strings or null.") }
        return string
    }
    private static func integer(_ value: Any?) -> Int? {
        if let value = value as? String { return Int(value) }
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
        return Int(value.stringValue)
    }
    private static func color(_ string: String) throws -> (UIColor, String) {
        let hex = string.hasPrefix("#") ? String(string.dropFirst()) : string
        guard [6, 8].contains(hex.count), hex.allSatisfy({ $0.isASCII && $0.isHexDigit }), let value = UInt32(hex, radix: 16) else { throw invalid("Cue color needs #RRGGBB or #RRGGBBAA.") }
        let rgba = hex.count == 6 ? (UInt64(value) << 8) | 255 : UInt64(value)
        let red = Double((rgba >> 24) & 255) / 255, green = Double((rgba >> 16) & 255) / 255, blue = Double((rgba >> 8) & 255) / 255, alpha = Double(rgba & 255) / 255
        return (UIColor(red: CGFloat(red), green: CGFloat(green), blue: CGFloat(blue), alpha: CGFloat(alpha)), "UIColor(red: \(red), green: \(green), blue: \(blue), alpha: \(alpha))")
    }
    private static func invalid(_ message: String) -> ConfigurationValidationError { .init(message: message) }
}
