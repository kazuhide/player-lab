#if !os(tvOS)
import XCTest

/// Opt-in real app checks. These exercise track discovery, not completed offline downloads.
final class NativeWorkbenchUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    func testSubtitleArrayEditorAppliesTypedSdkTracks() throws {
        let app = XCUIApplication()
        app.launch()
        try WorkspaceUITestNavigation.setting("configuration.sourceURL", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.sourceURL"],
            with: "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8", in: app)
        try editAdvanced("SourceConfig.tracks", value: "[{\"identifier\":\"manual-example\",\"label\":\"Manual English\",\"language\":\"en\",\"url\":null}]", in: app)
        capture(app, name: "iOS-source-subtitle-array-editor")
        XCTAssertTrue(app.buttons["configuration.apply"].isEnabled)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        try openState("Player.availableSubtitles", in: app)
        let subtitles = app.staticTexts["api.state.Player.availableSubtitles"]
        for _ in 0..<20 {
            try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
            if subtitles.exists && subtitles.label.contains("manual-example") { break }
        }
        XCTAssertTrue(subtitles.exists)
        XCTAssertTrue(subtitles.label.contains("manual-example"), subtitles.label)
        capture(app, name: "iOS-source-subtitle-array-sdk-state")
    }

    func testCallbackEditorAndOfflineTrackDiscoveryUseRealSdkObjects() throws {
        let app = XCUIApplication()
        app.launch()
        try WorkspaceUITestNavigation.setting("configuration.sourceURL", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.sourceURL"],
            with: "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8", in: app)
        try WorkspaceUITestNavigation.setting("configuration.autoplay", in: app)
        let autoplay = app.switches["configuration.autoplay"]
        if autoplay.value as? String == "0" { try WorkspaceUITestNavigation.activate(autoplay, in: app) }
        try editAdvanced("LabelingConfig.audioLabel", value: "return 'GUI ' + input.label;", in: app)
        capture(app, name: "iOS-editable-audio-label-callback")
        XCTAssertTrue(app.buttons["configuration.apply"].isEnabled)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        try openState("Callback.Source.LabelingConfig.audioLabel", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
        let callback = app.staticTexts["api.state.Callback.Source.LabelingConfig.audioLabel"]
        XCTAssertTrue(callback.waitForExistence(timeout: 30))
        XCTAssertTrue(callback.label.contains("failures: 0"), callback.label)
        capture(app, name: "iOS-configured-label-callback-status")
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.initialize.default"], in: app)
        try WorkspaceUITestNavigation.choose("Asset", picker: "offline.section", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.create"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["offline.fetchTracks"], in: app)
        try WorkspaceUITestNavigation.choose("Download settings", picker: "offline.section", in: app)
        try WorkspaceUITestNavigation.choose("Tracks", picker: "offline.download.setting", in: app)
        let track = app.switches.matching(NSPredicate(format: "identifier BEGINSWITH %@", "offline.track.")).firstMatch
        XCTAssertTrue(track.waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["offline.error"].exists)
        capture(app, name: "iOS-offline-sdk-track-selection")
    }

    private func editAdvanced(_ id: String, value: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.choose("Advanced SDK", picker: "configuration.category", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["advanced.filter"], with: id, in: app)
        try WorkspaceUITestNavigation.activate(app.switches["advanced.\(id).enabled"], in: app)
        let editor = app.textViews["advanced.\(id).value"]
        let visible = editor.frame.intersection(app.scrollViews["advanced.editor"].frame)
        XCTAssertGreaterThanOrEqual(visible.height, 64, "The selected normal-font SDK editor must be usable without scrolling")
        XCTAssertGreaterThanOrEqual(visible.width, 160)
        try WorkspaceUITestNavigation.replace(editor, with: value, in: app)
    }

    private func openState(_ filter: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["State"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.state.filter"], with: filter, in: app)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        WorkspaceUITestNavigation.capture(app, named: name, test: self)
    }
}
#endif
