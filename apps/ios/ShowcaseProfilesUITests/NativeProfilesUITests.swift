import XCTest

/// Actual production Profiles controls in an isolated, license-free test application.
/// Ownership assertions concern NativeWorkspaceDraft, never active licensed playback.
final class NativeProfilesUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testEnglishSaveRelaunchRestoreDraftAndDelete() throws { try lifecycle(language: "en") }
    func testJapaneseSaveRelaunchRestoreDraftAndDelete() throws { try lifecycle(language: "ja") }
    func testEnglishDifferentSDKCancelAndConfirm() throws { try differentSDK(language: "en") }
    func testJapaneseDifferentSDKCancelAndConfirm() throws { try differentSDK(language: "ja") }

    private func lifecycle(language: String) throws {
        let app = XCUIApplication()
        let store = UUID().uuidString
        defer { app.terminate() }
        try launch(app, store: store, language: language, savedDraft: true)
        assertLocalizedControls(app, language: language)
        // Empty input must fail visibly before an ordinary literal name is accepted.
        try activate(app.buttons["configuration.profiles.save"], in: app)
        waitForLabel(app.staticTexts["configuration.profiles.status"], containing: language == "ja" ? "名前は1〜48文字" : "Use a profile name")
        try saveSource(app)
        assertSession(app, autoplay: true, restored: false)

        app.terminate()
        try launch(app, store: store, language: language)
        assertLocalizedControls(app, language: language)
        XCTAssertFalse(app.buttons["configuration.profiles.restore"].isEnabled, "Relaunch must not select or restore")
        XCTAssertEqual(app.buttons["configuration.profiles.selection"].value as? String,
                       language == "ja" ? "プロファイルを選択" : "Choose a profile")
        assertSession(app, autoplay: false, restored: false)
        try selectSource(app)
        assertSession(app, autoplay: false, restored: false)
        capture(app, language: language, stage: "selected-after-relaunch")

        try activate(app.buttons["configuration.profiles.restore"], in: app)
        waitForSession(app, autoplay: true, safeOverrideAbsent: true)
        assertSession(app, autoplay: true, restored: true)
        capture(app, language: language, stage: "restored-draft")
        try deleteSelected(app)
        assertSession(app, autoplay: true, restored: true)
        XCTAssertFalse(app.buttons["configuration.profiles.restore"].isEnabled)

        app.terminate()
        try launch(app, store: store, language: language)
        try activate(app.buttons["configuration.profiles.selection"], in: app)
        XCTAssertTrue(app.textFields["workspace.choice.filter"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["workspace.choice.option.Source"].exists, "Deletion must persist after another restart")
        capture(app, language: language, stage: "deleted-after-relaunch")
    }

    private func differentSDK(language: String) throws {
        let app = XCUIApplication()
        let store = UUID().uuidString
        defer { app.terminate() }
        try launch(app, store: store, language: language, savedDraft: true, olderSDK: true)
        XCTAssertNotEqual(try observation(app)["sdkVersion"] as? String, "3.127.0", "The saved SDK fixture must differ from the installed SDK")
        try saveSource(app)
        app.terminate()
        try launch(app, store: store, language: language)
        try selectSource(app)
        try activate(app.buttons["configuration.profiles.restore"], in: app)
        let confirm = try alertButton(app, identifier: "configuration.profiles.confirmSDK", labels: ["Revalidate and restore", "再検証して復元"])
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "A different SDK needs a visible confirmation")
        XCTAssertEqual(confirm.label, language == "ja" ? "再検証して復元" : "Revalidate and restore")
        capture(app, language: language, stage: "different-sdk-confirmation")
        try activate(alertButton(app, identifier: "configuration.profiles.cancel", labels: ["Cancel", "キャンセル"]), in: app)
        XCTAssertTrue(confirm.waitForNonExistence(timeout: 5))
        assertSession(app, autoplay: false, restored: false)

        try activate(app.buttons["configuration.profiles.restore"], in: app)
        try activate(alertButton(app, identifier: "configuration.profiles.confirmSDK", labels: ["Revalidate and restore", "再検証して復元"]), in: app)
        waitForSession(app, autoplay: true, safeOverrideAbsent: true)
        assertSession(app, autoplay: true, restored: true)
        capture(app, language: language, stage: "different-sdk-restored-draft")
        try deleteSelected(app)
        assertSession(app, autoplay: true, restored: true)
    }

    private func launch(_ app: XCUIApplication, store: String, language: String,
                        savedDraft: Bool = false, olderSDK: Bool = false) throws {
        app.launchArguments = ["--profile-ui-store", store, "-AppleLanguages", "(\(language))",
                               "-AppleLocale", language == "ja" ? "ja_JP" : "en_US"]
        if savedDraft { app.launchArguments.append("--profile-ui-saved-draft") }
        if olderSDK { app.launchArguments.append("--profile-ui-older-sdk") }
        app.launch()
        let save = app.buttons["configuration.profiles.save"]
        XCTAssertTrue(save.waitForExistence(timeout: 10))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: save)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, "The isolated profile store must load")
        _ = try observation(app)
    }

    private func saveSource(_ app: XCUIApplication) throws {
        let name = app.textFields["configuration.profiles.name"]
        try activate(name, in: app)
        #if os(iOS)
        // A tappable field can show a caret before the first keyboard is ready.
        // Re-tap once if needed; hardware input need not show a software keyboard.
        // typeText still checks real keyboard focus and the value assertion below.
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            try activate(name, in: app)
            let keyboardVisible = app.keyboards.firstMatch.waitForExistence(timeout: 3)
            print("PROFILES_NAME_INPUT nativeRetap=true softwareKeyboardVisible=\(keyboardVisible)")
        }
        #endif
        #if os(iOS)
        // Send each character once and observe its native value before the next.
        // A complete synthetic request alone does not prove that every character
        // reached the field. Never clear, replace, resend or accept partial text.
        var prefix = ""
        for character in "Source" {
            name.typeText(String(character))
            prefix.append(character)
            XCTAssertEqual(name.value as? String, prefix, "Each native character must commit its exact prefix")
        }
        #else
        name.typeText("Source")
        #endif
        WorkspaceUITestNavigation.dismissKeyboard(in: app)
        // Keep the existing final acknowledgment budget and exact-value guard.
        let committedName = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Source"), object: name)
        XCTAssertEqual(XCTWaiter.wait(for: [committedName], timeout: 5), .completed,
                       "The single native input must commit the complete profile name")
        XCTAssertEqual(name.value as? String, "Source")
        try activate(app.buttons["configuration.profiles.save"], in: app)
        let status = app.staticTexts["configuration.profiles.status"]
        let updated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            status.exists && (status.label.contains("Saved profiles updated") || status.label.contains("保存済みプロファイルを更新"))
        }, object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [updated], timeout: 10), .completed, "A normal name must save through the native store")
    }

    private func selectSource(_ app: XCUIApplication) throws {
        let picker = app.buttons["configuration.profiles.selection"]
        try activate(picker, in: app)
        let option = app.buttons["workspace.choice.option.Source"]
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        XCTAssertEqual(option.label, "Source", "A user name overlapping a localization key stays literal")
        try activate(option, in: app)
        XCTAssertTrue(app.textFields["workspace.choice.filter"].waitForNonExistence(timeout: 5))
        XCTAssertEqual(picker.value as? String, "Source")
    }

    private func deleteSelected(_ app: XCUIApplication) throws {
        try activate(app.buttons["configuration.profiles.delete"], in: app)
        try activate(alertButton(app, identifier: "configuration.profiles.confirmDelete", labels: ["Delete profile", "プロファイルを削除"]), in: app)
        let committed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let selection = app.buttons["configuration.profiles.selection"].value as? String else { return false }
            return selection != "Source" && app.buttons["configuration.profiles.save"].isEnabled
                && !app.buttons["configuration.profiles.restore"].isEnabled
        }, object: app)
        // Busy state disables Restore before the write completes. Await the
        // post-commit selection and enabled Save before terminating the app.
        XCTAssertEqual(XCTWaiter.wait(for: [committed], timeout: 10), .completed)
    }

    private func assertLocalizedControls(_ app: XCUIApplication, language: String) {
        XCTAssertEqual(app.buttons["configuration.profiles.save"].label, language == "ja" ? "プロファイルを保存" : "Save profile")
        XCTAssertEqual(app.buttons["configuration.profiles.restore"].label, language == "ja" ? "下書きに復元" : "Restore draft")
        XCTAssertEqual(app.buttons["configuration.profiles.selection"].label, language == "ja" ? "保存済みプロファイル" : "Saved profiles")
    }

    private enum AlertObservationError: Error { case readinessBudgetExpired }

    private func alertButton(_ app: XCUIApplication, identifier: String, labels: [String]) throws -> XCUIElement {
        let deadline = ProcessInfo.processInfo.systemUptime + 5
        func remainingBudget() throws -> TimeInterval {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else {
                XCTFail("The native alert must resolve within the existing five-second readiness budget")
                throw AlertObservationError.readinessBudgetExpired
            }
            return remaining
        }
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: try remainingBudget()), "The native system alert must appear")
        _ = try remainingBudget()
        // Bind one evaluation to concrete accessibility elements. Snapshot child
        // traversal below is local; the wait predicate never re-enumerates actions.
        let actions = alert.buttons.matching(NSPredicate(format: "label IN %@", labels))
            .allElementsBoundByAccessibilityElement
        _ = try remainingBudget()
        let observed = try actions.map { element -> (element: XCUIElement, snapshot: any XCUIElementSnapshot) in
            let snapshot = try element.snapshot()
            _ = try remainingBudget()
            return (element, snapshot)
        }
        let enabled = observed.filter {
            $0.snapshot.isEnabled && $0.snapshot.frame.width > 0 && $0.snapshot.frame.height > 0
        }
        #if os(tvOS)
        let eligible = enabled.count == 1 ? enabled : enabled.filter { candidate in
            // tvOS focuses a native parent while SwiftUI identifies its child.
            // Retain the same unique-child and exact physical-frame conditions.
            let children = buttonDescendants(candidate.snapshot).filter { $0.identifier == identifier }
            return children.count == 1 && candidate.snapshot.frame == children[0].frame
        }
        #else
        let eligible = enabled.filter { buttonDescendants($0.snapshot).isEmpty }
        #endif
        XCTAssertEqual(eligible.count, 1, "Exactly one native alert action must match \(identifier)")
        let action = try XCTUnwrap(eligible.count == 1 ? eligible.first?.element : nil,
                                  "Do not select an arbitrary duplicate alert action")
        #if !os(tvOS)
        _ = try remainingBudget()
        // Predicate expectations first poll after about one second. Observe an
        // already-hittable bound action before spending that polling interval.
        let immediatelyHittable = action.isHittable
        _ = try remainingBudget()
        if !immediatelyHittable {
            let hittable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in action.isHittable }, object: action)
            XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: try remainingBudget()), .completed,
                           "The same bound native action must be hittable")
            _ = try remainingBudget()
        }
        #endif
        XCTAssertTrue(action.isEnabled, "The native action must remain enabled")
        _ = try remainingBudget()
        return action
    }

    private func buttonDescendants(_ snapshot: any XCUIElementSnapshot) -> [any XCUIElementSnapshot] {
        snapshot.children.flatMap { child in
            (child.elementType == .button ? [child] : []) + buttonDescendants(child)
        }
    }

    private func observation(_ app: XCUIApplication) throws -> [String: Any] {
        let label = app.staticTexts["profiles.test.session"]
        XCTAssertTrue(label.exists || label.waitForExistence(timeout: 5))
        let value = try XCTUnwrap(label.value as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }

    private func waitForSession(_ app: XCUIApplication, autoplay: Bool, safeOverrideAbsent: Bool) {
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // A native alert can temporarily hide the underlying accessibility
            // node. Poll without recording a test failure for that intermediate
            // state; the bounded wait and final session assertions remain strict.
            let label = app.staticTexts["profiles.test.session"]
            guard label.exists, let value = label.value as? String,
                  let decoded = try? JSONSerialization.jsonObject(with: Data(value.utf8)),
                  let state = decoded as? [String: Any] else { return false }
            return state["autoplay"] as? Bool == autoplay && state["safeOverrideAbsent"] as? Bool == safeOverrideAbsent
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed)
    }

    private func assertSession(_ app: XCUIApplication, autoplay: Bool, restored: Bool) {
        do {
            let state = try observation(app)
            XCTAssertEqual(state["autoplay"] as? Bool, autoplay)
            XCTAssertEqual(state["appliedUnchanged"] as? Bool, true, "Profiles must not update the applied session snapshot")
            XCTAssertEqual(state["sourceFieldsUnchanged"] as? Bool, true, "Excluded current source draft fields must retain ownership")
            XCTAssertEqual(state["excludedOverrideUnchanged"] as? Bool, true)
            if !restored { XCTAssertEqual(state["draftUnchanged"] as? Bool, true, "Save, selection and cancellation must preserve the entire draft") }
            if restored {
                XCTAssertEqual(Double(state["startOffset"] as? String ?? ""), 25)
                XCTAssertEqual(state["safeOverrideAbsent"] as? Bool, true, "Omitted safe overrides must be cleared")
                XCTAssertEqual(state["sourceURL"] as? String, "https://fixture.invalid/current.mp4")
            }
        } catch { XCTFail("Actual session observation must decode: \(error)") }
    }

    private func waitForLabel(_ element: XCUIElement, containing value: String) {
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 5), .completed)
    }

    private func capture(_ app: XCUIApplication, language: String, stage: String) {
        #if os(tvOS)
        let platform = "tvos"
        #else
        let platform = "ios"
        #endif
        WorkspaceUITestNavigation.capture(app, named: "profiles-\(platform)-\(language)-\(stage)", test: self)
    }

    private func activate(_ element: XCUIElement, in app: XCUIApplication) throws {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 5))
        #if os(tvOS)
        // The isolated panel has no playback column or workspace navigation. Use
        // native remote focus with a bounded geometric route through its controls.
        var attempts: [String: Int] = [:]
        for _ in 0..<24 {
            if element.hasFocus || element.descendants(matching: .any).allElementsBoundByIndex.contains(where: { $0.hasFocus }) {
                XCUIRemote.shared.press(.select)
                return
            }
            guard let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true"))
                .allElementsBoundByIndex.last(where: { $0.frame.width > 0 && $0.frame.height > 0 }) else { break }
            let current = focused.frame
            let target = element.frame
            let direction: XCUIRemote.Button = abs(current.midY - target.midY) > 12
                ? (target.midY < current.midY ? .up : .down) : (target.midX < current.midX ? .left : .right)
            let step = "\(focused.identifier)|\(current)|\(direction)"
            attempts[step, default: 0] += 1
            if attempts[step, default: 0] > 2 { break }
            XCUIRemote.shared.press(direction)
        }
        capture(app, language: "focus", stage: "unreachable-\(element.identifier)")
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "profiles-tv-focus-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        XCTFail("The native remote must reach \(element.identifier)")
        throw NavigationFailure.unreachable
        #else
        XCTAssertTrue(WorkspaceUITestNavigation.waitUntilHittable(element))
        element.tap()
        #endif
    }

    private enum NavigationFailure: Error { case unreachable }
}
