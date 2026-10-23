import XCTest

/// Uses explicit workspace choices; no scrolling is used to reach editable settings or Apply.
enum WorkspaceUITestNavigation {
    static let fields: [String: (String, String)] = [
        "sourceURL": ("Source", "Source URL"), "sourceType": ("Source", "Source type"),
        "title": ("Source", "Title"), "posterURL": ("Source", "Poster URL"),
        "startOffset": ("Start position", "Start offset"), "timelineReference": ("Start position", "Offset reference"),
        "autoplay": ("Playback", "Autoplay"), "startMuted": ("Playback", "Start muted"),
        "sdkTimeShift": ("Playback", "Live time shift"),
        "audioLanguage": ("Tracks", "Initial audio language"), "subtitleMode": ("Tracks", "Initial subtitles"),
        "subtitleLanguage": ("Tracks", "Initial subtitle language"),
        "maximumBitrate": ("Quality and buffer", "Maximum bitrate"), "forwardBuffer": ("Quality and buffer", "Forward buffer"),
        "videoScaling": ("Player UI", "Video scaling")
    ]

    static func setting(_ id: String, in app: XCUIApplication) throws {
        let key = id.replacingOccurrences(of: "configuration.", with: "")
        guard let (category, label) = fields[key] else {
            XCTFail("Unknown workspace setting: \(id)")
            throw NavigationFailure.unreachable
        }
        try activate(app.buttons["configuration.open"], in: app)
        try choose(category, picker: "configuration.category", in: app)
        try choose(label, picker: "configuration.setting", in: app)
        let target: XCUIElement
        if ["autoplay", "startMuted", "sdkTimeShift"].contains(key) { target = app.switches[id] }
        else if ["sourceType", "timelineReference", "subtitleMode", "videoScaling"].contains(key) { target = app.buttons[id] }
        else { target = app.textFields[id] }
        XCTAssertTrue(target.exists || target.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(interactiveControl(target, in: app)), "Selected setting must be reachable without scrolling: \(target)")
        XCTAssertTrue(waitUntilHittable(app.buttons["configuration.apply"]), "Apply must remain outside the field scroller")
    }

    static func choose(_ value: String, picker: String, in app: XCUIApplication) throws {
        let button = app.buttons[picker].firstMatch
        try activate(button, in: app)
        #if os(tvOS)
        let option = app.buttons[value].firstMatch
        try activate(option, in: app)
        #else
        let candidates = app.buttons.matching(NSPredicate(format: "label == %@", value))
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            candidates.allElementsBoundByIndex.contains { $0.isHittable && $0.identifier != picker }
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed, "Visible menu option: \(value)")
        guard let option = candidates.allElementsBoundByIndex.first(where: { $0.isHittable && $0.identifier != picker }) else {
            throw NavigationFailure.unreachable
        }
        option.tap()
        #endif
    }

    static func activate(_ element: XCUIElement, in app: XCUIApplication) throws {
        #if os(tvOS)
        for direction: XCUIRemote.Button in [.down, .right, .up, .left] {
            for _ in 0..<35 {
                if element.exists && (element.hasFocus || element.descendants(matching: .any).allElementsBoundByIndex.contains(where: { $0.hasFocus })) {
                    XCUIRemote.shared.press(.select)
                    return
                }
                XCUIRemote.shared.press(direction)
            }
        }
        XCTFail("Remote focus must reach \(element.identifier)")
        throw NavigationFailure.unreachable
        #else
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 10))
        let control = interactiveControl(element, in: app)
        XCTAssertTrue(waitUntilHittable(control), "Control must be visible without scrolling: \(element.identifier), frame: \(element.frame)")
        control.tap()
        #endif
    }

    private static func interactiveControl(_ element: XCUIElement, in app: XCUIApplication) -> XCUIElement {
        guard element.elementType == .switch, !element.isHittable else { return element }
        // SwiftUI can expose an identified semantic wrapper and a separate native switch.
        // Resolve only an enabled, hittable switch fully inside this exact labelled row.
        let row = element.frame.insetBy(dx: -1, dy: -1)
        let controls = app.switches.allElementsBoundByIndex.filter {
            $0.identifier != element.identifier && $0.isEnabled && $0.isHittable && row.contains($0.frame)
        }
        return controls.count == 1 ? controls[0] : element
    }

    static func waitUntilHittable(_ element: XCUIElement) -> Bool {
        if element.exists && element.isHittable { return true }
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: element)
        return XCTWaiter.wait(for: [ready], timeout: 5) == .completed
    }

    static func replace(_ field: XCUIElement, with text: String, in app: XCUIApplication) throws {
        try activate(field, in: app)
        let current = field.value as? String ?? ""
        #if !os(tvOS)
        field.typeKey("a", modifierFlags: .command)
        field.typeText(text)
        #else
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 5) + text)
        #endif
        XCTAssertEqual(field.value as? String, text)
        dismissKeyboard(in: app)
    }

    static func dismissKeyboard(in app: XCUIApplication) {
        #if os(tvOS)
        if app.keyboards.firstMatch.exists { XCUIRemote.shared.press(.menu) }
        #else
        for id in ["workspace.keyboard.done", "offline.keyboard.done", "cast.keyboard.done"] {
            let done = app.buttons[id]
            if done.exists && done.isHittable { done.tap(); return }
        }
        if app.keyboards.firstMatch.exists {
            let done = app.keyboards.buttons["Done"]
            if done.exists { done.tap() }
        }
        #endif
    }

    static func capture(_ app: XCUIApplication, named name: String, test: XCTestCase) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        test.add(attachment)
    }

    private enum NavigationFailure: Error { case unreachable }
}
