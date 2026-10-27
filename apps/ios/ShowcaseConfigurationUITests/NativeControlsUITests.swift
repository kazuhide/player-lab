import XCTest

final class NativeControlsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    func testSourceChangeKeepsSeekSelectionAndDraftWhileDisablingInvalidRun() throws {
        let app = XCUIApplication()
        WorkspaceUITestNavigation.launch(app)
        try WorkspaceUITestNavigation.choose("VOD HLS", picker: "source.preset", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation"], in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: "Player.seek(time:)", in: app)
        let candidate = app.buttons["api.operation.select.Player.seek(time:)"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in candidate.exists && candidate.isEnabled }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 45), .completed)
        try WorkspaceUITestNavigation.activate(candidate, in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["api.argument.value"], with: "2", in: app)
        XCTAssertTrue(app.buttons["api.run"].isEnabled)
        try WorkspaceUITestNavigation.choose("Live HLS", picker: "source.preset", in: app)
        let unavailable = app.staticTexts["api.unavailable"]
        XCTAssertTrue(unavailable.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["api.run"].isEnabled)
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.seek(time:)"))
        XCTAssertEqual(app.textFields["api.argument.value"].value as? String, "2")
        WorkspaceUITestNavigation.capture(app, named: "native-source-aware-seek-unavailable", test: self)
        try WorkspaceUITestNavigation.choose("VOD HLS", picker: "source.preset", in: app)
        let recovered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in app.buttons["api.run"].isEnabled }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [recovered], timeout: 45), .completed)
        XCTAssertEqual(app.textFields["api.argument.value"].value as? String, "2")
    }

    #if os(tvOS)
    func testUnavailableTvRewindPreferenceKeepsRemoteFocusOnSupportedControls() throws {
        let app = XCUIApplication()
        WorkspaceUITestNavigation.launch(app)
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.choose("Live controls", picker: "workspace.more.section", in: app)
        let toggle = app.switches["dvr.allowControls"]
        XCTAssertTrue(toggle.exists)
        XCTAssertFalse(toggle.isEnabled)
        XCTAssertEqual(toggle.value as? String, "1")
        XCTAssertTrue(app.staticTexts["dvr.controls.unavailable"].exists)
        try WorkspaceUITestNavigation.choose("Diagnostics", picker: "workspace.more.section", in: app)
        XCTAssertFalse(app.staticTexts["dvr.controls.unavailable"].exists)
        WorkspaceUITestNavigation.capture(app, named: "native-tv-supported-focus-after-disabled-rewind", test: self)
    }
    #endif
}
