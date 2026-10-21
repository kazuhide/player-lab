#if !os(tvOS)
import XCTest

/// Opt-in real app checks. These exercise track discovery, not completed offline downloads.
final class NativeWorkbenchUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { XCUIApplication().terminate() }

    func testSubtitleArrayEditorAppliesTypedSdkTracks() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["configuration.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20)); open.tap()
        let form = app.collectionViews["configuration.form"]
        replace(app.textFields["configuration.sourceURL"], with: "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8")
        app.buttons["configuration.keyboard.done"].tap()
        let advanced = app.switches["advanced.show"]
        reveal(advanced, in: form); advanced.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        let filter = app.textFields["advanced.filter"]
        reveal(filter, in: form); replace(filter, with: "SourceConfig.tracks")
        app.buttons["configuration.keyboard.done"].tap()
        let enabled = app.switches["advanced.SourceConfig.tracks.enabled"]
        reveal(enabled, in: form); enabled.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        let body = app.textViews["advanced.SourceConfig.tracks.value"]
        reveal(body, in: form)
        replace(body, with: "[{\"identifier\":\"manual-example\",\"label\":\"Manual English\",\"language\":\"en\",\"url\":null}]")
        app.buttons["configuration.keyboard.done"].tap()
        capture(app, name: "iOS-source-subtitle-array-editor")
        XCTAssertTrue(app.buttons["configuration.apply"].isEnabled); app.buttons["configuration.apply"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        app.buttons["api.open"].tap(); app.buttons["State"].tap()
        let stateForm = app.collectionViews["api.form"]
        let stateFilter = app.textFields["api.state.filter"]
        reveal(stateFilter, in: stateForm); replace(stateFilter, with: "Player.availableSubtitles")
        app.buttons["api.keyboard.done"].tap()
        let refresh = app.buttons["api.refresh"]
        reveal(refresh, in: stateForm)
        let subtitles = app.staticTexts["api.state.Player.availableSubtitles"]
        for _ in 0..<20 {
            refresh.tap()
            if subtitles.exists && subtitles.label.contains("manual-example") { break }
        }
        XCTAssertTrue(subtitles.label.contains("manual-example"), subtitles.label)
        reveal(subtitles, in: stateForm)
        capture(app, name: "iOS-source-subtitle-array-sdk-state")
    }

    func testCallbackEditorAndOfflineTrackDiscoveryUseRealSdkObjects() throws {
        let app = XCUIApplication()
        app.launch()
        let open = app.buttons["configuration.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        let form = app.collectionViews["configuration.form"]
        let url = app.textFields["configuration.sourceURL"]
        replace(url, with: "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8")
        app.buttons["configuration.keyboard.done"].tap()
        let autoplay = app.switches["configuration.autoplay"]
        reveal(autoplay, in: form)
        if autoplay.value as? String == "0" { autoplay.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap() }
        let advanced = app.switches["advanced.show"]
        reveal(advanced, in: form)
        advanced.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        let filter = app.textFields["advanced.filter"]
        reveal(filter, in: form)
        replace(filter, with: "LabelingConfig.audioLabel")
        app.buttons["configuration.keyboard.done"].tap()
        let enabled = app.switches["advanced.LabelingConfig.audioLabel.enabled"]
        reveal(enabled, in: form)
        enabled.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        let body = app.textViews["advanced.LabelingConfig.audioLabel.value"]
        reveal(body, in: form)
        replace(body, with: "return 'GUI ' + input.label;")
        app.buttons["configuration.keyboard.done"].tap()
        capture(app, name: "iOS-editable-audio-label-callback")
        XCTAssertTrue(app.buttons["configuration.apply"].isEnabled)
        app.buttons["configuration.apply"].tap()
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        app.buttons["api.open"].tap()
        app.buttons["State"].tap()
        let stateForm = app.collectionViews["api.form"]
        let stateFilter = app.textFields["api.state.filter"]
        reveal(stateFilter, in: stateForm)
        replace(stateFilter, with: "Callback.Source.LabelingConfig.audioLabel")
        app.buttons["api.keyboard.done"].tap()
        let refresh = app.buttons["api.refresh"]
        reveal(refresh, in: stateForm)
        refresh.tap()
        let callback = app.staticTexts["api.state.Callback.Source.LabelingConfig.audioLabel"]
        XCTAssertTrue(callback.waitForExistence(timeout: 30))
        reveal(callback, in: stateForm)
        XCTAssertTrue(callback.label.contains("failures: 0"), callback.label)
        capture(app, name: "iOS-configured-label-callback-status")
        app.buttons["api.close"].tap()
        let offline = app.buttons["offline.open"]
        reveal(offline, in: app.scrollViews["controls.scroll"])
        offline.tap()
        let offlineForm = app.collectionViews["offline.form"]
        let initialize = app.buttons["offline.initialize.default"]
        reveal(initialize, in: offlineForm)
        initialize.tap()
        let create = app.buttons["offline.create"]
        reveal(create, in: offlineForm)
        create.tap()
        let fetch = app.buttons["offline.fetchTracks"]
        reveal(fetch, in: offlineForm)
        fetch.tap()
        let track = app.switches.matching(NSPredicate(format: "identifier BEGINSWITH %@", "offline.track.")).firstMatch
        reveal(track, in: offlineForm)
        XCTAssertTrue(track.waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["offline.error"].exists)
        capture(app, name: "iOS-offline-sdk-track-selection")
    }

    private func replace(_ element: XCUIElement, with value: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        element.tap()
        element.press(forDuration: 1.2)
        let selectAll = XCUIApplication().buttons["Select All"]
        let menuSelectAll = XCUIApplication().menuItems["Select All"]
        if selectAll.waitForExistence(timeout: 2) { selectAll.tap() }
        else if menuSelectAll.exists { menuSelectAll.tap() }
        else {
            element.typeKey("a", modifierFlags: .command)
        }
        element.typeText(value)
        XCTAssertEqual(element.value as? String, value, "The GUI must contain the exact intended input before applying it")
    }
    private func reveal(_ element: XCUIElement, in form: XCUIElement) {
        for forward in [true, false] {
            for _ in 0..<10 {
                if element.exists && element.isHittable { return }
                if forward { form.swipeUp() } else { form.swipeDown() }
            }
        }
        capture(XCUIApplication(), name: "iOS-workbench-unreachable-field")
        let hierarchy = XCTAttachment(string: XCUIApplication().debugDescription)
        hierarchy.name = "iOS-workbench-unreachable-field-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        XCTAssertTrue(element.exists && element.isHittable, "Field is not reachable")
    }
    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
#endif
