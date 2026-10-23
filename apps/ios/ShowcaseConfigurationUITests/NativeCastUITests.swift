#if !os(tvOS)
import XCTest

final class NativeCastUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    func testGuiConfiguresActualCastSdkAndShowsUnconnectedState() throws {
        let app = XCUIApplication()
        WorkspaceUITestNavigation.launch(app)
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["cast.open"], in: app)
        let application = app.textFields["cast.applicationId"]
        try WorkspaceUITestNavigation.replace(application, with: "FFE417E5", in: app)
        try WorkspaceUITestNavigation.choose("Message namespace", picker: "cast.setting", in: app)
        let namespace = app.textFields["cast.namespace"]
        try WorkspaceUITestNavigation.replace(namespace, with: "urn:x-cast:com.bitmovin.player.caf", in: app)
        try WorkspaceUITestNavigation.choose("Receiver application ID", picker: "cast.setting", in: app)
        XCTAssertEqual(application.value as? String, "FFE417E5")
        WorkspaceUITestNavigation.capture(app, named: "iOS-cast-initialization-options", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["cast.run"], in: app)
        XCTAssertFalse(app.staticTexts["cast.error"].exists)
        try WorkspaceUITestNavigation.choose("State", picker: "cast.section", in: app)
        let initialized = app.staticTexts["cast.state.BitmovinCastManager.isInitialized()"]
        XCTAssertTrue(initialized.waitForExistence(timeout: 10))
        XCTAssertEqual(initialized.label, "true")
        WorkspaceUITestNavigation.capture(app, named: "iOS-cast-sdk-initialized-state", test: self)
        try WorkspaceUITestNavigation.choose("Receiver settings", picker: "cast.section", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["cast.startup.disable"], in: app)
        XCTAssertTrue(app.staticTexts["cast.result"].label.contains("disabled for the next launch"))
    }
}
#endif
