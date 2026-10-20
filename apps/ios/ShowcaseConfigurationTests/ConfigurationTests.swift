import BitmovinPlayer
import XCTest

final class ConfigurationTests: XCTestCase {
    func testDraftPreservesStartupDefaultsAndAutomaticSourceOffset() throws {
        let settings = try ConfigurationDraft().validated()
        let source = settings.source.makeSourceConfig()
        let player = PlayerConfig()
        settings.player.apply(to: player)

        XCTAssertFalse(player.playbackConfig.isAutoplayEnabled)
        XCTAssertTrue(player.playbackConfig.isMuted)
        XCTAssertTrue(player.playbackConfig.isTimeShiftEnabled)
        XCTAssertEqual(player.adaptationConfig.maxSelectableBitrate, 0)
        XCTAssertEqual(player.bufferConfig.audioAndVideo.forwardDuration, 0)
        XCTAssertTrue(source.options.startOffset.isNaN)
        XCTAssertEqual(source.options.startOffsetTimelineReference, .auto)
    }

    func testSourceConfigurationCarriesMetadataAndSignedOffset() throws {
        var draft = ConfigurationDraft()
        draft.sourceURL = " https://example.com/movie.mp4 "
        draft.sourceType = .progressive
        draft.title = "Example movie"
        draft.posterURL = "https://example.com/poster.jpg"
        draft.startOffset = "-35.5"
        draft.timelineReference = .end
        let config = try draft.validated().source.makeSourceConfig()

        XCTAssertEqual(config.url.absoluteString, "https://example.com/movie.mp4")
        XCTAssertEqual(config.type, .progressive)
        XCTAssertEqual(config.title, "Example movie")
        XCTAssertEqual(config.posterSource?.absoluteString, draft.posterURL)
        XCTAssertEqual(config.options.startOffset, -35.5)
        XCTAssertEqual(config.options.startOffsetTimelineReference, .end)
        // The SDK corrects offsets against stream boundaries; the editor does not invent sign limits.
        draft.timelineReference = .start
        XCTAssertNoThrow(try draft.validated())
    }

    func testPlayerConfigurationMapsExplicitUnits() throws {
        var draft = ConfigurationDraft()
        draft.autoplay = true
        draft.startMuted = false
        draft.sdkTimeShiftEnabled = false
        draft.maximumBitrate = "2500000"
        draft.forwardBuffer = "12.5"
        let config = PlayerConfig()
        try draft.validated().player.apply(to: config)
        XCTAssertTrue(config.playbackConfig.isAutoplayEnabled)
        XCTAssertFalse(config.playbackConfig.isMuted)
        XCTAssertFalse(config.playbackConfig.isTimeShiftEnabled)
        XCTAssertEqual(config.adaptationConfig.maxSelectableBitrate, 2_500_000)
        XCTAssertEqual(config.bufferConfig.audioAndVideo.forwardDuration, 12.5)
    }

    func testInvalidURLsAndNumbersAreRejected() {
        let invalidFields: [(WritableKeyPath<ConfigurationDraft, String>, String)] = [
            (\.sourceURL, ""), (\.sourceURL, "file:///tmp/movie.mp4"),
            (\.sourceURL, "https:///"), (\.posterURL, "not a URL"),
            (\.startOffset, "NaN"), (\.startOffset, "inf"),
            (\.maximumBitrate, "-1"), (\.maximumBitrate, "2.5"),
            (\.maximumBitrate, "18446744073709551616"),
            (\.forwardBuffer, "-0.5"), (\.forwardBuffer, "infinity")
        ]
        for (field, value) in invalidFields {
            var draft = ConfigurationDraft()
            draft[keyPath: field] = value
            XCTAssertThrowsError(try draft.validated(), "Accepted invalid value: \(value)")
        }
    }

    @MainActor
    func testInvalidAndUnchangedApplyKeepPlayerAndSource() throws {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        model.load(Sources.all[1])
        let player = model.player
        let generation = model.playerGeneration
        let applied = model.configurationDraft
        var invalid = applied
        invalid.sourceURL = "invalid"
        invalid.autoplay.toggle()

        XCTAssertThrowsError(try model.apply(invalid))
        XCTAssertTrue(model.player === player)
        XCTAssertEqual(model.playerGeneration, generation)
        XCTAssertEqual(model.configurationDraft, applied)
        XCTAssertEqual(try model.apply(applied), .none)
        XCTAssertTrue(model.player === player)
    }

    @MainActor
    func testSourceReloadAndPlayerRecreationRetainFullConfiguration() throws {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        #if !os(tvOS)
        model.setUiMode(.cinema)
        #endif
        model.timeShiftEnabled = false
        var draft = model.configurationDraft
        draft.sourceURL = "https://example.com/custom.m3u8"
        draft.title = "Custom source"
        draft.posterURL = "https://example.com/poster.png"
        draft.startOffset = "-10"
        draft.timelineReference = .end
        let initialPlayer = model.player
        XCTAssertEqual(try model.apply(draft), .reloadSource)
        XCTAssertTrue(model.player === initialPlayer)
        let source = model.sourceSettings
        let generation = model.playerGeneration

        draft.maximumBitrate = "4000000"
        XCTAssertEqual(try model.apply(draft), .recreatePlayer)
        XCTAssertFalse(model.player === initialPlayer)
        XCTAssertTrue(initialPlayer.isDestroyed)
        XCTAssertNotEqual(model.playerGeneration, generation)
        XCTAssertEqual(model.sourceSettings, source)
        XCTAssertEqual(model.configurationDraft, draft)
        XCTAssertFalse(model.timeShiftEnabled)
        XCTAssertEqual(model.player.config.adaptationConfig.maxSelectableBitrate, 4_000_000)
        #if !os(tvOS)
        XCTAssertEqual(model.uiMode, .cinema)
        #endif
    }
}
