import XCTest
import Combine
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

    func testEndedEventCanOpenItsRetainedLiveSourceBeforeArchiveReadiness() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        await session.fetchCatalog()
        let event = try XCTUnwrap(session.event)
        let live = try XCTUnwrap(session.assets.first { $0.id == event.liveAssetId })
        let archive = try XCTUnwrap(session.assets.first { $0.id == event.archiveAssetId })
        func status(_ value: String) -> EventUpdate {
            EventUpdate(id: event.id, liveAssetId: event.liveAssetId, archiveAssetId: event.archiveAssetId,
                        status: value, archiveStatus: "processing", utcStartMs: nil,
                        seekableUtcStartMs: nil, seekableUtcEndMs: nil, archiveMapping: nil)
        }
        for unavailable in ["scheduled", "cancelled"] {
            session.update = status(unavailable)
            XCTAssertFalse(session.canOpen(live))
        }
        session.update = status("ended")
        XCTAssertTrue(session.canOpen(live))
        XCTAssertFalse(session.canOpen(archive))
        session.open(live)
        try await waitFor("The retained HLS source must play") { session.playing && (session.position ?? 0) > 0 }
        XCTAssertEqual(session.asset?.id, live.id)
        let source = try XCTUnwrap(player.source)
        session.backToLive(restore: false)
        session.backToLive(restore: true)
        XCTAssertTrue(player.source === source)
        XCTAssertFalse(session.canReturn)
    }

    func testRetryPreservesPausedArchiveRequestAndSeparateEvidence() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        await session.fetchCatalog()
        let event = try XCTUnwrap(session.event)
        let live = try XCTUnwrap(session.assets.first { $0.id == event.liveAssetId })
        let archive = try XCTUnwrap(session.assets.first { $0.id == event.archiveAssetId })
        session.update = EventUpdate(id: event.id, liveAssetId: event.liveAssetId, archiveAssetId: event.archiveAssetId,
                                     status: "ended", archiveStatus: "ready", utcStartMs: nil,
                                     seekableUtcStartMs: nil, seekableUtcEndMs: nil, archiveMapping: nil)
        session.open(live)
        session.open(archive, seek: 45, play: false)
        let firstAttempt = try XCTUnwrap(session.activeSource)
        // Inject a load failure before the SDK can confirm the first attempt.
        session.failed("Fixture load failure")
        session.retry()
        XCTAssertFalse(session.activeSource === firstAttempt)
        try await waitFor("Retry must seek the same archive and preserve paused intent") {
            session.ready && player.source === session.activeSource && !player.isPlaying && abs(player.currentTime - 45) < 1
        }
        func records() -> [[String: Any]] {
            guard let data = try? session.handoffs.export(),
                  let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
            return doc["records"] as? [[String: Any]] ?? []
        }
        try await waitFor("Retry must acquire its own paused confirmation") {
            records().last?["confirmed"] is [String: Any]
        }
        let attempts = records()
        XCTAssertEqual(attempts.count, 2)
        XCTAssertNotEqual(attempts.first?["requestId"] as? String, attempts.last?["requestId"] as? String)
        XCTAssertTrue(attempts.first?["confirmed"] is NSNull)
        XCTAssertEqual(attempts.first?["failure"] as? String, "load-failed")
        let requested = try XCTUnwrap(attempts.last?["requested"] as? [String: Any])
        XCTAssertEqual(requested["positionMs"] as? Int, 45000)
        XCTAssertEqual(requested["videoId"] as? String, archive.videoId)
        XCTAssertEqual(requested["playWhenReady"] as? Bool, false)
    }

    func testTerminalPollingRetriesTransientFailureAndExplicitlyRefreshes() async throws {
        let session = SportsSession()
        defer { session.player?.destroy() }
        await session.fetchCatalog()
        let event = try XCTUnwrap(session.event)
        func update(_ status: String, _ archive: String) -> EventUpdate {
            EventUpdate(id: event.id, liveAssetId: event.liveAssetId, archiveAssetId: event.archiveAssetId,
                        status: status, archiveStatus: archive, utcStartMs: nil, seekableUtcStartMs: nil,
                        seekableUtcEndMs: nil, archiveMapping: nil)
        }
        var attempts = 0
        await session.poll(fetch: { _ in
            attempts += 1
            if attempts == 1 { throw URLError(.timedOut) }
            if attempts == 2 { return update("ended", "processing") }
            return update("ended", "ready")
        }, interval: 1_000_000, endedRetryDelays: [1_000_000, 1_000_000, 1_000_000])
        XCTAssertEqual(attempts, 3)
        XCTAssertTrue(session.statusPollingFinished)
        XCTAssertFalse(session.statusError)
        await session.poll(fetch: { _ in
            attempts += 1
            return update("ended", "failed")
        }, interval: 1_000_000)
        XCTAssertEqual(attempts, 4)
        XCTAssertFalse(session.archiveReady)
        XCTAssertTrue(session.statusPollingFinished)

        var missingReceiptRequests = 0
        await session.poll(fetch: { _ in
            missingReceiptRequests += 1
            return update("ended", "not_ready")
        }, endedRetryDelays: [1_000_000, 1_000_000, 1_000_000])
        XCTAssertEqual(missingReceiptRequests, 4)
        XCTAssertTrue(session.readinessRetriesExhausted)
        XCTAssertTrue(session.statusPollingFinished)
        XCTAssertFalse(session.archiveReady)
        await session.poll(fetch: { _ in update("ended", "ready") })
        XCTAssertFalse(session.readinessRetriesExhausted)
        XCTAssertTrue(session.archiveReady)
    }

    func testPlayingHandoffConfirmsNativeArchiveSeekAndAdvancement() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        await session.fetchCatalog()
        let event = try XCTUnwrap(session.event)
        let live = try XCTUnwrap(session.assets.first { $0.id == event.liveAssetId })
        let archive = try XCTUnwrap(session.assets.first { $0.id == event.archiveAssetId })
        session.update = EventUpdate(id: event.id, liveAssetId: event.liveAssetId, archiveAssetId: event.archiveAssetId,
                                     status: "ended", archiveStatus: "ready", utcStartMs: nil,
                                     seekableUtcStartMs: nil, seekableUtcEndMs: nil, archiveMapping: nil)
        session.open(live)
        session.open(archive, seek: 30, play: true)
        var confirmed: [String: Any]?
        try await waitFor("The native archive seek must complete and playback must advance") {
            guard let data = try? session.handoffs.export(),
                  let document = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rows = document["records"] as? [[String: Any]] else { return false }
            confirmed = rows.first?["confirmed"] as? [String: Any]
            return confirmed != nil
        }
        XCTAssertEqual(confirmed?["videoId"] as? String, archive.videoId)
        XCTAssertEqual(confirmed?["positionAdvanced"] as? Bool, true)
        XCTAssertEqual(Double(try XCTUnwrap(confirmed?["positionMs"] as? Int)), 30_000, accuracy: 1000)
        XCTAssertTrue(player.isPlaying)
    }

    private func mappedOpen(_ session: SportsSession) async throws -> SportAsset {
        await session.fetchCatalog()
        let event = try XCTUnwrap(session.event)
        let live = try XCTUnwrap(session.assets.first { $0.id == event.liveAssetId })
        let archive = try XCTUnwrap(session.assets.first { $0.id == event.archiveAssetId })
        session.update = EventUpdate(id: event.id, liveAssetId: event.liveAssetId, archiveAssetId: event.archiveAssetId,
                                     status: "ended", archiveStatus: "ready", utcStartMs: nil,
                                     seekableUtcStartMs: nil, seekableUtcEndMs: nil, archiveMapping: nil)
        session.open(live)
        session.open(archive, seek: 30)
        return archive
    }

    private func records(_ session: SportsSession) throws -> [[String: Any]] {
        let data = try session.handoffs.export()
        let document = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(document["records"] as? [[String: Any]])
    }

    func testMissedArchiveSeekStaysPausedUntilExplicitRetry() async throws {
        var issued = false
        var replaySeek = false
        let session = SportsSession(seekArchive: { player, seconds in
            issued = true
            if replaySeek { player.seek(time: seconds) }
        })
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        var playEvents = 0
        let observer = player.events.on(PlayEvent.self).sink { _ in playEvents += 1 }
        defer { observer.cancel() }
        _ = try await mappedOpen(session)
        try await waitFor("The HLS archive should request its initial seek") { issued }
        let source = try XCTUnwrap(session.activeSource)
        let start = SeekPosition(source: source, time: 0)
        session.archiveSeekStarted(SeekEvent(from: start, to: SeekPosition(source: source, time: 30)), player: player)
        session.archiveSeekCompleted(player, seconds: 2)
        XCTAssertNotNil(session.problem)
        XCTAssertFalse(session.ready)
        XCTAssertFalse(player.isPlaying)
        XCTAssertEqual(playEvents, 0)
        let first = try XCTUnwrap(try records(session).first)
        XCTAssertTrue(first["confirmed"] is NSNull)
        XCTAssertEqual(first["failure"] as? String, "position-mismatch")
        replaySeek = true
        session.retry()
        try await waitFor("A real on-target retry should play") { session.playing && player.currentTime >= 29 }
        XCTAssertEqual(try records(session).count, 2)
    }

    func testMissingArchiveSeekCompletionRequiresViewerChoice() async throws {
        let session = SportsSession(seekArchive: { _, _ in })
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        let archive = try await mappedOpen(session)
        try await waitFor("An unacknowledged seek should time out") { session.problem != nil }
        XCTAssertFalse(player.isPlaying)
        XCTAssertTrue(try records(session).first?["confirmed"] is NSNull)
        session.open(archive)
        try await waitFor("Starting from the beginning should play without an archive seek") { session.playing }
        XCTAssertLessThan(player.currentTime, 5)
        XCTAssertEqual(try records(session).count, 1)
    }

    func testFaultAfterEstablishedHandoffRetriesLatestArchivePositionWithoutNewRecord() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        _ = try await mappedOpen(session)
        try await waitFor("Initial handoff should be confirmed") { (try? self.records(session).first?["confirmed"]) is [String: Any] }
        player.pause()
        try await waitFor("Archive must pause before skipping") { !session.playing }
        player.seek(time: 90)
        try await waitFor("The current archive position must reach 90 seconds") { abs((session.position ?? 0) - 90) < 1 }
        session.failed("Fixture source failure")
        session.retry()
        try await waitFor("The source-only recovery should retain paused intent at 90 seconds") {
            session.ready && !player.isPlaying && abs(player.currentTime - 90) < 1
        }
        let rows = try records(session)
        XCTAssertEqual(rows.count, 1)
        XCTAssertNotNil(rows.first?["confirmed"] as? [String: Any])
    }

    func testRetryFromArchiveEndAllowsReplayWithoutAnotherHandoff() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        _ = try await mappedOpen(session)
        try await waitFor("Archive handoff is established") { (try? self.records(session).first?["confirmed"]) is [String: Any] }
        player.seek(time: player.duration - 1)
        try await waitFor("The archive should play through its final frame") { session.diagnostics.contains("Finished") }
        session.failed("Fixture fault at EOF")
        session.retry()
        try await waitFor("The completed archive should reopen at its beginning") {
            session.ready && session.problem == nil && player.currentTime < 5
        }
        player.play()
        try await waitFor("The archive can be replayed") { session.playing && player.currentTime > 0 }
        // Also exercise a final SDK position arriving before its Finished callback.
        session.position = player.duration
        session.failed("Fixture source error on the final frame")
        session.retry()
        try await waitFor("Retry must not seek to the exact duration") { session.playing && player.currentTime < 5 }
        XCTAssertEqual(try records(session).count, 1)
    }

    func testExpiredDVRRestoreCanRejoinLiveEdgeAndPause() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        await session.fetchCatalog()
        guard let event = session.catalog?.events.first(where: { $0.status == "live" }), let path = event.statusUrl else {
            throw XCTSkip("Run while the fixture publisher has an active event to exercise the live DVR edge.")
        }
        session.chooseEvent(event)
        let update = try await Media.fetch(path, as: EventUpdate.self)
        session.update = update
        let live = try XCTUnwrap(session.assets.first { $0.id == event.liveAssetId })
        // Reproduce a timestamp that expired after the original Return transaction.
        let expired = try XCTUnwrap(update.seekableUtcStartMs) - 300_000
        session.open(live, play: false, restoreUTC: expired)
        try await waitFor("The current native window must reject the saved frame") {
            session.notice != nil && session.ready
        }
        XCTAssertFalse(player.isPlaying)
        session.rejoinLiveEdge()
        try await waitFor("The explicit Live edge choice should play") { session.playing && player.isPlaying }
        XCTAssertNil(session.notice)
        player.pause()
        try await waitFor("The app’s pause state must agree with the native player") {
            !session.playing && !session.desiredPlayback && !player.isPlaying
        }
        player.play()
        try await waitFor("The same source remains playable after pausing") { session.playing && player.isPlaying }
    }

    func testClipSeekAndPauseKeepSource() async throws {
        let session = SportsSession()
        let player = try XCTUnwrap(session.player, "Set the allowed Player license before running the Playback scheme.")
        defer { player.destroy() }
        await session.fetchCatalog()
        let clip = try XCTUnwrap(session.assets.first { $0.id == "SP-CLIP-A" })
        session.open(clip)
        try await waitFor("The HLS clip should play.") { session.playing && (session.position ?? 0) > 0 }
        let warning = SourceWarningEvent(code: .subtitleLoadingFailed, message: "Fixture caption warning", data: nil)
        session.onSourceWarning(warning, player: player)
        XCTAssertTrue(session.diagnostics.last?.contains("2004") == true)
        XCTAssertNil(session.problem)
        XCTAssertTrue(session.ready)
        XCTAssertTrue(session.playing)
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
