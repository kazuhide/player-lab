import Foundation

/// Localize presentation strings while retaining English SDK identifiers and model values.
/// https://developer.apple.com/documentation/foundation/bundle/localizedstring(forkey:value:table:)
enum NativeLocalization {
    static func text(_ key: String, bundle: Bundle = .main) -> String {
        bundle.localizedString(forKey: key, value: key, table: nil)
    }

    static func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: text(key), locale: Locale.current, arguments: arguments)
    }

    /// SDK names at the start of operation receipts remain literal.
    static func operationResult(_ message: String, bundle: Bundle = .main) -> String {
        let suffixes = [
            " invoked. Inspect the state and event log for SDK completion.",
            " invoked. Inspect SDK state and PlaylistTransitionEvent for completion.",
            " invoked. Check the SDK state and completion/error events.",
            " invoked. Enable RemoteControlConfig.isCastEnabled in player settings to use player casting.",
            " invoked. Inspect SDK state and listener callbacks for receiver completion."
        ]
        if let suffix = suffixes.first(where: message.hasSuffix) {
            return String(message.dropLast(suffix.count)) + text(suffix, bundle: bundle)
        }
        return text(message, bundle: bundle)
    }
}

extension String {
    var nativeLocalized: String { NativeLocalization.text(self) }
}
