import XCTest
import BitmovinPlayer
#if os(iOS)
@testable import Learning_iOS
#else
@testable import Learning_tvOS
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

    func testPausedSourceAndIsolatedResume() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player, "Set the allowed Player license before running the Playback scheme.")
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let keys = ["A", "B"].map { Progress.key(learner: $0, lesson: lesson.id) }
        // Preserve the test host's previous records even on assertion failure.
        let previous = keys.map { UserDefaults.standard.data(forKey: $0) }
        for key in keys { UserDefaults.standard.removeObject(forKey: key) }
        defer {
            session.closeLesson()
            session.player?.destroy()
            for (key, data) in zip(keys, previous) { UserDefaults.standard.set(data, forKey: key) }
        }
        session.open(lesson, resume: false)
        try await waitFor("The first HLS lesson should play.") { session.playing && (session.position ?? 0) > 0 }
        player.pause()
        try await waitFor("Pause must be observable.") { !session.playing }
        let source = try XCTUnwrap(session.activeSource)
        session.standardControls = false
        session.setCaptions("")
        let cue = try XCTUnwrap(session.transcript?.search("compare", in: "en").first)
        player.seek(time: cue.startMs / 1000)
        try await waitFor("A paused cue seek should reach 10 seconds.") { abs(player.currentTime - 10) < 1 }
        session.save()
        XCTAssertTrue(player.source === source)
        XCTAssertFalse(session.playing)
        XCTAssertNil(player.subtitle.language)
        session.selectLearner("B")
        XCTAssertFalse(session.player === player)
        XCTAssertNil(session.saved(lesson))
        session.selectLearner("A")
        let progress = try XCTUnwrap(session.saved(lesson))
        XCTAssertEqual(progress.seconds, 10, accuracy: 1)
        XCTAssertEqual(progress.standard, false)
        session.open(lesson, resume: true)
        try await waitFor("The saved lesson should resume from the confirmed seek.") {
            session.playing && (session.position ?? 0) >= 9 && !session.standardControls
        }
    }

}
