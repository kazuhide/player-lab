import XCTest

// Run against this reference's fixture publisher. Playback also requires a
// Player license for the selected target's bundle identifier.
final class CatalogTests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    func testFixtureCatalog() {
        let app = launch()
        XCTAssertTrue(app.buttons["Number-line basics"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Number-line exercises"].exists)
    }

    func testPlaybackWithAppControls() throws {
        let app = launch()
        let asset = app.buttons["Number-line basics"]
        XCTAssertTrue(asset.waitForExistence(timeout: 15))
        try XCTSkipUnless(asset.isEnabled, "Configure the reference Player license to run playback.")
        activate(asset, in: app)
        if app.alerts.firstMatch.exists { activate(app.alerts.buttons["Start over"].firstMatch, in: app) }
        let controls = app.buttons["Learning controls"]
        let standard = app.buttons["Standard controls"]
        if !standard.exists {
            XCTAssertTrue(controls.waitForExistence(timeout: 10))
            activate(controls, in: app)
        }
        let pause = app.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 20), "The fixture should enter playback")
        activate(pause, in: app)
        XCTAssertTrue(app.buttons["Play"].firstMatch.waitForExistence(timeout: 5))
    }

    private func activate(_ target: XCUIElement, in app: XCUIApplication) {
        #if os(tvOS)
        for _ in 0..<20 {
            if target.hasFocus || target.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).count > 0 {
                XCUIRemote.shared.press(.select)
                return
            }
            let focused = app.descendants(matching: .any)
                .matching(NSPredicate(format: "hasFocus == true")).firstMatch
            guard focused.exists else {
                XCTFail("No focused control while selecting \(target.label)")
                return
            }
            let deltaY = target.frame.midY - focused.frame.midY
            if abs(deltaY) > 12 {
                XCUIRemote.shared.press(deltaY > 0 ? .down : .up)
            } else {
                XCUIRemote.shared.press(target.frame.midX > focused.frame.midX ? .right : .left)
            }
        }
        XCTFail("Remote focus could not reach \(target.label)")
        #else
        target.tap()
        #endif
    }
}
