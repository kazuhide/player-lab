import XCTest
import Combine
import BitmovinPlayer
#if os(iOS)
@testable import Learning_iOS
#else
@testable import Learning_tvOS
#endif

@MainActor
final class PlaybackLifecycleTests: XCTestCase {
    private func waitFor(_ message: String, _ condition: () -> Bool,
                         file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = Date().addingTimeInterval(15)
        while !condition(), Date() < deadline { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertTrue(condition(), message, file: file, line: line)
        if !condition() { throw URLError(.timedOut) }
    }

    func testBackgroundingBeforeReadyWithdrawsAutoplay() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        defer { session.closeLesson(); player.destroy() }

        let unexpectedPlay = expectation(description: "Canceled open must stay paused after foregrounding")
        unexpectedPlay.isInverted = true
        let observer = player.events.on(PlayEvent.self).sink { _ in unexpectedPlay.fulfill() }
        defer { observer.cancel() }

        session.open(lesson, resume: false)
        XCTAssertFalse(session.ready)
        session.setBackgrounded(true)
        session.setBackgrounded(false)
        try await waitFor("The opened lesson must become ready") { session.ready }
        await fulfillment(of: [unexpectedPlay], timeout: 0.5)
        XCTAssertFalse(session.desiredPlayback)
        XCTAssertFalse(player.isPlaying)
    }

    func testBackgroundingDuringResumeSeekWithdrawsAutoplay() async throws {
        let session = LearningSession()
        let player = try XCTUnwrap(session.player)
        await session.fetchCatalog()
        let lesson = try XCTUnwrap(session.lessons.first)
        let key = Progress.key(learner: session.learner, lesson: lesson.id)
        let old = UserDefaults.standard.data(forKey: key)
        let checkpoint = Progress(seconds: 15, speed: 1, language: "ja", standard: false)
        UserDefaults.standard.set(try JSONEncoder().encode(checkpoint), forKey: key)
        defer {
            session.closeLesson()
            player.destroy()
            UserDefaults.standard.set(old, forKey: key)
        }

        let seekWasInterrupted = expectation(description: "The SDK started the resume seek")
        let unexpectedPlay = expectation(description: "A completed resume seek must honor suspension")
        unexpectedPlay.isInverted = true
        let seek = player.events.on(SeekEvent.self).receive(on: DispatchQueue.main).sink { _ in
            session.setBackgrounded(true)
            session.setBackgrounded(false)
            seekWasInterrupted.fulfill()
        }
        let play = player.events.on(PlayEvent.self).sink { _ in unexpectedPlay.fulfill() }
        defer { seek.cancel(); play.cancel() }

        session.open(lesson, resume: true)
        await fulfillment(of: [seekWasInterrupted], timeout: 15)
        try await waitFor("The SDK must reach the saved position") {
            session.ready && abs((session.position ?? -1) - checkpoint.seconds) < 0.25
        }
        await fulfillment(of: [unexpectedPlay], timeout: 0.5)
        XCTAssertFalse(player.isPlaying)
        XCTAssertFalse(session.desiredPlayback)
    }

    func testJapaneseSubtitleDiscoveredAfterReadyIsSelected() async throws {
        try await checkDelayedSubtitle(selectEnglish: false)
    }

    func testNewSubtitleChoiceSupersedesPendingLanguage() async throws {
        try await checkDelayedSubtitle(selectEnglish: true)
    }

    private func checkDelayedSubtitle(selectEnglish: Bool) async throws {
        let catalog = try await Media.fetch("catalog.json", as: CourseCatalog.self)
        let asset = try XCTUnwrap(catalog.lessons.first)
        let japanese = try XCTUnwrap(asset.subtitleTracks.first { $0.language == "ja" })
        let session = Playback()
        session.replacePlayer()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        session.captionLanguage = "ja"
        session.desiredPlayback = false
        let source = try Media.source(path: asset.streams.hls, title: asset.title, videoId: asset.videoId,
                                      captions: [], isLive: false)
        session.activeSource = source
        session.observe(player)
        player.load(source: source)
        try await waitFor("Source must become ready before subtitle discovery") { session.ready }
        XCTAssertFalse(player.availableSubtitles.contains { $0.language == "ja" })
        XCTAssertNil(player.subtitle.language)

        if selectEnglish {
            let caption = try XCTUnwrap(asset.subtitleTracks.first { $0.language == "en" })
            let english = SubtitleTrack(url: try Media.url(caption.url), format: .webVtt, label: caption.label,
                                       identifier: "selected-english", isDefaultTrack: false, language: "en")
            player.addSubtitle(track: english)
            try await waitFor("English must be available") {
                player.availableSubtitles.contains { $0.identifier == english.identifier }
            }
            player.setSubtitle(trackIdentifier: english.identifier)
            try await waitFor("The current SDK selection must supersede the saved preference") {
                player.subtitle.identifier == english.identifier && session.captionLanguage == "en"
            }
        }
        // The runtime add API lets the real SDK deliver SubtitleAdded after Ready.
        let track = SubtitleTrack(url: try Media.url(japanese.url), format: .webVtt, label: japanese.label,
                                  identifier: "late-japanese", isDefaultTrack: false, language: "ja")
        player.addSubtitle(track: track)
        if selectEnglish {
            try await waitFor("Japanese must be available") {
                player.availableSubtitles.contains { $0.identifier == track.identifier }
            }
            try await Task.sleep(nanoseconds: 200_000_000)
            XCTAssertEqual(player.subtitle.language, "en")
            XCTAssertEqual(session.captionLanguage, "en")
            return
        }
        try await waitFor("The pending language must select the newly discovered track") {
            player.subtitle.identifier == track.identifier && player.subtitle.language == "ja"
        }
        XCTAssertEqual(session.captionLanguage, "ja")
        XCTAssertTrue(session.owns(player))
    }
}
