import XCTest
import Combine
import BitmovinPlayer
#if os(iOS)
@testable import Sports_iOS
#else
@testable import Sports_tvOS
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
        let session = SportsSession()
        let player = try XCTUnwrap(session.player)
        defer { player.destroy() }
        await session.fetchCatalog()
        let clip = try XCTUnwrap(session.assets.first { $0.kind == "clip" })

        let unexpectedPlay = expectation(description: "Canceled clip open must stay paused after foregrounding")
        unexpectedPlay.isInverted = true
        let observer = player.events.on(PlayEvent.self).sink { _ in unexpectedPlay.fulfill() }
        defer { observer.cancel() }

        session.open(clip)
        XCTAssertFalse(session.ready)
        session.setBackgrounded(true)
        session.setBackgrounded(false)
        try await waitFor("The opened clip must become ready") { session.ready }
        await fulfillment(of: [unexpectedPlay], timeout: 0.5)
        XCTAssertFalse(session.desiredPlayback)
        XCTAssertFalse(player.isPlaying)
    }

    func testJapaneseSubtitleDiscoveredAfterReadyIsSelected() async throws {
        try await checkDelayedSubtitle(selectEnglish: false)
    }

    func testNewSubtitleChoiceSupersedesPendingLanguage() async throws {
        try await checkDelayedSubtitle(selectEnglish: true)
    }

    private func checkDelayedSubtitle(selectEnglish: Bool) async throws {
        let catalog = try await Media.fetch("catalog.json", as: EventCatalog.self)
        let asset = try XCTUnwrap(catalog.assets.first { $0.kind == "clip" })
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
