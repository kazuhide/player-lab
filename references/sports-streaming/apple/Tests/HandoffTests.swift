import XCTest
@testable import ReferenceDomain

final class HandoffTests: XCTestCase {
    private func document(_ ledger: HandoffLedger) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: ledger.export()) as? [String: Any])
    }
    private func rows(_ ledger: HandoffLedger) throws -> [[String: Any]] {
        try XCTUnwrap(try document(ledger)["records"] as? [[String: Any]])
    }

    func testPlayingNeedsTargetSourceAndAdvancingPosition() throws {
        var ledger = HandoffLedger()
        let id = ledger.begin(eventId: "event", videoId: "archive", positionMs: 15000, play: true)
        ledger.seekIssued(id, uptime: 1)
        XCTAssertFalse(ledger.seekCompleted(id, videoId: "other", positionMs: 15001, uptime: 2))
        XCTAssertTrue(ledger.seekCompleted(id, videoId: "archive", positionMs: 15001, uptime: 3))
        XCTAssertFalse(ledger.observe(id, videoId: "other", positionMs: 15000, isPlaying: true, isPaused: false, readyStopped: false, uptime: 1))
        XCTAssertFalse(ledger.observe(id, videoId: "archive", positionMs: 2000, isPlaying: true, isPaused: false, readyStopped: false, uptime: 2))
        XCTAssertFalse(ledger.observe(id, videoId: "archive", positionMs: 15001, isPlaying: true, isPaused: false, readyStopped: false, uptime: 3))
        XCTAssertTrue(try rows(ledger)[0]["confirmed"] is NSNull)
        XCTAssertTrue(ledger.observe(id, videoId: "archive", positionMs: 15205, isPlaying: true, isPaused: false, readyStopped: false, uptime: 3.2))
        let actual = try XCTUnwrap(try rows(ledger)[0]["confirmed"] as? [String: Any])
        XCTAssertEqual(actual["positionMs"] as? Int, 15001)
        XCTAssertEqual(actual["positionAdvanced"] as? Bool, true)
        XCTAssertEqual(try document(ledger)["source"] as? String, "local-device-records")
    }

    func testPausedAndReadyStoppedConfirmations() throws {
        var ledger = HandoffLedger()
        let id = ledger.begin(eventId: "e", videoId: "v", positionMs: 5000, play: false)
        ledger.seekIssued(id, uptime: 0)
        XCTAssertTrue(ledger.seekCompleted(id, videoId: "v", positionMs: 5000, uptime: 1))
        XCTAssertFalse(ledger.observe(id, videoId: "v", positionMs: 5000, isPlaying: false, isPaused: false, readyStopped: true, uptime: 1))
        XCTAssertFalse(ledger.observe(id, videoId: "v", positionMs: 5000, isPlaying: false, isPaused: false, readyStopped: true, uptime: 1.1))
        XCTAssertTrue(ledger.observe(id, videoId: "v", positionMs: 5000, isPlaying: false, isPaused: false, readyStopped: true, uptime: 1.3))
        let actual = try XCTUnwrap(try rows(ledger)[0]["confirmed"] as? [String: Any])
        XCTAssertEqual(actual["playWhenReady"] as? Bool, false)
        XCTAssertEqual(actual["positionAdvanced"] as? Bool, false)
    }

    func testMissingLateOrShortSeekCannotBeConfirmedByOrdinaryPlayback() throws {
        var ledger = HandoffLedger()
        for (landing, completedAt) in [(Double?.none, 1.0), (2, 1), (30, 12)] {
            let id = ledger.begin(eventId: "e", videoId: "v", positionMs: 30000, play: true)
            ledger.seekIssued(id, uptime: 0)
            if let landing {
                XCTAssertFalse(ledger.seekCompleted(id, videoId: "v", positionMs: Int(landing * 1000), uptime: completedAt))
                XCTAssertFalse(ledger.seekCompleted(id, videoId: "v", positionMs: 30000, uptime: completedAt))
            }
            for position in [30000, 30200] {
                XCTAssertFalse(ledger.observe(id, videoId: "v", positionMs: position, isPlaying: true,
                                              isPaused: false, readyStopped: false, uptime: 31))
            }
        }
        let id = ledger.begin(eventId: "e", videoId: "v", positionMs: 30000, play: true)
        ledger.seekIssued(id, uptime: 0)
        XCTAssertTrue(ledger.seekCompleted(id, videoId: "v", positionMs: 30000, uptime: 1))
        XCTAssertFalse(ledger.observe(id, videoId: "v", positionMs: 60000, isPlaying: true,
                                      isPaused: false, readyStopped: false, uptime: 1.2))
        XCTAssertFalse(ledger.observe(id, videoId: "v", positionMs: 30100, isPlaying: true,
                                      isPaused: false, readyStopped: false, uptime: 20))
        XCTAssertTrue(try rows(ledger).allSatisfy { $0["confirmed"] is NSNull && $0["failure"] is NSNull })
    }

    func testBoundedWireFormatKeepsUnknownAndFailureSeparate() throws {
        var ledger = HandoffLedger()
        for i in 0..<201 { _ = ledger.begin(eventId: "e", videoId: "v\(i)", positionMs: nil, play: false) }
        let id = ledger.begin(eventId: "e", videoId: "failed", positionMs: nil, play: false)
        ledger.fail(id)
        let result = try rows(ledger)
        XCTAssertEqual(result.count, 200)
        let last = try XCTUnwrap(result.last)
        XCTAssertEqual(last["transition"] as? String, "live-to-archive")
        XCTAssertTrue(last["receiverQoe"] is NSNull)
        XCTAssertTrue(last["confirmed"] is NSNull)
        XCTAssertEqual(last["failure"] as? String, "load-failed")
        let expected = try XCTUnwrap(last["requested"] as? [String: Any])
        XCTAssertTrue(expected["positionMs"] is NSNull)
    }
}
