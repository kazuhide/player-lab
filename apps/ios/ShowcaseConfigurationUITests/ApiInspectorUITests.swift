import XCTest

/// Uses the real SDK and checks effective state separately from invocation messages.
final class ApiInspectorUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        let app = XCUIApplication()
        #if os(tvOS)
        captureAccessibility(app, named: "native-workspace-tv-final-accessibility")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-tv-final-screen", test: self)
        #endif
        app.terminate()
    }

    func testVolumeOperationStateAndNativeFullscreenHost() throws {
        let app = XCUIApplication()
        app.launch()
        try WorkspaceUITestNavigation.choose("VOD HLS", picker: "source.preset", in: app)
        XCTAssertTrue(app.buttons["api.open"].waitForExistence(timeout: 20))
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try selectOperation("Player.volume", search: "volume", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.argument.value"], with: "42", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.open"], in: app)
        XCTAssertFalse(app.buttons["api.run"].exists, "Inactive command footers must leave the rendered accessibility tree")
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        XCTAssertEqual(app.textFields["api.argument.value"].value as? String, "42", "Tab changes retain the selected API argument")
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.volume"))
        try WorkspaceUITestNavigation.activate(app.buttons["api.run"], in: app)
        XCTAssertTrue(app.staticTexts["api.result"].label.contains("Player.volume invoked"))
        XCTAssertEqual(app.staticTexts["api.related.Player.volume"].label, "42")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-api-volume-result", test: self)

        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["State"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.state.filter"], with: "Player.volume", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
        XCTAssertEqual(app.staticTexts["api.state.Player.volume"].label, "42")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-api-sdk-state", test: self)

        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["Host"], in: app)
        try WorkspaceUITestNavigation.choose("Native PlayerView host", picker: "api.host.setting", in: app)
        try WorkspaceUITestNavigation.activate(app.switches["api.nativeHost"], in: app)
        XCTAssertEqual(app.switches["api.nativeHost"].value as? String, "1")

        #if !os(tvOS)
        // Complete the real fullscreen handoff before the miniature cycle. State
        // identity checks then use the read-only list without reopening a keyboard.
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["Operations"], in: app)
        try selectOperation("UserInterfaceApi.enterFullscreen()", search: "enterFullscreen", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.run"], in: app)
        let exit = app.buttons["api.fullscreen.exit"]
        XCTAssertTrue(exit.waitForExistence(timeout: 10))
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-native-fullscreen", test: self)
        exit.tap()
        XCTAssertTrue(app.buttons["api.open"].waitForExistence(timeout: 10))
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["Host"], in: app)
        try WorkspaceUITestNavigation.choose("Native PlayerView host", picker: "api.host.setting", in: app)
        XCTAssertEqual(app.switches["api.nativeHost"].value as? String, "1")
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["Operations"], in: app)
        try selectOperation("Player.volume", search: "volume", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.argument.value"], with: "42", in: app)
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["State"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.state.filter"], with: "events", in: app)
        app.buttons["api.refresh"].tap()
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-event-list-viewport", test: self)
        let original = try eventIdentities(in: app)
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.title"], with: "Unapplied preview draft", in: app)
        try WorkspaceUITestNavigation.choose("Advanced SDK", picker: "configuration.category", in: app)
        let sdkSurface = app.descendants(matching: .any).matching(identifier: "playback.sdk.surface").firstMatch
        captureAccessibility(app, named: "native-workspace-mini-accessibility")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-mini-player", test: self)
        XCTAssertTrue(app.buttons["playback.compact.toggle"].isHittable)
        XCTAssertGreaterThanOrEqual(app.buttons["playback.compact.toggle"].frame.height, 44)
        XCTAssertEqual(sdkSurface.descendants(matching: .button).count, 0, "Miniature SDK controls must be absent from accessibility")
        try WorkspaceUITestNavigation.activate(app.buttons["playback.preview.expand"], in: app)
        XCTAssertTrue(app.buttons["playback.preview.collapse"].isHittable)
        XCTAssertEqual(app.staticTexts["source.current"].label, "VOD HLS")
        captureAccessibility(app, named: "native-workspace-expanded-accessibility")
        XCTAssertGreaterThan(sdkSurface.descendants(matching: .button).count, 0, "Expanded SDK controls are a positive accessibility control")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-expanded-player", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["playback.preview.collapse"], in: app)
        XCTAssertTrue(app.buttons["playback.preview.expand"].isHittable)
        XCTAssertEqual(sdkSurface.descendants(matching: .button).count, 0)
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "Unapplied preview draft")
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.reset"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["Operations"], in: app)
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.volume"))
        XCTAssertEqual(app.textFields["api.argument.value"].value as? String, "42")
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["State"], in: app)
        XCTAssertEqual(try eventIdentities(in: app), original, "Miniature, expansion and collapse retain the real SDK player/source/view objects")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["api.refresh"].isHittable)
        let rotated = try eventIdentities(in: app)
        XCTAssertEqual(rotated, original, "Rotation retains the real SDK player/source/view objects")
        XCUIDevice.shared.orientation = .portrait
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["Host"], in: app)
        try WorkspaceUITestNavigation.choose("Native PlayerView host", picker: "api.host.setting", in: app)
        XCTAssertEqual(app.switches["api.nativeHost"].value as? String, "1")
        #endif
    }

    private func captureAccessibility(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(string: app.debugDescription)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    #if !os(tvOS)
    private func eventIdentities(in app: XCUIApplication) throws -> [String: String] {
        XCTAssertEqual(app.textFields["api.state.filter"].value as? String, "events")
        try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
        let list = app.descendants(matching: .any).matching(identifier: "api.form").firstMatch
        XCTAssertTrue(list.exists)
        XCTAssertGreaterThan(list.frame.height, 0)
        list.swipeDown()
        var values: [String: String] = [:]
        for id in ["Player.events", "Source.events", "PlayerView.events"] {
            let row = app.staticTexts["api.state.\(id)"]
            // These are read-only SDK observations. Materialize lazy rows with a
            // bounded list gesture at narrow landscape heights; no setting scrolls.
            for _ in 0..<3 {
                if row.exists && row.isHittable { break }
                list.swipeUp()
            }
            XCTAssertTrue(row.exists, "The exact SDK identity must be materialized")
            XCTAssertTrue(row.isHittable)
            values[id] = row.label
        }
        return values
    }
    #endif

    private func selectOperation(_ id: String, search: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation"], in: app)
        XCTAssertTrue(app.textFields["api.operation.filter"].waitForExistence(timeout: 5), "The operation chooser must remain open before typing")
        XCTAssertTrue(app.segmentedControls["api.pane"].buttons["Operations"].isSelected)
        try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: search, in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation.select.\(id)"], in: app)
    }
}
