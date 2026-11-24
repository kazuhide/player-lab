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
        let startOver = app.alerts.buttons["Start over"].firstMatch
        let mode = app.buttons.matching(NSPredicate(format: "label IN %@", ["Learning controls", "Standard controls"])).firstMatch
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            startOver.exists || mode.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 10), .completed)
        if startOver.exists { activate(startOver, in: app) }
        // After dismissing the resume alert tvOS may still be animating. Wait
        // for either valid mode before reading the restored preference.
        XCTAssertTrue(mode.waitForExistence(timeout: 10))
        if mode.label == "Learning controls" { activate(mode, in: app) }
        let pause = app.buttons["Pause"].firstMatch
        XCTAssertTrue(pause.waitForExistence(timeout: 20), "The fixture should enter playback")
        activate(pause, in: app)
        XCTAssertTrue(app.buttons["Play"].firstMatch.waitForExistence(timeout: 5))

        let cue = app.buttons["transcript.cue.1"]
        XCTAssertTrue(cue.waitForExistence(timeout: 5))
        #if os(iOS)
        for _ in 0..<6 where !cue.isHittable { app.scrollViews.firstMatch.swipeUp() }
        #endif
        activate(cue, in: app)
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Current line"), object: cue)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
        let follow = app.descendants(matching: .any).matching(identifier: "transcript.follow").firstMatch
        XCTAssertEqual(follow.value as? String, "0")

    }

    private func activate(_ target: XCUIElement, in app: XCUIApplication) {
        #if os(tvOS)
        for _ in 0..<40 {
            if target.hasFocus || target.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).count > 0 {
                XCUIRemote.shared.press(.select)
                return
            }
            let focused = app.descendants(matching: .any)
                .matching(NSPredicate(format: "hasFocus == true")).firstMatch
            // Remote scrolling can briefly leave the accessibility tree without
            // a focused element while the next scroll region becomes visible.
            if !focused.exists && !focused.waitForExistence(timeout: 1) {
                XCUIRemote.shared.press(.down)
                continue
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
