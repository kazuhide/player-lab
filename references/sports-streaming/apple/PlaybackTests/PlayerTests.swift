import XCTest
import BitmovinPlayer
#if os(iOS)
@testable import Sports_iOS
#else
@testable import Sports_tvOS
#endif

@MainActor
final class PlayerTests: XCTestCase {
    private func waitFor(_ message: String, _ condition: () -> Bool,
                         file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = Date().addingTimeInterval(20)
        while !condition(), Date() < deadline { try await Task.sleep(nanoseconds: 100_000_000) }
        XCTAssertTrue(condition(), message, file: file, line: line)
        if !condition() { throw URLError(.timedOut) }
    }

    func testClipSeekAndPauseKeepSource() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player, "Set the allowed Player license before running the Playback scheme.")
        defer { player.destroy() }
        await session.fetchCatalog()
        let clip = try XCTUnwrap(session.assets.first { $0.id == "SP-CLIP-A" })
        session.open(clip)
        try await waitFor("The HLS clip should play.") { session.playing && (session.position ?? 0) > 0 }
        player.pause()
        try await waitFor("The SDK must report paused.") { !session.playing }
        let source = try XCTUnwrap(player.source)
        session.standardControls.toggle()
        session.seek(by: 15)
        try await waitFor("The sports seek must advance a paused clip.") { player.currentTime >= 14.5 }
        XCTAssertFalse(session.playing)
        XCTAssertTrue(player.source === source)
        XCTAssertNil(session.mappedPosition(for: clip))
    }

}
