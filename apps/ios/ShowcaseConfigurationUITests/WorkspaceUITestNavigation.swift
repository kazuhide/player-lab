import XCTest

/// Uses explicit workspace choices; no scrolling is used to reach editable settings or Apply.
enum WorkspaceUITestNavigation {
    static func launch(_ app: XCUIApplication, language: String = "en") {
        app.launchArguments += ["-AppleLanguages", "(\(language))", "-AppleLocale", language == "ja" ? "ja_JP" : "en_US"]
        app.launch()
    }

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
        let option = app.buttons["workspace.choice.option.\(value)"].firstMatch
        let expectedLabel = option.label
        try activate(option, in: app)
        XCTAssertTrue(app.textFields["workspace.choice.filter"].waitForNonExistence(timeout: 5))
        XCTAssertEqual(button.value as? String, expectedLabel)
        #else
        let identified = app.buttons["workspace.choice.option.\(value)"].firstMatch
        if identified.exists {
            try activate(identified, in: app)
            return
        }
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
        guard element.exists || element.waitForExistence(timeout: 5) else {
            XCTFail("Remote target must exist before moving focus")
            throw NavigationFailure.unreachable
        }
        let identifier = element.identifier
        var attempts: [String: Int] = [:]
        let editorLeft = app.buttons["configuration.open"].frame.minX
        let workspaceNavigation = ["configuration.open", "api.open", "configuration.code.toggle", "workspace.more"]
        for _ in 0..<24 {
            guard element.exists else {
                recordFocusFailure(app, message: "Remote target disappeared: \(identifier)")
                throw NavigationFailure.unreachable
            }
            if element.hasFocus || element.descendants(matching: .any).allElementsBoundByIndex.contains(where: { $0.hasFocus }) {
                XCUIRemote.shared.press(.select)
                return
            }
            let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true"))
                .allElementsBoundByIndex.last { $0.frame.width > 0 && $0.frame.height > 0 }
            guard let focused else {
                recordFocusFailure(app, message: "No focused control while reaching \(identifier)")
                throw NavigationFailure.unreachable
            }
            if focused.elementType == .cell && !identifier.isEmpty && focused.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists {
                // A native TV List row owns focus for its identified Button.
                XCUIRemote.shared.press(.select)
                return
            }
            let current = focused.frame
            let target = element.frame
            var direction: XCUIRemote.Button
            if workspaceNavigation.contains(identifier), focused.identifier.hasPrefix("configuration.code.line.") {
                // Back returns from the editor to the current fixed tab without
                // traversing the document or entering the SDK playback controls.
                XCUIRemote.shared.press(.menu)
                continue
            } else if current.midX < editorLeft && target.midX >= editorLeft {
                // Enter the editor before moving down past AVKit transport controls.
                direction = .right
            } else if target.maxX < editorLeft && current.midX >= editorLeft && current.minY > target.maxY {
                direction = .up
            } else if abs(current.midY - target.midY) > 8 {
                // Focus enlargement may overlap an adjacent row's rectangle.
                direction = target.midY < current.midY ? .up : .down
            } else {
                direction = target.midX < current.midX ? .left : .right
            }
            let verticalStep = "\(focused.identifier)|\(current)|\(direction)"
            if (direction == .up || direction == .down), attempts[verticalStep, default: 0] > 0,
               current.maxX < target.minX || target.maxX < current.minX {
                // A narrow field can be in another column from its header choice.
                // Align horizontally before repeating a vertical route that did not reach it.
                direction = target.midX < current.midX ? .left : .right
            }
            let step = "\(focused.identifier)|\(current)|\(direction)"
            attempts[step, default: 0] += 1
            guard attempts[step, default: 0] <= 2 else {
                recordFocusFailure(app, message: "Remote focus stopped before \(identifier): \(step)")
                throw NavigationFailure.unreachable
            }
            XCUIRemote.shared.press(direction)
        }
        recordFocusFailure(app, message: "Remote focus must reach \(identifier) in a bounded route")
        throw NavigationFailure.unreachable
        #else
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 10))
        let control = interactiveControl(element, in: app)
        XCTAssertTrue(waitUntilHittable(control), "Control must be visible without scrolling: \(element.identifier), frame: \(element.frame)")
        control.tap()
        #endif
    }

    #if os(tvOS)
    private static func recordFocusFailure(_ app: XCUIApplication, message: String) {
        XCTContext.runActivity(named: message) { activity in
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "native-workspace-tv-focus-accessibility"
            hierarchy.lifetime = .keepAlways
            activity.add(hierarchy)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "native-workspace-tv-focus-screen"
            screenshot.lifetime = .keepAlways
            activity.add(screenshot)
        }
        XCTFail(message)
    }
    #endif

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

    static func expandPlaybackPreview(in app: XCUIApplication) throws {
        #if !os(tvOS)
        let expand = app.buttons["playback.preview.expand"]
        if expand.exists { try activate(expand, in: app) }
        #endif
        XCTAssertTrue(app.staticTexts["source.current"].waitForExistence(timeout: 5), "Playback metadata is shown in the expanded preview")
    }

    static func replace(_ field: XCUIElement, with text: String, in app: XCUIApplication) throws {
        try activate(field, in: app)
        let current = field.value as? String ?? ""
        #if !os(tvOS)
        print("Native input route OS_EDIT_MENU_V17: \(field.identifier); elementType=\(field.elementType.rawValue)")
        // Use the normal OS edit menu instead of keyboard-navigation shortcuts.
        // XCTest can report an empty editor's placeholder as its value.
        field.press(forDuration: 1)
        let labels = NSPredicate(format: "label IN %@", ["Select All", "すべてを選択"])
        let buttons = app.buttons.matching(labels)
        let menuItems = app.menuItems.matching(labels)
        func selectAll() -> XCUIElement? {
            (buttons.allElementsBoundByIndex + menuItems.allElementsBoundByIndex).first { $0.isHittable }
        }
        let menu = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in selectAll() != nil }, object: app)
        var result = XCTWaiter.wait(for: [menu], timeout: 5)
        if result != .completed && !current.isEmpty && current != field.placeholderValue {
            // A double tap selects a word and exposes the normal OS selection menu.
            // Keep this route bounded; the complete resulting value is still required.
            field.doubleTap()
            let retry = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in selectAll() != nil }, object: app)
            result = XCTWaiter.wait(for: [retry], timeout: 5)
        }
        if result == .completed, let option = selectAll() {
            option.tap()
        } else if !current.isEmpty && current != field.placeholderValue {
            XCTContext.runActivity(named: "Native Select All menu missing for \(field.identifier)") { activity in
                let hierarchy = XCTAttachment(string: app.debugDescription)
                hierarchy.name = "native-workspace-input-menu-accessibility"
                hierarchy.lifetime = .keepAlways
                activity.add(hierarchy)
                let screenshot = XCTAttachment(screenshot: app.screenshot())
                screenshot.name = "native-workspace-input-menu-screen"
                screenshot.lifetime = .keepAlways
                activity.add(screenshot)
            }
            XCTFail("The nonempty native editor must expose Select All: \(field.identifier)")
            throw NavigationFailure.unreachable
        }
        app.typeText(text)
        #else
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 5) + text)
        #endif
        XCTAssertEqual(field.value as? String, text)
        dismissKeyboard(in: app)
    }

    static func dismissKeyboard(in app: XCUIApplication) {
        #if os(tvOS)
        if app.keyboards.firstMatch.exists {
            XCUIRemote.shared.press(.menu)
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
            let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true"))
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in focused.count > 0 }, object: nil)
            if XCTWaiter.wait(for: [settled], timeout: 2) != .completed {
                // Native TV text entry can return with no focused element until
                // the next directional input. Resume with the user's Down action.
                XCUIRemote.shared.press(.down)
            }
        }
        #else
        for id in ["workspace.keyboard.done", "offline.keyboard.done", "cast.keyboard.done"] {
            let done = app.buttons[id]
            if done.exists && done.isHittable {
                done.tap()
                XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
                return
            }
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
