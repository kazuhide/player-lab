import Foundation

#if DEBUG
/// Compiled only by the dedicated UI-test hosts and hostless guard tests.
/// There is deliberately no fallback to the normal application's profile store.
struct NativeProfileUITestRequest {
    let fileURL: URL
    let savedDraft: Bool
    let olderSDK: Bool

    init?(arguments: [String], temporaryRoot: URL) {
        let storeFlag = "--profile-ui-store"
        let supported = [storeFlag, "--profile-ui-saved-draft", "--profile-ui-older-sdk"]
        let flags = arguments.filter { $0.hasPrefix("--profile-ui-") }
        guard flags.allSatisfy({ supported.contains($0) }), Set(flags).count == flags.count,
              let index = arguments.firstIndex(of: storeFlag), arguments.indices.contains(index + 1),
              let id = UUID(uuidString: arguments[index + 1]),
              arguments[index + 1].uppercased() == id.uuidString else { return nil }
        fileURL = temporaryRoot.appendingPathComponent("PlayerLabProfilesUITests", isDirectory: true)
            .appendingPathComponent(id.uuidString, isDirectory: true).appendingPathComponent("profiles.json")
        savedDraft = flags.contains("--profile-ui-saved-draft")
        olderSDK = flags.contains("--profile-ui-older-sdk")
    }
}
#endif
