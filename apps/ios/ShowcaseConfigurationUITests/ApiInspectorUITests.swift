import XCTest

/// Uses the real SDK and checks effective state separately from invocation messages.
final class ApiInspectorUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

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
        try WorkspaceUITestNavigation.activate(app.segmentedControls["api.pane"].buttons["State"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.state.filter"], with: "events", in: app)
        app.buttons["api.refresh"].tap()
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-event-list-viewport", test: self)
        let original = try eventIdentities(in: app)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["api.refresh"].isHittable)
        let rotated = try eventIdentities(in: app)
        XCTAssertEqual(rotated, original, "Rotation retains the real SDK player/source/view objects")
        XCUIDevice.shared.orientation = .portrait
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
        #endif
    }

    private func eventIdentities(in app: XCUIApplication) throws -> [String: String] {
        var values: [String: String] = [:]
        for id in ["Player.events", "Source.events", "PlayerView.events"] {
            try WorkspaceUITestNavigation.replace(app.textFields["api.state.filter"], with: id, in: app)
            try WorkspaceUITestNavigation.activate(app.buttons["api.refresh"], in: app)
            let row = app.staticTexts["api.state.\(id)"]
            XCTAssertTrue(row.waitForExistence(timeout: 5), "Exact filtering materializes the current SDK identity without scrolling")
            XCTAssertTrue(row.isHittable)
            values[id] = row.label
        }
        return values
    }

    private func selectOperation(_ id: String, search: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: search, in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation.select.\(id)"], in: app)
    }
}
