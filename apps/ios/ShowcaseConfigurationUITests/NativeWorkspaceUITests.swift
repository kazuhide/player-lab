#if !os(tvOS)
import XCTest

final class NativeWorkspaceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        WorkspaceUITestNavigation.capture(XCUIApplication(), named: "native-workspace-test-final-screen", test: self)
        XCUIDevice.shared.orientation = .portrait
        XCUIApplication().terminate()
    }

    func testSettingsAndDraftSurviveTabsRotationAndPresetSelection() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["configuration.open"].waitForExistence(timeout: 20))
        try WorkspaceUITestNavigation.setting("configuration.autoplay", in: app)
        let autoplay = app.switches["configuration.autoplay"]
        try WorkspaceUITestNavigation.activate(autoplay, in: app)
        XCTAssertEqual(autoplay.value as? String, "1")
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.title"], with: "Unapplied title", in: app)

        app.buttons["api.open"].tap()
        app.buttons["configuration.open"].tap()
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "Unapplied title")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(WorkspaceUITestNavigation.waitUntilHittable(app.buttons["configuration.apply"]))
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "Unapplied title")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "Unapplied title")

        // Presets deliberately replace Source drafts while retaining unapplied Player edits.
        try WorkspaceUITestNavigation.choose("VOD HLS", picker: "source.preset", in: app)
        XCTAssertEqual(app.staticTexts["source.current"].label, "VOD HLS")
        XCTAssertEqual(app.textFields["configuration.title"].value as? String, "VOD HLS")
        try WorkspaceUITestNavigation.setting("configuration.autoplay", in: app)
        XCTAssertEqual(autoplay.value as? String, "1")
        XCTAssertTrue(app.buttons["configuration.apply"].isEnabled)
        app.buttons["configuration.apply"].tap()
        XCTAssertTrue(app.staticTexts["configuration.summary"].label.contains("autoplay"))
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-persistent-player-settings", test: self)

        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        let longTitle = String(repeating: "A long source title ", count: 25)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.title"], with: longTitle, in: app)
        app.buttons["configuration.apply"].tap()
        XCTAssertEqual(app.staticTexts["source.current"].label, longTitle)
        let titleInput = app.textFields["configuration.title"]
        XCTAssertTrue(titleInput.isHittable)
        XCTAssertGreaterThanOrEqual(titleInput.frame.intersection(app.scrollViews["configuration.form"].frame).height, 44, "Readonly titles must leave the selected input usable")
        XCTAssertTrue(app.buttons["configuration.apply"].isHittable)
        try WorkspaceUITestNavigation.replace(titleInput, with: "VOD HLS", in: app)
        app.buttons["configuration.apply"].tap()

        // Every common setting has an explicit selector, with Apply visible without a swipe.
        for id in WorkspaceUITestNavigation.fields.keys.sorted() {
            try WorkspaceUITestNavigation.setting("configuration.\(id)", in: app)
            XCTAssertTrue(app.buttons["configuration.reset"].isHittable)
        }
        app.buttons["configuration.code.toggle"].tap()
        XCTAssertEqual(app.switches["configuration.code.wrap"].value as? String, "1")
        let code = app.staticTexts["configuration.code.text"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        XCTAssertTrue(code.label.contains("YOUR_PLAYER_KEY"))
        XCTAssertTrue(code.label.contains("isAutoplayEnabled = true"))
        XCTAssertFalse(code.label.contains("Unapplied title"))
        XCTAssertTrue(app.buttons["configuration.code.copy"].isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-applied-code-wrapped", test: self)
        app.buttons["workspace.more"].tap()
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-more-tools", test: self)
    }

    func testOperationFilterRequiresExplicitSelectionAndShowsSdkOutcome() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["api.open"].waitForExistence(timeout: 20))
        app.buttons["api.open"].tap()
        app.buttons["api.operation"].tap()
        try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: "pause", in: app)
        app.buttons["api.operation.back"].tap()
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.play()"))
        XCTAssertFalse(app.buttons["api.run"].isEnabled)
        app.buttons["api.operation"].tap()
        app.buttons["api.operation.select.Player.pause()"].tap()
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.pause()"))
        XCTAssertTrue(app.buttons["api.run"].isEnabled)
        app.buttons["api.run"].tap()
        XCTAssertTrue(app.staticTexts["api.result"].label.contains("Player.pause() invoked"))
        XCTAssertEqual(app.staticTexts["api.related.Player.isPaused"].label, "true")
        let originalOwner = app.staticTexts["api.observation.owner"].label
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-explicit-api-selection", test: self)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.pause()"))
        XCTAssertTrue(WorkspaceUITestNavigation.waitUntilHittable(app.buttons["api.run"]))
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.pause()"))
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["configuration.title"], with: "New source observation", in: app)
        app.buttons["configuration.apply"].tap()
        app.buttons["api.open"].tap()
        XCTAssertTrue(app.staticTexts["api.target"].label.contains("Player.pause()"))
        XCTAssertTrue(app.staticTexts["api.result"].label.contains("No invocation"), "An old source's command result must not appear current after Apply")
        XCTAssertNotEqual(app.staticTexts["api.observation.owner"].label, originalOwner)
    }

    func testLargeTextKeepsSelectedSettingAndApplyAccessible() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["configuration.open"].waitForExistence(timeout: 20))
        try WorkspaceUITestNavigation.setting("configuration.startOffset", in: app)
        let offset = app.textFields["configuration.startOffset"]
        offset.tap()
        offset.typeText("10")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Exercise the visible software keyboard")
        XCTAssertTrue(offset.isHittable, "The selected input remains visible above the keyboard")
        let offsetVisible = offset.frame.intersection(app.scrollViews["configuration.form"].frame)
            .intersection(CGRect(x: app.frame.minX, y: app.frame.minY, width: app.frame.width, height: app.keyboards.firstMatch.frame.minY - app.frame.minY))
        XCTAssertGreaterThanOrEqual(offsetVisible.height, 44, "The editable row must be visible, rather than a hittable sliver")
        XCTAssertTrue(app.buttons["configuration.apply"].isHittable, "Apply stays visible while typing")
        let done = app.buttons["workspace.keyboard.done"]
        XCTAssertTrue(done.isHittable)
        XCTAssertEqual(app.buttons.matching(identifier: "workspace.keyboard.done").count, 1)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-large-text-keyboard", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["playback.preview.expand"], in: app)
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Expand dismisses the keyboard before growing the preview")
        XCTAssertTrue(app.buttons["playback.preview.collapse"].isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-expanded-after-keyboard", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["playback.preview.collapse"], in: app)
        XCTAssertEqual(offset.value as? String, "10")
        offset.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["playback.preview.expand"].isHittable)
        XCTAssertFalse(app.buttons["playback.preview.collapse"].exists)
        done.tap()
        XCTAssertTrue(app.buttons["configuration.apply"].isHittable)
        XCTAssertTrue(app.buttons["configuration.reset"].isHittable)
        app.buttons["configuration.apply"].tap()
        XCTAssertTrue(app.staticTexts["configuration.summary"].label.contains("start position"))
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-accessibility-text-settings", test: self)
        app.buttons["workspace.more"].tap()
        for id in ["playlist.open", "offline.open", "cast.open"] { XCTAssertTrue(app.buttons[id].isHittable) }
        XCTAssertTrue(app.buttons["SharePlay"].isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-large-text-more-tools", test: self)
    }

    func testSharePlayActivityDraftSurvivesWorkspaceChanges() throws {
        let app = XCUIApplication()
        app.launch()
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.choose("SharePlay", picker: "workspace.more.section", in: app)
        try WorkspaceUITestNavigation.choose("Activity", picker: "shareplay.section", in: app)
        let title = app.textFields["shareplay.activity.title"]
        try WorkspaceUITestNavigation.replace(title, with: "Unapplied activity draft", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.code.toggle"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        XCTAssertTrue(title.waitForExistence(timeout: 5), "The selected Activity pane survives workspace changes")
        XCTAssertTrue(title.isHittable)
        XCTAssertEqual(title.value as? String, "Unapplied activity draft")
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-shareplay-activity-draft", test: self)
    }

    func testInvalidSdkFieldRevealSurvivesCategoryChanges() throws {
        let app = XCUIApplication()
        app.launch()
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.open"], in: app)
        try WorkspaceUITestNavigation.choose("Advanced SDK", picker: "configuration.category", in: app)
        try WorkspaceUITestNavigation.replace(app.textFields["advanced.filter"], with: "SourceConfig.tracks", in: app)
        try WorkspaceUITestNavigation.activate(app.switches["advanced.SourceConfig.tracks.enabled"], in: app)
        try WorkspaceUITestNavigation.replace(app.textViews["advanced.SourceConfig.tracks.value"], with: "{", in: app)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        try WorkspaceUITestNavigation.setting("configuration.title", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.error.reveal"], in: app)
        XCTAssertEqual(app.textFields["advanced.filter"].value as? String, "SourceConfig.tracks")
        let editor = app.textViews["advanced.SourceConfig.tracks.value"]
        XCTAssertEqual(editor.value as? String, "{")
        XCTAssertTrue(editor.isHittable)
        XCTAssertGreaterThanOrEqual(editor.frame.intersection(app.scrollViews["advanced.editor"].frame).height, 64)
        try WorkspaceUITestNavigation.replace(app.textFields["advanced.filter"], with: "LabelingConfig.audioLabel", in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.code.toggle"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.open"], in: app)
        XCTAssertEqual(app.textFields["advanced.filter"].value as? String, "LabelingConfig.audioLabel", "A handled reveal must not overwrite a later retained filter")
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.error.reveal"], in: app)
        XCTAssertEqual(app.textFields["advanced.filter"].value as? String, "SourceConfig.tracks", "The same invalid field can be requested again")
        XCTAssertEqual(editor.value as? String, "{")
        XCTAssertTrue(editor.isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-invalid-sdk-field-revealed", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.reset"], in: app)
    }

    @available(iOS 17.0, *)
    func testMainSettingsAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["configuration.open"].waitForExistence(timeout: 20))
        try WorkspaceUITestNavigation.setting("configuration.startMuted", in: app)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        try app.performAccessibilityAudit(for: [.contrast, .textClipped, .hitRegion, .trait])
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-disabled-apply-audit", test: self)
        try WorkspaceUITestNavigation.activate(app.switches["configuration.startMuted"], in: app)
        XCTAssertTrue(app.buttons["configuration.apply"].isEnabled)
        try WorkspaceUITestNavigation.choose("Advanced SDK", picker: "configuration.category", in: app)
        XCTAssertTrue(app.buttons["playback.compact.toggle"].isHittable)
        XCTAssertGreaterThanOrEqual(app.buttons["playback.compact.toggle"].frame.height, 44)
        XCTAssertTrue(app.buttons["playback.preview.expand"].isHittable)
        try app.performAccessibilityAudit(for: [.contrast, .textClipped, .hitRegion, .trait])
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-enabled-apply-mini-audit", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["advanced.details"], in: app)
        XCTAssertTrue(app.navigationBars["SDK setting details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Close"].isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-sdk-setting-help", test: self)
        app.buttons["Close"].tap()
        try WorkspaceUITestNavigation.activate(app.buttons["playback.preview.expand"], in: app)
        XCTAssertTrue(app.buttons["playback.preview.collapse"].isHittable)
        let metadata = XCTAttachment(string: app.debugDescription)
        metadata.name = "native-workspace-expanded-audit-accessibility"
        metadata.lifetime = .keepAlways
        add(metadata)
        try app.performAccessibilityAudit(for: [.contrast, .textClipped, .hitRegion, .trait])
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-expanded-player-audit", test: self)
        try WorkspaceUITestNavigation.activate(app.buttons["playback.preview.collapse"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["configuration.reset"], in: app)
    }

    func testLongApiAndScriptSettingKeepInputAndActionsVisible() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["api.open"].waitForExistence(timeout: 20))
        app.buttons["api.open"].tap()
        app.buttons["api.operation"].tap()
        try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: "renderThumbnail(for:", in: app)
        app.buttons["api.operation.select.ThumbnailsApi.renderThumbnail(for:time:toleranceBefore:toleranceAfter:)"].tap()
        let argument = app.textFields["api.argument.index"]
        try WorkspaceUITestNavigation.activate(argument, in: app)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(argument.isHittable)
        let argumentVisible = argument.frame.intersection(app.scrollViews["api.form"].frame)
            .intersection(CGRect(x: app.frame.minX, y: app.frame.minY, width: app.frame.width, height: app.keyboards.firstMatch.frame.minY - app.frame.minY))
        XCTAssertGreaterThanOrEqual(argumentVisible.height, 44)
        XCTAssertTrue(app.buttons["api.run"].isHittable)
        XCTAssertTrue(app.buttons["workspace.keyboard.done"].isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-large-text-api-keyboard", test: self)
        WorkspaceUITestNavigation.dismissKeyboard(in: app)
        app.buttons["configuration.open"].tap()
        app.buttons["configuration.category"].tap()
        let choiceSearch = app.textFields["workspace.choice.filter"]
        choiceSearch.tap()
        choiceSearch.typeText("Advanced")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let advanced = app.buttons["Advanced SDK"]
        XCTAssertTrue(advanced.isHittable, "The chooser anchor and filtered option survive its visible keyboard")
        advanced.tap()
        XCTAssertFalse(choiceSearch.exists)
        let id = "PictureInPictureConfig.restoreUserInterfaceHandler-swift.property"
        try WorkspaceUITestNavigation.replace(app.textFields["advanced.filter"], with: id, in: app)
        try WorkspaceUITestNavigation.activate(app.switches["advanced.\(id).enabled"], in: app)
        let script = app.textViews["advanced.\(id).value"]
        try WorkspaceUITestNavigation.activate(script, in: app)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(script.isHittable)
        let scriptVisible = script.frame.intersection(app.scrollViews["advanced.editor"].frame)
            .intersection(CGRect(x: app.frame.minX, y: app.frame.minY, width: app.frame.width, height: app.keyboards.firstMatch.frame.minY - app.frame.minY))
        XCTAssertGreaterThanOrEqual(scriptVisible.height, 64, "The script editor needs a usable visible editing area")
        XCTAssertGreaterThanOrEqual(scriptVisible.width, 160)
        XCTAssertTrue(app.buttons["configuration.apply"].isHittable)
        XCTAssertGreaterThanOrEqual(app.buttons["configuration.apply"].frame.height, 44)
        XCTAssertTrue(app.buttons["workspace.keyboard.done"].isHittable)
        WorkspaceUITestNavigation.capture(app, named: "native-workspace-large-text-script-keyboard", test: self)
        WorkspaceUITestNavigation.dismissKeyboard(in: app)
        app.buttons["configuration.reset"].tap()
    }
}
#endif
