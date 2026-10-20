import XCTest

/// Opt-in simulator checks against the real app. The app needs its normal local Player license.
final class ConfigurationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    #if os(tvOS)
    func testRemoteCanEditAndResetConfiguration() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["configuration.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        try focus(open, direction: .down)
        XCUIRemote.shared.press(.select)

        let progressive = app.cells["Progressive MP4"]
        try focus(progressive, direction: .down)
        XCUIRemote.shared.press(.select)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Reload source")

        // tvOS focuses the containing Form cell; its Switch is an accessibility child.
        let autoplay = app.switches["configuration.autoplay"].firstMatch
        XCTAssertTrue(autoplay.waitForExistence(timeout: 10))
        let autoplayRow = app.cells["Autoplay after source load"]
        try focus(autoplayRow, direction: .down)
        let original = autoplay.value as? String
        XCUIRemote.shared.press(.select)
        XCTAssertNotEqual(autoplay.value as? String, original)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")

        let reset = app.buttons["configuration.reset"]
        try focus(reset, direction: .down)
        XCUIRemote.shared.press(.select)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "tvOS-configuration-remote-reset"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(open.waitForExistence(timeout: 10))
    }

    private func focus(_ element: XCUIElement, direction: XCUIRemote.Button) throws {
        let app = XCUIApplication()
        var focusTrace: [String] = []
        let reverse: XCUIRemote.Button = direction == .down ? .up : .down
        for move in [direction, reverse] {
          for _ in 0..<20 {
            if element.hasFocus { return }
            let focused = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                element.hasFocus || element.descendants(matching: .any)
                    .allElementsBoundByIndex.contains(where: { $0.hasFocus })
            }, object: element)
            if XCTWaiter.wait(for: [focused], timeout: 0.6) == .completed {
                return
            }
            focusTrace.append(contentsOf: app.debugDescription.components(separatedBy: "\n")
                .filter { $0.contains("Focused") })
            XCUIRemote.shared.press(move)
          }
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "tvOS-focus-failure"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "tvOS-focus-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let trace = XCTAttachment(string: focusTrace.joined(separator: "\n"))
        trace.name = "tvOS-focus-trace"
        trace.lifetime = .keepAlways
        add(trace)
        XCTFail("Remote focus did not reach \(element.identifier.isEmpty ? element.label : element.identifier)")
        throw SmokeFailure.focus
    }

    private enum SmokeFailure: Error { case focus }
    #else
    func testDraftValidationResetAndSourceApply() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["configuration.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        let sourceURL = app.textFields["configuration.sourceURL"]
        XCTAssertTrue(sourceURL.waitForExistence(timeout: 10))
        let originalURL = sourceURL.value as? String

        // Invalid draft input must neither enable Apply nor change the loaded source.
        sourceURL.tap()
        sourceURL.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue,
                                  count: (originalURL?.count ?? 0) + 5) + "invalid")
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        XCTAssertTrue(app.staticTexts["configuration.error"].exists)
        app.buttons["configuration.reset"].tap()
        XCTAssertEqual(sourceURL.value as? String, originalURL)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)

        let title = app.textFields["configuration.title"]
        title.tap()
        title.typeText(" GUI")
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Reload source")
        app.buttons["configuration.apply"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["configuration.status"].label, "Reload source")
        XCTAssertTrue(app.staticTexts["source.current"].label.contains("GUI"))
        open.tap()
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "Live HLS GUI")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "iOS-configuration-applied-source"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["configuration.cancel"].tap()

        // A creation-time setting must rebuild the real native view and retain the chosen source.
        open.tap()
        let muted = app.switches["configuration.startMuted"]
        reveal(muted, in: app)
        muted.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(muted.value as? String, "0")
        let bitrate = app.textFields["configuration.maximumBitrate"]
        reveal(bitrate, in: app)
        bitrate.tap()
        bitrate.typeText(XCUIKeyboardKey.delete.rawValue + "2500000")
        let buffer = app.textFields["configuration.forwardBuffer"]
        reveal(buffer, in: app)
        buffer.tap()
        buffer.typeText(XCUIKeyboardKey.delete.rawValue + "12.5")
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        app.buttons["configuration.apply"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["configuration.status"].label, "Recreate player and reload source")
        XCTAssertTrue(app.staticTexts["source.current"].label.contains("GUI"))
        open.tap()
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "Live HLS GUI")
        reveal(muted, in: app)
        XCTAssertEqual(muted.value as? String, "0")
        reveal(bitrate, in: app)
        XCTAssertEqual(bitrate.value as? String, "2500000")
        reveal(buffer, in: app)
        XCTAssertEqual(buffer.value as? String, "12.5")
        let playerScreenshot = XCTAttachment(screenshot: app.screenshot())
        playerScreenshot.name = "iOS-configuration-recreated-player"
        playerScreenshot.lifetime = .keepAlways
        add(playerScreenshot)
        app.buttons["configuration.cancel"].tap()
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<6 {
            if element.exists && element.isHittable { return }
            app.collectionViews["configuration.form"].swipeUp()
        }
        XCTAssertTrue(element.exists && element.isHittable, "Configuration field is not reachable")
    }
    #endif
}
