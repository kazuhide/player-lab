import XCTest

/// Uses the normal app, actual form controls and SDK-backed visible track/position labels.
/// Serve the generated 60-second native-subtitle HLS fixture before running this opt-in test.
final class TrackPreferenceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testInitialLanguagesScalingAndSourceReloadThroughNormalGui() throws {
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }
        let open = app.buttons["configuration.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        try activate(open, in: app)
        let environment = ProcessInfo.processInfo.environment
        let media = environment["PLAYER_LAB_TEST_MEDIA_URL"]
            ?? "http://127.0.0.1:5284/vod-multiaudio/master.m3u8"
        let expectedAudio = environment["PLAYER_LAB_TEST_EXPECT_AUDIO"] ?? "de"
        try replace(app.textFields["configuration.sourceURL"], with: media, in: app)
        try replace(app.textFields["configuration.title"], with: "Initial track preferences", in: app)
        try replace(app.textFields["configuration.startOffset"], with: "5", in: app)
        let autoplay = app.switches["configuration.autoplay"]
        #if os(tvOS)
        try focus(autoplay, in: app)
        #else
        reveal(autoplay, in: app)
        #endif
        if autoplay.value as? String != "1" { try activate(autoplay, in: app) }
        try replace(app.textFields["configuration.audioLanguage"], with: "de-AT", in: app)
        capture(app, name: "guide-initial-audio-language")
        try choose("Preferred language", picker: "configuration.subtitleMode", in: app)
        try replace(app.textFields["configuration.subtitleLanguage"], with: "de", in: app)
        capture(app, name: "guide-initial-subtitle-language")
        try choose("Fill (crop)", picker: "configuration.videoScaling", in: app)
        capture(app, name: "guide-video-scaling-form")
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: expectedAudio, subtitle: "de", app: app, stage: "German")
        #if !os(tvOS)
        try activate(app.buttons["Sports"], in: app)
        try expectPlayback(audio: "de", subtitle: "de", app: app, stage: "German in Sports after UI recreation")
        #endif

        // A subtitle-only change uses the existing player. The hosted SDK test checks identity.
        try activate(open, in: app)
        try choose("Off", picker: "configuration.subtitleMode", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: "de", subtitle: nil, app: app, stage: "Subtitles off")

        try activate(open, in: app)
        try replace(app.textFields["configuration.audioLanguage"], with: "en", in: app)
        try choose("Preferred language", picker: "configuration.subtitleMode", in: app)
        try replace(app.textFields["configuration.subtitleLanguage"], with: "en", in: app)
        try choose("Stretch", picker: "configuration.videoScaling", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: "en", subtitle: "en", app: app, stage: "English after recreation")
        #if !os(tvOS)
        try activate(app.buttons["Default"], in: app)
        try expectPlayback(audio: "en", subtitle: "en", app: app, stage: "English after Default UI recreation")
        #endif

        try activate(open, in: app)
        try replace(app.textFields["configuration.audioLanguage"], with: "invalid language", in: app)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        try activate(app.buttons["configuration.reset"], in: app)
        XCTAssertEqual(app.textFields["configuration.audioLanguage"].value as? String, "en")
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        try activate(app.buttons["configuration.code.toggle"], in: app)
        #if os(tvOS)
        try activate(app.staticTexts["configuration.code.line.5"], in: app)
        #else
        reveal(app.staticTexts["configuration.code.text"], in: app)
        #endif
        capture(app, name: "guide-applied-code-placeholders")
        try activate(app.buttons["configuration.cancel"], in: app)
    }

    private func expectPlayback(audio: String, subtitle: String?, app: XCUIApplication, stage: String) throws {
        let audioLabel = app.staticTexts["playback.audio"]
        let subtitleLabel = app.staticTexts["playback.subtitles"]
        let audioSelected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "[\(audio)]"), object: audioLabel)
        let subtitleSelected = XCTNSPredicateExpectation(predicate: subtitle.map {
            NSPredicate(format: "label CONTAINS %@", "[\($0)]")
        } ?? NSPredicate(format: "label ==[c] 'Subtitles: Off'"), object: subtitleLabel)
        XCTAssertEqual(XCTWaiter.wait(for: [audioSelected, subtitleSelected], timeout: 40), .completed, stage)
        let position = app.staticTexts["playback.position"]
        let initial = seconds(position.label)
        let advances = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            position.exists && self.seconds(position.label) > initial + 0.5
        }, object: position)
        XCTAssertEqual(XCTWaiter.wait(for: [advances], timeout: 15), .completed, stage)
        capture(app, name: stage)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func choose(_ value: String, picker: String, in app: XCUIApplication) throws {
        #if os(tvOS)
        try activate(app.cells[value].firstMatch, in: app)
        #else
        try activate(app.buttons[picker], in: app)
        let option = app.buttons[value].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        option.tap()
        #endif
    }

    private func replace(_ field: XCUIElement, with text: String, in app: XCUIApplication) throws {
        #if os(tvOS)
        let row = app.cells.containing(.textField, identifier: field.identifier).firstMatch
        try activate(row.exists ? row : field, in: app)
        let current = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 5) + text)
        if app.keyboards.firstMatch.exists {
            XCUIRemote.shared.press(.menu)
            let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
            XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
        }
        #else
        reveal(field, in: app)
        field.tap()
        let current = field.value as? String ?? ""
        if !current.isEmpty && current != field.placeholderValue {
            // Use the real hardware-keyboard shortcut; edit-menu commands vary
            // with selection state and system language.
            field.typeKey("a", modifierFlags: .command)
        }
        field.typeText(text + "\n")
        #endif
        XCTAssertEqual(field.value as? String, text)
    }

    private func activate(_ element: XCUIElement, in app: XCUIApplication) throws {
        #if os(tvOS)
        try focus(element, in: app)
        XCUIRemote.shared.press(.select)
        #else
        reveal(element, in: app)
        if element.elementType == .switch {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        } else { element.tap() }
        #endif
    }

    #if os(tvOS)
    private func focus(_ element: XCUIElement, in app: XCUIApplication) throws {
        let row = element.elementType == .switch
            ? app.cells.containing(.switch, identifier: element.identifier).firstMatch : element
        let target = row.exists ? row : element
        let directions: [XCUIRemote.Button] = [.down, .up, .right, .left]
        for direction in directions {
            for _ in 0..<50 {
                if target.exists && (target.hasFocus || target.descendants(matching: .any)
                    .matching(NSPredicate(format: "hasFocus == true")).firstMatch.exists) {
                    return
                }
                XCUIRemote.shared.press(direction)
            }
        }
        XCTFail("Remote focus did not reach the requested control")
        throw InputFailure.focus
    }
    #endif

    #if !os(tvOS)
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for direction in [true, false] {
            for _ in 0..<12 {
                if element.exists && element.isHittable { return }
                let form = app.collectionViews["configuration.form"]
                let scroll: XCUIElement = form.exists ? form : app.scrollViews["controls.scroll"]
                if direction { scroll.swipeUp() } else { scroll.swipeDown() }
            }
        }
        XCTAssertTrue(element.exists && element.isHittable, "Control must be visible for actual input")
    }
    #endif
    private func seconds(_ label: String) -> Double {
        Double(label.replacingOccurrences(of: "Position: ", with: "").replacingOccurrences(of: "s", with: "")) ?? 0
    }
    private enum InputFailure: Error { case focus }
}
