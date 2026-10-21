#if !os(tvOS)
import XCTest

final class NativeCastUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    func testGuiConfiguresActualCastSdkAndShowsUnconnectedState() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["cast.open"]
        reveal(open, in: app.scrollViews["controls.scroll"])
        XCTAssertTrue(open.waitForExistence(timeout: 15)); open.tap()
        let form = app.collectionViews["cast.form"]
        let application = app.textFields["cast.applicationId"]
        XCTAssertTrue(application.waitForExistence(timeout: 10))
        application.tap(); application.typeText("FFE417E5")
        app.buttons["cast.keyboard.done"].tap()
        let namespace = app.textFields["cast.namespace"]
        namespace.tap(); namespace.typeText("urn:x-cast:com.bitmovin.player.caf")
        app.buttons["cast.keyboard.done"].tap()
        XCTAssertEqual(application.value as? String, "FFE417E5")
        XCTAssertEqual(namespace.value as? String, "urn:x-cast:com.bitmovin.player.caf")
        capture(app, name: "iOS-cast-initialization-options")
        let run = app.buttons["cast.run"]
        reveal(run, in: form); run.tap()
        XCTAssertFalse(app.staticTexts["cast.error"].exists)
        let initialized = app.staticTexts["cast.state.BitmovinCastManager.isInitialized()"]
        reveal(initialized, in: form)
        XCTAssertEqual(initialized.label, "true")
        capture(app, name: "iOS-cast-sdk-initialized-state")
        let disable = app.buttons["cast.startup.disable"]
        reveal(disable, in: form); disable.tap()
        XCTAssertTrue(app.staticTexts["cast.result"].label.contains("disabled for the next launch"))
    }

    private func reveal(_ element: XCUIElement, in form: XCUIElement) {
        for forward in [true, false] {
            for _ in 0..<12 {
                if element.exists && element.isHittable { return }
                if forward { form.swipeUp() } else { form.swipeDown() }
            }
        }
        XCTAssertTrue(element.exists && element.isHittable, "Cast control is not reachable")
    }
    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
#endif
