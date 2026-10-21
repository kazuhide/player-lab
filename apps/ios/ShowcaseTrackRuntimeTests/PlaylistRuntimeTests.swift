import BitmovinPlayer
import Combine
import UIKit
import XCTest
#if os(tvOS)
@testable import Showcase_tvOS
#else
@testable import Showcase_iOS
#endif

/// Opt-in licensed qualification; the fixture is public and no account values are logged.
@MainActor
final class PlaylistRuntimeTests: XCTestCase {
    func testRealPlaylistLoadSeekAddInsertRemoveAndReturnToSingleSource() async throws {
        XCTAssertFalse(bitmovinLicenseKey().isEmpty)
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        var draft = model.configurationDraft
        draft.sourceURL = "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8"
        draft.title = "Playlist qualification"
        draft.autoplay = true
        draft.audioLanguage = "en"
        draft.subtitleMode = .off
        draft.advancedValues = ["LabelingConfig.audioLabel": "return input.label;"]
        try model.apply(draft)
        let view = PlayerView(player: model.player, frame: CGRect(x: 0, y: 0, width: 320, height: 180))
        let controller = UIViewController()
        controller.view.addSubview(view)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        defer { view.player = nil; model.player.destroy(); window.isHidden = true }
        let workbench = model.playlistWorkbench
        var trace: [String] = []
        var listeners = Set<AnyCancellable>()
        let observed = model.player
        observed.events.on(ReadyEvent.self).compactMap { [weak observed] _ in observed?.source }.receive(on: DispatchQueue.main).sink { source in
            trace.append("Ready source=\(ObjectIdentifier(source).hashValue)")
        }.store(in: &listeners)
        observed.events.on(PlayingEvent.self).compactMap { [weak observed] _ in observed?.source }.receive(on: DispatchQueue.main).sink { source in
            trace.append("Playing source=\(ObjectIdentifier(source).hashValue)")
        }.store(in: &listeners)
        observed.events.on(PlaylistTransitionEvent.self).receive(on: DispatchQueue.main).sink { event in
            trace.append("Transition from=\(ObjectIdentifier(event.from).hashValue) to=\(ObjectIdentifier(event.to).hashValue)")
        }.store(in: &listeners)
        defer {
            trace.append("Final audio=\(model.player.audio?.language ?? "nil"); source=\(model.player.source.map { ObjectIdentifier($0).hashValue } ?? 0); position=\(model.player.currentTime)")
            let attachment = XCTAttachment(string: trace.joined(separator: "\n"))
            attachment.name = "playlist-source-readiness-trace"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        let source = try XCTUnwrap(model.sourceSettings)
        workbench.add(source)
        var secondDraft = ConfigurationDraft(source: source, player: model.playerSettings)
        secondDraft.audioLanguage = "de"
        workbench.add(try secondDraft.validated().source)
        workbench.preloadAllSources = true
        workbench.replayMode = "playlist"
        try workbench.run(.load, model: model)
        try await eventually("first playlist source and English selection") { model.player.playlist.sources.count == 2 && model.player.source === model.player.playlist.sources[0] && model.player.currentTime > 0.5 && model.player.audio?.language == "en" }
        let second = model.player.playlist.sources[1]
        workbench.index = "1"; workbench.time = "5"
        try workbench.run(.seek, model: model)
        try await eventually("seek to second SDK source and German selection") { model.player.source === second && model.player.currentTime >= 5 && model.player.audio?.language == "de" }
        try await eventually("stable second-source initial selection") { model.player.currentTime >= 6 && model.player.audio?.language == "de" }
        let english = try XCTUnwrap(model.player.availableAudio.first { $0.language == "en" })
        model.player.setAudio(trackIdentifier: english.identifier)
        try await eventually("later user audio choice") { model.player.audio?.language == "en" }
        model.player.pause(); model.player.play()
        try await eventually("later choice retained across resume") { model.player.currentTime >= 6.5 && model.player.audio?.language == "en" }
        workbench.index = "invalid-unused-index"
        try workbench.run(.append, model: model)
        try await eventually("append") { model.player.playlist.sources.count == 3 }
        workbench.index = "1"
        try workbench.run(.insert, model: model)
        try await eventually("insert") { model.player.playlist.sources.count == 4 }
        workbench.index = "0"
        try workbench.run(.remove, model: model)
        try await eventually("remove inactive first source") { model.player.playlist.sources.count == 3 }
        XCTAssertTrue(model.apiEvents.contains { $0.api == "BitmovinPlayerCore.PlaylistTransitionEvent" })
        model.reloadFromApi()
        try await eventually("return to normal configured source and English selection") { model.player.playlist.sources.count == 1 && model.player.currentTime > 0.5 && model.player.audio?.language == "en" }
        XCTAssertEqual(model.sourceSettings?.url, source.url)
        print("Playlist SDK qualification: load, cross-source seek, append, insert, remove and normal-source reload passed")
    }

    private func eventually(_ stage: String, predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if predicate() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out waiting for \(stage)")
        throw QualificationFailure.deadline
    }
    private enum QualificationFailure: Error { case deadline }
}
