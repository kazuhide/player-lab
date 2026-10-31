import XCTest
#if canImport(ProfileCore)
@testable import ProfileCore
#endif

#if DEBUG
final class NativeProfileUITestRequestTests: XCTestCase {
    func testOnlyAnExplicitCanonicalUUIDCanOwnATemporaryStore() throws {
        let root = URL(fileURLWithPath: "/tmp/profile-host-tests", isDirectory: true)
        let id = UUID().uuidString
        let request = try XCTUnwrap(NativeProfileUITestRequest(arguments: ["host", "--profile-ui-store", id], temporaryRoot: root))
        XCTAssertEqual(request.fileURL.path, root.appendingPathComponent("PlayerLabProfilesUITests/\(id)/profiles.json").path)
        XCTAssertFalse(request.savedDraft)
        XCTAssertFalse(request.olderSDK)
        let relaunch = try XCTUnwrap(NativeProfileUITestRequest(arguments: ["host", "--profile-ui-store", id], temporaryRoot: root))
        XCTAssertEqual(relaunch.fileURL, request.fileURL)
        let other = try XCTUnwrap(NativeProfileUITestRequest(arguments: ["host", "--profile-ui-store", UUID().uuidString], temporaryRoot: root))
        XCTAssertNotEqual(other.fileURL, request.fileURL)
        for arguments in [["host"], ["host", "--profile-ui-store"], ["host", "--profile-ui-store", "../normal"],
                          ["host", "--profile-ui-store", id + "/../normal"], ["host", "--profile-ui-store", "user-data"],
                          ["host", "--profile-ui-store", id, "--profile-ui-store", id]] {
            XCTAssertNil(NativeProfileUITestRequest(arguments: arguments, temporaryRoot: root), "\(arguments)")
        }
    }

    func testFixtureFlagsAreExplicitAndUnknownProfileFlagsFailClosed() throws {
        let id = UUID().uuidString
        let root = URL(fileURLWithPath: "/tmp/profile-host-tests", isDirectory: true)
        let arguments = ["host", "--profile-ui-store", id, "--profile-ui-saved-draft", "--profile-ui-older-sdk", "-AppleLanguages", "(ja)"]
        let request = try XCTUnwrap(NativeProfileUITestRequest(arguments: arguments, temporaryRoot: root))
        XCTAssertTrue(request.savedDraft)
        XCTAssertTrue(request.olderSDK)
        XCTAssertNil(NativeProfileUITestRequest(arguments: arguments + ["--profile-ui-normal-store"], temporaryRoot: root))
        XCTAssertNil(NativeProfileUITestRequest(arguments: arguments + ["--profile-ui-saved-draft"], temporaryRoot: root))
    }
}
#endif
