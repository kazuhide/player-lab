import BitmovinPlayer
import XCTest

final class NativePlaylistTests: XCTestCase {
    func testPlaylistSourcesOptionsAndCallbacksUseTheirOwnTypedContexts() throws {
        var draft = ConfigurationDraft()
        draft.sourceURL = "https://example.com/first.m3u8"
        draft.title = "First"
        draft.advancedValues = ["SourceConfig.metadata": "{\"category\":\"first\"}", "LabelingConfig.audioLabel": "return 'First: ' + input.label;"]
        let first = try draft.validated().source
        draft.sourceURL = "https://example.com/second.mp4"
        draft.sourceType = .progressive
        draft.title = "Second"
        draft.advancedValues = ["SourceConfig.sourceDescription": "Second source"]
        let second = try draft.validated().source
        let workbench = NativePlaylistWorkbench()
        workbench.add(first); workbench.add(second)
        workbench.preloadAllSources = true
        workbench.replayMode = "playlist"
        for factory in NativeSourceFactory.allCases {
            workbench.sourceFactory = factory
            let (config, contexts) = try workbench.makeConfiguration()
            XCTAssertEqual(config.sources.count, 2)
            XCTAssertTrue(config.options.preloadAllSources)
            XCTAssertEqual(config.options.replayMode, .playlist)
            XCTAssertEqual(config.sources[0].sourceConfig.url, first.url)
            XCTAssertEqual(config.sources[1].sourceConfig.url, second.url)
            XCTAssertEqual(config.sources[0].sourceConfig.metadata["category"] as? String, "first")
            let audio = AudioTrack(label: "English", identifier: "en", isDefaultTrack: false, language: "en")
            XCTAssertEqual(config.sources[0].sourceConfig.labelingConfig.audioLabel?(audio), "First: English")
            XCTAssertEqual(contexts[0].journal.snapshot.first?.value, "Calls: 1; failures: 0. Returned a valid value")
            XCTAssertTrue(contexts[1].journal.snapshot.isEmpty)
            XCTAssertFalse(config.sources[0] === config.sources[1])
            attachCode(workbench.configurationCode(), name: "native-playlist-\(factory == .current ? "current" : "legacy").swift")
        }
    }

    @MainActor
    func testPlaylistValidationRunsBeforeMutatingTheCurrentPlayer() throws {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        let workbench = model.playlistWorkbench
        let original = model.player
        XCTAssertThrowsError(try workbench.makeConfiguration())
        workbench.index = "-1"
        XCTAssertThrowsError(try workbench.run(.remove, model: model))
        XCTAssertThrowsError(try workbench.run(.insert, model: model))
        workbench.index = "18446744073709551616"
        XCTAssertThrowsError(try workbench.run(.seek, model: model))
        XCTAssertTrue(model.player === original)
        XCTAssertTrue(model.player.playlist.sources.isEmpty)
    }

    private func attachCode(_ code: String, name: String) {
        let attachment = XCTAttachment(data: Data(code.utf8), uniformTypeIdentifier: "public.swift-source")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
