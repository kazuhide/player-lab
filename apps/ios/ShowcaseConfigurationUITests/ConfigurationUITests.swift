import XCTest

/// Opt-in checks against the real licensed app and SDK configuration consumers.
final class ConfigurationUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    func testDraftValidationResetAndSourceApply() throws {
        let app = XCUIApplication()
        WorkspaceUITestNavigation.launch(app)
        XCTAssertTrue(app.buttons["configuration.open"].waitForExistence(timeout: 20))
        try WorkspaceUITestNavigation.setting("configuration.sourceURL", in: app)
        let sourceURL = app.textFields["configuration.sourceURL"]
        let original = sourceURL.value as? String ?? ""
        try WorkspaceUITestNavigation.replace(sourceURL, with: "invalid", in: app)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        XCTAssertTrue(app.staticTexts["configuration.error"].exists)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.reset"], in: app)
        XCTAssertEqual(sourceURL.value as? String, original)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)

        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        let title = app.textFields["configuration.title"]
        try WorkspaceUITestNavigation.replace(title, with: "Configured source", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Reload source")
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        XCTAssertEqual(app.staticTexts["configuration.status"].label, "Reload source")
        try WorkspaceUITestNavigation.expandPlaybackPreview(in: app)
        XCTAssertEqual(app.staticTexts["source.current"].label, "Configured source")
        XCTAssertEqual(title.value as? String, "Configured source")
        XCTAssertTrue(app.staticTexts["configuration.summary"].label.contains("title"))

        try WorkspaceUITestNavigation.setting("configuration.startMuted", in: app)
        let muted = app.switches["configuration.startMuted"]
        try WorkspaceUITestNavigation.activate(muted, in: app)
        XCTAssertEqual(muted.value as? String, "0")
        try WorkspaceUITestNavigation.setting("configuration.maximumBitrate", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.maximumBitrate"], with: "2500000", in: app)
        try WorkspaceUITestNavigation.setting("configuration.forwardBuffer", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.forwardBuffer"], with: "12.5", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        XCTAssertEqual(app.staticTexts["configuration.status"].label, "Recreate player and reload source")
        try WorkspaceUITestNavigation.expandPlaybackPreview(in: app)
        XCTAssertEqual(app.staticTexts["source.current"].label, "Configured source")
        try WorkspaceUITestNavigation.setting("configuration.maximumBitrate", in: app)
        XCTAssertEqual(app.textFields["configuration.maximumBitrate"].value as? String, "2500000")
        try WorkspaceUITestNavigation.setting("configuration.forwardBuffer", in: app)
        XCTAssertEqual(app.textFields["configuration.forwardBuffer"].value as? String, "12.5")
        try WorkspaceUITestNavigation.setting("configuration.startMuted", in: app)
        XCTAssertEqual(muted.value as? String, "0")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-applied-settings", test: self)
    }
}
