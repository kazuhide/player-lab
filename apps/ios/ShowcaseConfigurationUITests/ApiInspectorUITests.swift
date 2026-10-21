import XCTest

/// Uses the licensed app, its real SDK player and native accessibility controls.
final class ApiInspectorUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    #if os(tvOS)
    func testRemoteCanInvokeApiAndReadCurrentSdkState() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["api.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        try focus(open)
        XCUIRemote.shared.press(.select)
        let nativeRow = app.cells["Use native PlayerView host"]
        try focus(nativeRow)
        XCUIRemote.shared.press(.select)
        XCTAssertEqual(app.switches["api.nativeHost"].firstMatch.value as? String, "1")
        let run = app.buttons["api.run"]
        try focus(run)
        XCUIRemote.shared.press(.select)
        XCTAssertTrue(app.staticTexts["api.result"].label.contains("Player.play() invoked"))
        let state = app.buttons["State"]
        let operations = app.buttons["Operations"]
        try focus(operations)
        XCUIRemote.shared.press(.right)
        if state.hasFocus { XCUIRemote.shared.press(.select) }
        let refresh = app.buttons["api.refresh"]
        try focus(refresh)
        XCUIRemote.shared.press(.select)
        XCTAssertEqual(app.staticTexts["api.state.PlayerFactory.sdkVersion"].label, "3.128.0")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "tvOS-native-api-state"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func focus(_ element: XCUIElement) throws {
        for direction: XCUIRemote.Button in [.down, .up] {
            for _ in 0..<110 {
                if element.exists && (element.hasFocus || element.descendants(matching: .any).allElementsBoundByIndex.contains(where: { $0.hasFocus })) { return }
                if element.elementType == .button && !element.identifier.isEmpty {
                    let cell = XCUIApplication().cells.containing(.button, identifier: element.identifier).firstMatch
                    if cell.exists && cell.hasFocus { return }
                }
                XCUIRemote.shared.press(direction)
            }
        }
        let hierarchy = XCTAttachment(string: XCUIApplication().debugDescription)
        hierarchy.name = "tvOS-api-focus-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        XCTFail("Remote focus did not reach the API control")
        throw ApiFocusFailure.unreachable
    }

    private enum ApiFocusFailure: Error { case unreachable }
    #else
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
        dismissKeyboard(in: app)
        app.buttons["api.operation"].tap()
        app.buttons["Player.volume"].tap()
        let value = app.textFields["api.argument.value"]
        reveal(value, in: app)
        value.tap()
        value.typeText(XCUIKeyboardKey.delete.rawValue + "42")
        dismissKeyboard(in: app)
        app.buttons["api.run"].tap()
        XCTAssertTrue(app.staticTexts["api.result"].label.contains("Player.volume invoked"))
        app.segmentedControls["api.pane"].buttons["State"].tap()
        let stateFilter = app.textFields["api.state.filter"]
        reveal(stateFilter, in: app)
        stateFilter.tap()
        stateFilter.typeText("Player.volume")
        dismissKeyboard(in: app)
        reveal(app.staticTexts["api.state.Player.volume"], in: app)
        XCTAssertEqual(app.staticTexts["api.state.Player.volume"].label, "42")

        app.collectionViews["api.form"].swipeDown()
        let nativeHost = app.switches["api.nativeHost"]
        XCTAssertTrue(nativeHost.waitForExistence(timeout: 5))
        nativeHost.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        app.segmentedControls["api.pane"].buttons["Operations"].tap()
        reveal(filter, in: app)
        filter.tap()
        filter.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 10) + "enterFullscreen")
        dismissKeyboard(in: app)
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

    private func dismissKeyboard(in app: XCUIApplication) {
        let done = app.buttons["api.keyboard.done"]
        if done.waitForExistence(timeout: 2) { done.tap() }
    }
    #endif
}
