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
        try replace("configuration.sourceURL", with: media, in: app)
        try replace("configuration.title", with: "Initial track preferences", in: app)
        try replace("configuration.startOffset", with: "5", in: app)
        let autoplay = app.switches["configuration.autoplay"]
        #if os(tvOS)
        try focus(app.cells.containing(.switch, identifier: "configuration.autoplay").firstMatch, in: app)
        #else
        reveal(autoplay, in: app)
        #endif
        if autoplay.value as? String != "1" { try activate(autoplay, in: app) }
        try replace("configuration.audioLanguage", with: "de-AT", in: app)
        try choose("Preferred language", picker: "configuration.subtitleMode", in: app)
        try replace("configuration.subtitleLanguage", with: "de", in: app)
        try choose("Fill (crop)", picker: "configuration.videoScaling", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: expectedAudio, subtitle: "de", app: app, stage: "German")
        #if !os(tvOS)
        try activate(app.buttons["Sports"], in: app)
        try expectPlayback(audio: "de", subtitle: "de", app: app, stage: "German in Sports after UI recreation")
        #endif

        // A subtitle-only change uses the existing player. The hosted SDK test checks identity.
        try activate(open, in: app)
        #if os(tvOS)
        try focus(app.cells.containing(.textField, identifier: "configuration.audioLanguage").firstMatch, in: app)
        #else
        reveal(app.textFields["configuration.audioLanguage"], in: app)
        #endif
        capture(app, name: "guide-initial-languages-form")
        #if os(tvOS)
        try focus(app.cells["Fill (crop)"].firstMatch, in: app)
        #else
        reveal(app.buttons["configuration.videoScaling"], in: app)
        #endif
        capture(app, name: "guide-video-scaling-form")
        try choose("Off", picker: "configuration.subtitleMode", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: "de", subtitle: nil, app: app, stage: "Subtitles off")

        try activate(open, in: app)
        try replace("configuration.audioLanguage", with: "en", in: app)
        try choose("Preferred language", picker: "configuration.subtitleMode", in: app)
        try replace("configuration.subtitleLanguage", with: "en", in: app)
        try choose("Stretch", picker: "configuration.videoScaling", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: "en", subtitle: "en", app: app, stage: "English after recreation")
        #if !os(tvOS)
        try activate(app.buttons["Default"], in: app)
        try expectPlayback(audio: "en", subtitle: "en", app: app, stage: "English after Default UI recreation")
        #endif

        try activate(open, in: app)
        try replace("configuration.audioLanguage", with: "invalid language", in: app)
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        try activate(app.buttons["configuration.reset"], in: app)
        XCTAssertEqual(app.textFields["configuration.audioLanguage"].value as? String, "en")
        XCTAssertFalse(app.buttons["configuration.apply"].isEnabled)
        try activate(app.buttons["configuration.code.toggle"], in: app)
        #if os(tvOS)
        try activate(app.staticTexts["configuration.code.line.5"], in: app)
        #else
        reveal(app.scrollViews.containing(.staticText, identifier: "configuration.code.text").firstMatch, in: app)
        #endif
        capture(app, name: "guide-applied-code-placeholders")
        try activate(app.buttons["configuration.cancel"], in: app)
    }

    private func expectPlayback(audio: String, subtitle: String?, app: XCUIApplication, stage: String) throws {
        let audioLabel = app.staticTexts["playback.audio"]
        let subtitleLabel = app.staticTexts["playback.subtitles"]
        let position = app.staticTexts["playback.position"]
        let selected = {
            audioLabel.exists && subtitleLabel.exists && audioLabel.label.contains("[\(audio)]")
                && (subtitle.map { subtitleLabel.label.contains("[\($0)]") }
                    ?? (subtitleLabel.label.lowercased() == "subtitles: off"))
        }
        let bothSelected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            selected() && position.exists && self.seconds(position.label) >= 5
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [bothSelected], timeout: 40), .completed, stage)
        let initial = seconds(position.label)
        let advances = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            selected() && position.exists && self.seconds(position.label) > initial + 0.5
        }, object: position)
        XCTAssertEqual(XCTWaiter.wait(for: [advances], timeout: 15), .completed, stage)
        XCTAssertTrue(selected(), "Current audio/subtitle selection at visible advancing position")
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

    private func replace(_ identifier: String, with text: String, in app: XCUIApplication) throws {
        let field = app.textFields[identifier]
        #if os(tvOS)
        let row = app.cells.containing(.textField, identifier: identifier).firstMatch
        try activate(row, in: app)
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
        _ = app.keyboards.firstMatch.waitForExistence(timeout: 2)
        reveal(field, in: app)
        let current = field.value as? String ?? ""
        if !current.isEmpty && current != field.placeholderValue {
            field.press(forDuration: 1.1)
            let labels = NSPredicate(format: "label IN %@", ["Select All", "すべてを選択", "すべて選択", "全選択"])
            let menu = app.menuItems.matching(labels).firstMatch
            let button = app.buttons.matching(labels).firstMatch
            if menu.waitForExistence(timeout: 1) { menu.tap() }
            else {
                if button.waitForExistence(timeout: 2) { button.tap() }
                else {
                    // iOS can omit its edit menu; use its public hardware selection shortcut.
                    XCTContext.runActivity(named: "Select All using the keyboard shortcut") { _ in
                        field.tap()
                        field.typeKey("a", modifierFlags: .command)
                    }
                }
            }
        }
        field.typeText(text)
        field.typeText("\n")
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
        // Form buttons and switches focus their containing cell; toolbar buttons focus themselves.
        let row = element.exists && (element.elementType == .switch || element.elementType == .button)
            ? app.cells.containing(element.elementType, identifier: element.identifier).firstMatch : element
        let target = row.exists ? row : element
        let directions: [XCUIRemote.Button]
        if element.identifier == "configuration.apply" {
            // Apply is to the right of Reset at the bottom, before returning up the form.
            directions = [.down, .right, .up, .left]
        } else if element.identifier == "configuration.cancel" {
            // Return toward the header before traversing the long generated code listing.
            directions = [.up, .down, .right, .left]
        } else {
            directions = [.down, .up, .right, .left]
        }
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
        let fixed = ["configuration.open", "configuration.apply", "configuration.cancel", "configuration.reset"]
        if element.exists && element.isHittable && fixed.contains(element.identifier) { return }
        let form = app.collectionViews["configuration.form"]
        let scroll = form.exists ? form : app.scrollViews["controls.scroll"]
        for _ in 0..<24 {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? min(scroll.frame.maxY, keyboard.frame.minY) : scroll.frame.maxY
            let viewport = CGRect(x: scroll.frame.minX, y: scroll.frame.minY,
                                  width: scroll.frame.width, height: bottom - scroll.frame.minY)
            if element.exists {
                let frame = element.frame
                if frame.height > 0 && frame.intersection(viewport).height >= min(frame.height, viewport.height) * 0.85
                    && viewport.contains(CGPoint(x: frame.midX, y: frame.midY)) && element.isHittable { return }
            }
            let down = element.exists && element.frame.midY < viewport.minY
            // Drag the scroll gutter, avoiding sliders, switches and inline picker controls.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: viewport.maxX - 10,
                dy: down ? viewport.minY + viewport.height * 0.3 : viewport.maxY - 30))
            let end = origin.withOffset(CGVector(dx: viewport.maxX - 10,
                dy: down ? viewport.maxY - 30 : viewport.minY + viewport.height * 0.3))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        capture(app, name: "diagnostic-control-viewport")
        XCTFail("Control must be visible for actual input")
    }
    #endif
    private func seconds(_ label: String) -> Double {
        Double(label.replacingOccurrences(of: "Position: ", with: "").replacingOccurrences(of: "s", with: "")) ?? 0
    }
    private enum InputFailure: Error { case focus }
}
