import XCTest
import Combine
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

    func testManualAndNaturalTransitionsCarryCurrentPreferences() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let first = try XCTUnwrap(session.lessons.first)
        let second = try XCTUnwrap(session.lessons.dropFirst().first)
        let keys = [first, second].map { Progress.key(learner: "A", lesson: $0.id) }
        let previous = keys.map { UserDefaults.standard.data(forKey: $0) }
        defer {
            session.closeLesson()
            player.destroy()
            for (key, data) in zip(keys, previous) { UserDefaults.standard.set(data, forKey: key) }
        }

        let different = try JSONEncoder().encode(Progress(seconds: 7, speed: 0.5, language: "ja", standard: true))
        UserDefaults.standard.set(different, forKey: keys[1])
        session.open(first, resume: false)
        try await waitFor("First lesson playing") { session.playing }
        let warning = SourceWarningEvent(code: .subtitleLoadingFailed, message: "Fixture caption warning", data: nil)
        session.onSourceWarning(warning, player: player)
        XCTAssertTrue(session.diagnostics.last?.contains("2004") == true)
        XCTAssertNil(session.problem)
        XCTAssertTrue(session.ready)
        XCTAssertTrue(session.playing)
        session.setSpeed(1.5)
        session.setCaptions("")
        session.standardControls = false

        func checkPreferences() {
            XCTAssertEqual(player.playbackSpeed, 1.5)
            XCTAssertEqual(session.speed, 1.5)
            XCTAssertEqual(session.captionLanguage, "")
            XCTAssertNil(player.subtitle.language)
            XCTAssertFalse(session.standardControls)
        }

        session.open(second, resume: false, origin: "playlist")
        try await waitFor("Manual next should play") { session.playing && (session.position ?? 0) > 0 }
        checkPreferences()
        session.autoAdvance = true
        session.open(first, resume: false, origin: "playlist")
        try await waitFor("Manual previous should play") { session.playing && (session.position ?? 0) > 0 }
        checkPreferences()
        UserDefaults.standard.set(different, forKey: keys[1])
        player.seek(time: player.duration - 2)
        try await waitFor("Natural transition should play the next lesson") {
            session.lesson?.id == second.id && session.playing && (session.position ?? 0) > 0
        }
        checkPreferences()
    }

    func testPausedSeekToZeroReplacesResumeCheckpoint() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        let record = Progress(seconds: 12, speed: 1, language: "en", standard: false)
        UserDefaults.standard.set(try JSONEncoder().encode(record), forKey: key)
        session.open(lesson, resume: true)
        session.save()
        XCTAssertEqual(session.saved(lesson)?.seconds, 12)
        try await waitFor("Checkpoint should resume before the return to the beginning") {
            session.playing && (session.position ?? 0) >= 11
        }
        player.pause()
        try await waitFor("Pause should complete") { !session.playing }
        player.seek(time: 0)
        try await waitFor("An explicit seek to zero should clear the resume offer") {
            session.saved(lesson)?.seconds == 0
        }
        session.closeLesson()
        XCTAssertEqual(session.saved(lesson)?.seconds, 0)
        session.choose(lesson)
        XCTAssertNil(session.resumeChoice)
    }

    func testCompletedLessonKeepsReplayAndSeekAvailable() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.last)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        session.open(lesson, resume: false)
        session.standardControls = false
        try await waitFor("Summary should start") { session.playing }
        player.seek(time: player.duration - 1.5)
        try await waitFor("Summary should finish") { session.diagnostics.contains("Finished") }
        XCTAssertTrue(session.ready)
        session.save()
        XCTAssertEqual(session.saved(lesson)?.seconds, 0)
        player.play()
        try await waitFor("Play should replay the same summary") {
            session.playing && player.currentTime > 0 && player.currentTime < player.duration / 2
        }
        player.pause()
        try await waitFor("Replayed summary should pause") { !session.playing }
        player.seek(time: 3)
        try await waitFor("Seeking the replayed summary should save its new position") {
            abs((session.saved(lesson)?.seconds ?? -1) - 3) < 0.1
        }
    }

    func testRetryPreservesStartOverAndZeroWithoutRestoringOldPreferences() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        for savedPosition in [15.0, 0.0] {
            session.closeLesson()
            let old = Progress(seconds: savedPosition, speed: 0.5, language: "ja", standard: true)
            UserDefaults.standard.set(try JSONEncoder().encode(old), forKey: key)
            session.standardControls = false
            session.captionLanguage = ""
            session.speed = 1.5
            session.open(lesson, resume: false)
            session.failed("Fixture failure before Ready")
            session.retry()
            try await waitFor("Start over must retry from the beginning") { session.playing }
            XCTAssertFalse(session.invalidResume)
            XCTAssertLessThan(player.currentTime, 5)
            XCTAssertEqual(session.speed, 1.5)
            XCTAssertFalse(session.standardControls)
            XCTAssertEqual(session.captionLanguage, "")
        }
    }

    func testRetryOfEstablishedLessonUsesLatestPositionPreferencesAndPause() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        session.open(lesson, resume: false)
        try await waitFor("Initial lesson playback") { session.playing }
        session.standardControls = false
        session.setCaptions("")
        session.setSpeed(1.5)
        player.pause()
        try await waitFor("Lesson paused") { !session.playing }
        player.seek(time: 12)
        try await waitFor("Current source observed a paused 12-second seek") { abs((session.position ?? 0) - 12) < 0.5 }
        session.failed("Fixture later source failure")
        session.retry()
        try await waitFor("Retry must restore the current paused lesson") {
            session.ready && !player.isPlaying && abs(player.currentTime - 12) < 0.5
        }
        XCTAssertEqual(session.speed, 1.5)
        XCTAssertFalse(session.standardControls)
        XCTAssertEqual(session.captionLanguage, "")
    }

    func testNewSeekDuringResumeSavesItsActualLanding() async throws {
        // Model a transcript seek superseding the 12-second request before it completes.
        let session = LearningSession(seekResume: { player, _ in player.seek(time: 20) })
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        let old = Progress(seconds: 12, speed: 1, language: "", standard: false)
        UserDefaults.standard.set(try JSONEncoder().encode(old), forKey: key)
        session.open(lesson, resume: true)
        try await waitFor("The superseding native seek should permit playback and checkpointing at 20 seconds") {
            session.playing && (session.saved(lesson)?.seconds ?? 0) >= 19
        }
        player.pause()
        try await waitFor("Pause must finish at the new cue") { !session.playing }
        session.closeLesson()
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(session.saved(lesson)?.seconds), 19)
    }

    func testUnacknowledgedResumeStopsAndCanRetryItsOriginalCheckpoint() async throws {
        var allowSeek = false
        let session = LearningSession(seekResume: { player, seconds in
            if allowSeek { player.seek(time: seconds) }
        })
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        let checkpoint = Progress(seconds: 12, speed: 1.5, language: "", standard: false)
        UserDefaults.standard.set(try JSONEncoder().encode(checkpoint), forKey: key)
        session.open(lesson, resume: true)
        try await waitFor("Resume must report an unacknowledged seek") { session.problem != nil }
        XCTAssertFalse(player.isPlaying)
        XCTAssertEqual(session.saved(lesson)?.seconds, 12)
        allowSeek = true
        session.retry()
        try await waitFor("Retry must reach the original resume checkpoint") {
            session.playing && abs(player.currentTime - 12) < 1
        }
        XCTAssertEqual(session.speed, 1.5)
        XCTAssertFalse(session.standardControls)
    }

    func testClosingAtNativeZeroBeforeQueuedSeekedSavesRealRewind() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: "A", lesson: lesson.id)
        let previous = UserDefaults.standard.data(forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(previous, forKey: key)
        }
        let old = Progress(seconds: 12, speed: 1, language: "", standard: false)
        UserDefaults.standard.set(try JSONEncoder().encode(old), forKey: key)
        var closing = false
        // The SDK emits on the main thread; the session dispatches its handler
        // asynchronously. Close synchronously between those two steps.
        let event = player.events.on(SeekedEvent.self).sink { _ in
            guard closing, player.currentTime == 0 else { return }
            XCTAssertTrue(Thread.isMainThread)
            XCTAssertGreaterThan(session.saved(lesson)?.seconds ?? 0, 0)
            session.closeLesson()
        }
        defer { event.cancel() }
        session.open(lesson, resume: true)
        try await waitFor("Established positive source position") { session.playing && (session.position ?? 0) >= 11 }
        player.pause()
        try await waitFor("Pause before rewind") { !session.playing }
        closing = true
        player.seek(time: 0)
        try await waitFor("Back must close the lesson") { session.lesson == nil }
        XCTAssertEqual(session.saved(lesson)?.seconds, 0)
    }

    func testCourseSelectionBelongsToEachLearner() async throws {
        let session = LearningSession()
        defer { session.player?.destroy() }
        await session.fetchCatalog()
        let catalog = try XCTUnwrap(session.catalog)
        let first = try XCTUnwrap(catalog.courses.first)
        let second = Course(id: "course-two", title: "Course two", titleJa: nil, lessonIds: Array(first.lessonIds.reversed()))
        session.catalog = CourseCatalog(courses: [first, second], lessons: catalog.lessons)
        session.chooseCourse(second)
        XCTAssertEqual(session.lessons.map(\.id), second.lessonIds)
        session.selectLearner("B")
        XCTAssertEqual(session.course?.id, first.id)
        XCTAssertEqual(session.lessons.map(\.id), first.lessonIds)
        session.selectLearner("A")
        XCTAssertEqual(session.course?.id, second.id)
        XCTAssertEqual(session.lessons.map(\.id), second.lessonIds)
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
        let cue = try XCTUnwrap(session.transcript?.view(query: "compare", language: "en", seconds: nil, follow: false).rows.first?.cue)
        player.seek(time: cue.startMs / 1000)
        try await waitFor("A paused cue seek should reach 10 seconds.") { abs(player.currentTime - 10) < 1 }
        session.save()
        XCTAssertTrue(player.source === source)
        XCTAssertFalse(session.playing)
        XCTAssertNil(player.subtitle.language)
        session.autoAdvance = true
        session.selectLearner("B")
        XCTAssertFalse(session.autoAdvance)
        XCTAssertTrue(session.diagnostics.isEmpty)
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
