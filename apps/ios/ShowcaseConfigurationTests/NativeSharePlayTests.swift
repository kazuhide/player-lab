import Foundation
import GroupActivities
import XCTest

final class NativeSharePlayTests: XCTestCase {
    func testNativeGroupActivityPreservesSourceIdentityAndPublishedMetadata() throws {
        let activity = PlayerLabGroupActivity(sourceURL: URL(string: "https://example.com/master.m3u8")!, title: "Example source", sourceIdentifier: "example-source")
        let copy = try JSONDecoder().decode(PlayerLabGroupActivity.self, from: JSONEncoder().encode(activity))
        XCTAssertEqual(copy.sourceURL, activity.sourceURL); XCTAssertEqual(copy.sourceIdentifier, "example-source")
        XCTAssertEqual(copy.metadata.title, "Example source"); XCTAssertEqual(copy.metadata.fallbackURL, activity.sourceURL)
        XCTAssertEqual(copy.metadata.type, .watchTogether)
        let attachment = XCTAttachment(data: Data(("import Foundation\n" + NativeSharePlayWorkbench.code).utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = "native-shareplay.swift"; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor
    func testOsSessionObservationStartsAndStopsWithoutCreatingOrJoiningSessions() async throws {
        let workbench = NativeSharePlayWorkbench()
        XCTAssertFalse(workbench.observing)
        workbench.start(); XCTAssertTrue(workbench.observing)
        try await Task.sleep(nanoseconds: 100_000_000)
        workbench.refresh()
        XCTAssertTrue(workbench.rows.allSatisfy { ["waiting", "joined", "invalidated"].contains($0.state) })
        workbench.stop(); XCTAssertFalse(workbench.observing)
        XCTAssertFalse(workbench.activating)
    }
}
