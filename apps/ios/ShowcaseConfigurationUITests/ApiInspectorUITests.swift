import XCTest

/// Uses the licensed app, its real SDK player and native accessibility controls.
final class ApiInspectorUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    #if !os(tvOS)
    func testVolumeOperationStateAndNativeFullscreenHost() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["api.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        let filter = app.textFields["api.operation.filter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 10))
        filter.tap()
        filter.typeText("volume")
        app.buttons["api.operation"].tap()
        app.buttons["Player.volume"].tap()
        let value = app.textFields["api.argument.value"]
        value.tap()
        value.typeText(XCUIKeyboardKey.delete.rawValue + "42")
        app.buttons["api.run"].tap()
        XCTAssertTrue(app.staticTexts["api.result"].label.contains("Player.volume invoked"))
        app.segmentedControls["api.pane"].buttons["State"].tap()
        let stateFilter = app.textFields["api.state.filter"]
        stateFilter.tap()
        stateFilter.typeText("Player.volume")
        XCTAssertEqual(app.staticTexts["api.state.Player.volume"].label, "42")

        app.collectionViews["api.form"].swipeDown()
        let nativeHost = app.switches["api.nativeHost"]
        XCTAssertTrue(nativeHost.waitForExistence(timeout: 5))
        nativeHost.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        app.segmentedControls["api.pane"].buttons["Operations"].tap()
        filter.tap()
        filter.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 10) + "enterFullscreen")
        app.buttons["api.operation"].tap()
        app.buttons["UserInterfaceApi.enterFullscreen()"].tap()
        reveal(app.buttons["api.run"], in: app)
        app.buttons["api.run"].tap()
        let exit = app.buttons["api.fullscreen.exit"]
        XCTAssertTrue(exit.waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "iOS-native-api-fullscreen"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        exit.tap()
        XCTAssertTrue(app.buttons["api.close"].waitForExistence(timeout: 10))
        app.buttons["api.close"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertEqual(app.switches["api.nativeHost"].value as? String, "1")
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            app.collectionViews["api.form"].swipeUp()
        }
        XCTAssertTrue(element.exists && element.isHittable, "API control is not reachable")
    }
    #endif
}
