import BitmovinPlayer
import XCTest

final class ConfigurationTests: XCTestCase {
    func testExportedSourceTextStaysDataInsteadOfSwiftInterpolation() throws {
        var source = SourceSettings(Sources.all[0])
        source.title = "A \"quoted\" title\\(mustStayText)\nnext line"
        let code = configurationCode(source: source, player: PlayerSettings(), uiMode: .sports)
        let line = try XCTUnwrap(code.components(separatedBy: "\n").first { $0.hasPrefix("sourceConfig.title = ") })
        let literal = String(line.dropFirst("sourceConfig.title = ".count))
        // These escapes are shared by Swift and JSON, so decoding checks the exact data round trip.
        let decoded = try JSONSerialization.jsonObject(with: Data("[\(literal)]".utf8)) as? [String]
        XCTAssertEqual(decoded, [source.title])
        XCTAssertTrue(code.contains("YOUR_PLAYER_KEY"))
        XCTAssertFalse(code.contains("analyticsConfig:"))
    }

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

    func testScalingAndInitialTrackPreferencesNormalizeWithoutInventingSdkProperties() throws {
        var draft = ConfigurationDraft()
        draft.videoScaling = .fill
        draft.audioLanguage = " DE-at "
        draft.subtitleMode = .language
        draft.subtitleLanguage = " en-US "
        let configuration = try draft.validated()
        let player = PlayerConfig()
        configuration.player.apply(to: player)
        XCTAssertEqual(player.styleConfig.scalingMode, .zoom)
        XCTAssertEqual(configuration.source.initialTracks.audioLanguage, "de-at")
        XCTAssertEqual(configuration.source.initialTracks.subtitleLanguage, "en-us")
        let code = configurationCode(source: configuration.source, player: configuration.player, uiMode: .default)
        XCTAssertTrue(code.contains("playerConfig.styleConfig.scalingMode = .zoom"))
        XCTAssertTrue(code.contains("player.setAudio(trackIdentifier: id)"))
        XCTAssertTrue(code.contains("player.setSubtitle(trackIdentifier: id)"))
        XCTAssertFalse(code.contains("playerConfig.audioLanguage"))
        XCTAssertTrue(code.contains("player.source === event.source"))
        XCTAssertTrue(code.contains("func onReady(_ event: ReadyEvent"))
        XCTAssertTrue(code.contains("guard loaded, ready, !applied"))
        XCTAssertEqual(code.components(separatedBy: "        applyInitialTracks(player)").count - 1, 2)
        XCTAssertLessThan(try XCTUnwrap(code.range(of: "player.setSubtitle(trackIdentifier: id)")?.lowerBound),
                          try XCTUnwrap(code.range(of: "player.setAudio(trackIdentifier: id)")?.lowerBound))
        XCTAssertLessThan(try XCTUnwrap(code.range(of: "player.add(listener: initialTracks)")?.lowerBound),
                          try XCTUnwrap(code.range(of: "player.load(source:")?.lowerBound))
        let example = XCTAttachment(string: code)
        example.name = "initial-tracks-generated.swift"
        example.lifetime = .keepAlways
        add(example)
    }

    func testAutomaticAndOffDoNotExportHiddenSubtitleDraft() throws {
        var draft = ConfigurationDraft()
        draft.subtitleLanguage = "invalid ignored draft"
        var configuration = try draft.validated()
        var code = configurationCode(source: configuration.source, player: configuration.player, uiMode: .default)
        XCTAssertFalse(code.contains("class InitialTracks"))
        XCTAssertNil(configuration.source.initialTracks.subtitleLanguage)
        draft.subtitleMode = .off
        configuration = try draft.validated()
        code = configurationCode(source: configuration.source, player: configuration.player, uiMode: .default)
        XCTAssertTrue(code.contains("player.setSubtitle(trackIdentifier: nil)"))
        XCTAssertFalse(code.contains("invalid ignored draft"))
        draft.subtitleMode = .language
        XCTAssertThrowsError(try draft.validated())
    }

    @MainActor
    func testLanguageOnlyReloadAndScalingRecreationRetainTheAppliedSource() throws {
        let model = PlayerModel(licenseKey: "configuration-tests-invalid-license")
        defer { model.player.destroy() }
        model.load(Sources.all[1])
        let original = model.player
        var draft = model.configurationDraft
        draft.audioLanguage = "de"
        draft.subtitleMode = .off
        XCTAssertEqual(try model.apply(draft), .reloadSource)
        XCTAssertTrue(model.player === original)
        let source = model.sourceSettings
        draft.videoScaling = .stretch
        XCTAssertEqual(try model.apply(draft), .recreatePlayer)
        XCTAssertTrue(original.isDestroyed)
        XCTAssertEqual(model.sourceSettings, source)
        XCTAssertEqual(model.player.config.styleConfig.scalingMode, .stretch)
        XCTAssertEqual(model.configurationDraft.audioLanguage, "de")
        XCTAssertEqual(model.configurationDraft.subtitleMode, .off)
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
        invalid = applied
        invalid.subtitleMode = .language
        invalid.subtitleLanguage = ""
        XCTAssertThrowsError(try model.apply(invalid))
        XCTAssertTrue(model.player === player)
        XCTAssertEqual(model.configurationDraft, applied)
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
        draft.audioLanguage = "de"
        draft.subtitleMode = .language
        draft.subtitleLanguage = "en"
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
        #if os(tvOS)
        XCTAssertTrue(model.timeShiftEnabled, "The unavailable System UI preference stays aligned with native controls")
        #else
        XCTAssertFalse(model.timeShiftEnabled)
        #endif
        XCTAssertEqual(model.player.config.adaptationConfig.maxSelectableBitrate, 4_000_000)
        XCTAssertEqual(model.sourceSettings?.initialTracks.audioLanguage, "de")
        XCTAssertEqual(model.sourceSettings?.initialTracks.subtitleLanguage, "en")
        #if !os(tvOS)
        XCTAssertEqual(model.uiMode, .cinema)
        #endif
    }
}
