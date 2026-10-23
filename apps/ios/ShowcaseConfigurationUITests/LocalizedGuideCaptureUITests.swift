import XCTest

/// Real app screenshots use the platform's application-language setting.
/// SDK names, source data and generated code are deliberately not translated.
final class LocalizedGuideCaptureUITests: XCTestCase {
    private var language: String {
        ProcessInfo.processInfo.environment["PLAYER_LAB_GUIDE_LANGUAGE"] == "ja" ? "ja" : "en"
    }
    private let mediaURL = "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8"

    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        WorkspaceUITestNavigation.launch(app, language: language)
        XCTAssertTrue(app.buttons["configuration.open"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.buttons["configuration.open"].label, language == "ja" ? "設定" : "Settings")
        return app
    }

    #if !os(tvOS)
    func testPhoneSourceCodeAndApiScreens() throws {
        let app = launch()
        try prepareSource(in: app)
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        capture("ios-playback-tracks", app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.code.toggle"], in: app)
        let code = app.staticTexts["configuration.code.text"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        XCTAssertTrue(code.label.contains("YOUR_PLAYER_KEY"))
        XCTAssertTrue(code.label.contains("PlayerConfig"))
        capture("ios-applied-code", app)
        try openVolume(in: app)
        capture("ios-api-operation", app)
        try openState("Player.volume", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
        XCTAssertEqual(app.staticTexts["api.state.Player.volume"].label, "42")
        capture("ios-api-volume-state", app)
    }

    func testSourceObjectsCallbackAndOfflineScreens() throws {
        let app = launch()
        try prepareSource(in: app)
        try editAdvanced("SourceConfig.tracks", value: "[{\"identifier\":\"manual-example\",\"label\":\"Manual English\",\"language\":\"en\",\"url\":null}]", in: app)
        capture("ios-subtitle-array-editor", app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        try openState("Player.availableSubtitles", in: app)
        try waitForState("Player.availableSubtitles", containing: "manual-example", in: app)
        capture("ios-subtitle-array-sdk-state", app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.open"], in: app)
        try editAdvanced("LabelingConfig.audioLabel", value: "return 'GUI ' + input.label;", in: app)
        capture("ios-callback-editor", app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        try openState("Callback.Source.LabelingConfig.audioLabel", in: app)
        try waitForState("Callback.Source.LabelingConfig.audioLabel", containing: "Calls:", in: app)
        let callback = app.staticTexts["api.state.Callback.Source.LabelingConfig.audioLabel"].label
        XCTAssertFalse(callback.contains("Calls: 0;"), callback)
        XCTAssertTrue(callback.contains("; failures: 0."), callback)
        capture("ios-callback-sdk-status", app)
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.initialize.default"], in: app)
        try WorkspaceUITestNavigation.choose("Asset", picker: "offline.section", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.create"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.fetchTracks"], in: app)
        try WorkspaceUITestNavigation.choose("Download settings", picker: "offline.section", in: app)
        try WorkspaceUITestNavigation.choose("Tracks", picker: "offline.download.setting", in: app)
        XCTAssertTrue(app.switches.matching(NSPredicate(format: "identifier BEGINSWITH %@", "offline.track.")).firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["offline.error"].exists)
        capture("ios-offline-track-selection", app)
    }

    func testCastScreens() throws {
        let app = launch()
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["cast.open"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["cast.applicationId"], with: "FFE417E5", in: app)
        capture("ios-cast-options", app)
        try WorkspaceUITestNavigation.activate(app.buttons["cast.run"], in: app)
        XCTAssertFalse(app.staticTexts["cast.error"].exists)
        try WorkspaceUITestNavigation.choose("State", picker: "cast.section", in: app)
        XCTAssertEqual(app.staticTexts["cast.state.BitmovinCastManager.isInitialized()"].label, "true")
        capture("ios-cast-sdk-state", app)
        try WorkspaceUITestNavigation.choose("Receiver settings", picker: "cast.section", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["cast.startup.disable"], in: app)
    }

    func testTabletInitialTracksAndScalingScreens() throws {
        let app = launch()
        try prepareSource(in: app, initialTracks: true)
        try WorkspaceUITestNavigation.setting("configuration.audioLanguage", in: app)
        XCTAssertEqual(app.textFields["configuration.audioLanguage"].value as? String, "de")
        capture("ios-initial-tracks", app)
        try WorkspaceUITestNavigation.setting("configuration.videoScaling", in: app)
        try WorkspaceUITestNavigation.choose("Fill (crop)", picker: "configuration.videoScaling", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        capture("ios-video-scaling", app)
    }
    #else
    func testTelevisionSettingsCodeAndApiScreens() throws {
        let app = launch()
        try prepareSource(in: app, initialTracks: true)
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        capture("tvos-playback-tracks", app)
        try WorkspaceUITestNavigation.setting("configuration.audioLanguage", in: app)
        capture("tvos-initial-tracks", app)
        try WorkspaceUITestNavigation.setting("configuration.videoScaling", in: app)
        try WorkspaceUITestNavigation.choose("Fill (crop)", picker: "configuration.videoScaling", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        capture("tvos-video-scaling", app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.code.toggle"], in: app)
        XCTAssertTrue(app.buttons["configuration.open"].exists)
        capture("tvos-applied-code", app)
        try openVolume(in: app)
        try openState("Player.volume", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
        XCTAssertEqual(app.staticTexts["api.state.Player.volume"].label, "42")
        capture("tvos-api-state", app)
    }
    #endif

    private func prepareSource(in app: XCUIApplication, initialTracks: Bool = false) throws {
        try WorkspaceUITestNavigation.setting("configuration.sourceURL", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.sourceURL"], with: mediaURL, in: app)
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.title"], with: "Player Lab VOD", in: app)
        try WorkspaceUITestNavigation.setting("configuration.autoplay", in: app)
        let autoplay = app.switches["configuration.autoplay"]
        if autoplay.value as? String == "0" { try WorkspaceUITestNavigation.activate(autoplay, in: app) }
        if initialTracks {
            try WorkspaceUITestNavigation.setting("configuration.audioLanguage", in: app)
            try WorkspaceUITestNavigation.replace(app.textFields["configuration.audioLanguage"], with: "de", in: app)
            try WorkspaceUITestNavigation.setting("configuration.subtitleMode", in: app)
            try WorkspaceUITestNavigation.choose("Preferred language", picker: "configuration.subtitleMode", in: app)
            try WorkspaceUITestNavigation.setting("configuration.subtitleLanguage", in: app)
            try WorkspaceUITestNavigation.replace(app.textFields["configuration.subtitleLanguage"], with: "de", in: app)
        }
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        try openState("Player.isPlaying", in: app)
        try waitForState("Player.isPlaying", containing: "true", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.open"], in: app)
    }

    private func openVolume(in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try pane("Operations", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: "Player.volume", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation.select.Player.volume"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.argument.value"], with: "42", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.run"], in: app)
        XCTAssertEqual(app.staticTexts["api.related.Player.volume"].label, "42")
    }

    private func pane(_ value: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["api.pane.\(value)"], in: app)
    }

    private func openState(_ filter: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try pane("State", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.state.filter"], with: filter, in: app)
    }

    private func waitForState(_ id: String, containing text: String, in app: XCUIApplication) throws {
        for _ in 0..<30 {
            try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
            let value = app.staticTexts["api.state.\(id)"]
            if value.exists && value.label.contains(text) { return }
        }
        XCTFail("SDK state \(id) must contain \(text)")
    }

    #if !os(tvOS)
    private func editAdvanced(_ id: String, value: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.choose("Advanced SDK", picker: "configuration.category", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["advanced.filter"], with: id, in: app)
        try WorkspaceUITestNavigation.activate(app.switches["advanced.\(id).enabled"], in: app)
        try WorkspaceUITestNavigation.replace(app.textViews["advanced.\(id).value"], with: value, in: app)
    }
    #endif

    private func capture(_ name: String, _ app: XCUIApplication) {
        WorkspaceUITestNavigation.capture(app, named: "\(name)-\(language)", test: self)
        let receipt = XCTAttachment(string: "Application language: \(language)\nSettings label: \(app.buttons["configuration.open"].exists ? app.buttons["configuration.open"].label : "inspector")")
        receipt.name = "\(name)-\(language)-locale"
        receipt.lifetime = .keepAlways
        add(receipt)
    }
}
