import XCTest

/// Drives the original native controls and embedded WK UI through real OS input.
/// AX contains read-only DOM/native observations from the test-only host.
final class NativeControlsTouchUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        if let media = ProcessInfo.processInfo.environment["PLAYER_LAB_CONTROLS_MEDIA_URL"] {
            app.launchEnvironment["PLAYER_LAB_CONTROLS_MEDIA_URL"] = media
        }
    }
    override func tearDownWithError() throws {
        if app.state == .runningForeground {
            record("final-native-touch-state", snapshot: try? readSnapshot())
            app.terminate()
        }
    }

    func testPausedLiveRewindVisibilityAndVodRecoveryThroughOrdinaryTouches() throws {
        try fixture("reset")
        WorkspaceUITestNavigation.launch(app)
        let playing = try waitSnapshot("licensed native live playback and Web UI") {
            $0["nativePlaying"] as? Bool == true && $0["nativeLive"] as? Bool == true &&
            $0["webUiReady"] as? Bool == true && self.controls($0, "seeks").count > 0 &&
            ($0["nativeMaxTimeShift"] as? Double ?? 0) < -5
        }
        assertHealthy(playing)
        try run("Player.pause()")
        let paused = try waitSnapshot("ordinary Pause input pauses native playback") { $0["nativePaused"] as? Bool == true }
        assertSameOwnership(playing, paused)
        let initial = try revealPausedControls(expectedSeekVisible: true, stage: "paused-live-revealed")

        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        try WorkspaceUITestNavigation.choose("Live controls", picker: "workspace.more.section", in: app)
        let preference = app.switches["dvr.allowControls"]
        XCTAssertTrue(preference.isEnabled)
        XCTAssertEqual(preference.value as? String, "1")
        let beforeOff = try readSnapshot()
        try WorkspaceUITestNavigation.activate(preference, in: app)
        let hidden = try waitSnapshot("ordinary toggle hides seeking while playback controls stay visible") {
            self.newer($0, than: beforeOff) && $0["appRewindEnabled"] as? Bool == false &&
            self.seekVisibility($0, equals: false) && self.visiblePlayback($0)
        }
        assertSamePausedPlayback(beforeOff, hidden)
        assertSamePausedPlayback(initial, hidden)
        record("paused-live-rewind-hidden-by-native-toggle", snapshot: hidden)
        _ = try revealPausedControls(expectedSeekVisible: false, stage: "paused-live-disabled-after-native-reveal")

        let beforeOn = try readSnapshot()
        try WorkspaceUITestNavigation.activate(preference, in: app)
        let restored = try waitSnapshot("ordinary toggle restores seeking on the same paused playback") {
            self.newer($0, than: beforeOn) && $0["appRewindEnabled"] as? Bool == true &&
            self.seekVisibility($0, equals: true) && self.visiblePlayback($0)
        }
        assertSamePausedPlayback(beforeOn, restored)
        assertSamePausedPlayback(initial, restored)
        record("paused-live-rewind-restored-by-native-toggle", snapshot: restored)

        // Use the compact playback button's observed bounds, never the large
        // paused-video Play overlay, to resume through ordinary native input.
        let beforePlay = try revealPausedControls(expectedSeekVisible: true, stage: "paused-before-native-play-button")
        let button = try XCTUnwrap(controls(beforePlay, "playback").first { $0["visible"] as? Bool == true })
        let rect = try XCTUnwrap(button["rect"] as? [String: Any])
        try tapCssPoint(x: try number(rect, "x") + number(rect, "width") / 2,
                        y: try number(rect, "y") + number(rect, "height") / 2, snapshot: beforePlay)
        let advancing = try waitSnapshot("the same native playback resumes and advances after the real playback-button tap") {
            $0["nativePlaying"] as? Bool == true &&
            ($0["nativeCurrentTime"] as? Double ?? 0) > (beforePlay["nativeCurrentTime"] as? Double ?? 0) + 1
        }
        assertSameOwnership(initial, advancing)
        assertHealthy(advancing)
        record("same-native-playback-advances-after-native-play-button", snapshot: advancing)

        try run("Player.pause()")
        _ = try waitSnapshot("native playback pauses before the VOD transition") { $0["nativePaused"] as? Bool == true }
        try WorkspaceUITestNavigation.activate(app.buttons["workspace.more"], in: app)
        let beforeVodOff = try readSnapshot()
        try WorkspaceUITestNavigation.activate(preference, in: app)
        let disabled = try waitSnapshot("live preference is off before the intentional source reload") {
            self.newer($0, than: beforeVodOff) && $0["appRewindEnabled"] as? Bool == false && self.seekVisibility($0, equals: false)
        }
        assertSamePausedPlayback(beforeVodOff, disabled)
        if let vodURL = ProcessInfo.processInfo.environment["PLAYER_LAB_CONTROLS_VOD_MEDIA_URL"] {
            try fixture("finalize", controlURL: ProcessInfo.processInfo.environment["PLAYER_LAB_CONTROLS_VOD_CONTROL_URL"])
            try WorkspaceUITestNavigation.setting("configuration.sourceURL", in: app)
            try WorkspaceUITestNavigation.replace(app.textFields["configuration.sourceURL"], with: vodURL, in: app)
            try WorkspaceUITestNavigation.activate(app.buttons["configuration.apply"], in: app)
        } else {
            try fixture("finalize")
            try run("Player.load(source:)")
        }
        let vod = try waitSnapshot("ordinary reload loads the finalized VOD source") {
            ($0["sourceIdentity"] as? String) != (disabled["sourceIdentity"] as? String) &&
            $0["nativePlaying"] as? Bool == true && $0["nativeLive"] as? Bool == false &&
            ($0["nativeDuration"] as? Double ?? 0) > 0
        }
        XCTAssertEqual(vod["playerIdentity"] as? String, initial["playerIdentity"] as? String)
        XCTAssertEqual(vod["viewIdentity"] as? String, initial["viewIdentity"] as? String)
        XCTAssertEqual(vod["sourceLoads"] as? Int, (initial["sourceLoads"] as? Int ?? 0) + 1)
        XCTAssertEqual(vod["appRewindEnabled"] as? Bool, false)
        try run("Player.pause()")
        _ = try waitSnapshot("VOD pauses through the ordinary native API control") { $0["nativePaused"] as? Bool == true }
        _ = try revealPausedControls(expectedSeekVisible: true, stage: "vod-seeking-visible-with-live-preference-off")
    }

    private func revealPausedControls(expectedSeekVisible: Bool, stage: String) throws -> [String: Any] {
        let before = try readSnapshot()
        XCTAssertEqual(before["nativePaused"] as? Bool, true)
        let web = try XCTUnwrap(before["web"] as? [String: Any])
        let point = try XCTUnwrap(web["safeRevealPoint"] as? [String: Any], "A real control-bar padding hit must be available; do not tap the paused Play overlay")
        try tapCssPoint(x: number(point, "x"), y: number(point, "y"), snapshot: before)
        let after = try waitSnapshot(stage) {
            self.newer($0, than: before) && self.visiblePlayback($0) && self.seekVisibility($0, equals: expectedSeekVisible)
        }
        assertSamePausedPlayback(before, after)
        record(stage + "-before-native-padding-tap", snapshot: before)
        record(stage + "-after-native-padding-tap", snapshot: after)
        return after
    }

    private func tapCssPoint(x: Double, y: Double, snapshot: [String: Any]) throws {
        let web = try XCTUnwrap(snapshot["web"] as? [String: Any])
        let screen = try XCTUnwrap(web["screenBounds"] as? [String: Any])
        let screenX = try number(screen, "x") + x * number(screen, "width") / number(web, "width")
        let screenY = try number(screen, "y") + y * number(screen, "height") / number(web, "height")
        XCTAssertTrue(app.frame.contains(CGPoint(x: screenX, y: screenY)))
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: screenX - app.frame.minX, dy: screenY - app.frame.minY)).tap()
    }

    private func run(_ rawValue: String) throws {
        try WorkspaceUITestNavigation.activate(app.buttons["api.open"], in: app)
        try WorkspaceUITestNavigation.activate(app.buttons["api.operation"], in: app)
        let candidate = app.buttons["api.operation.select.\(rawValue)"]
        if !candidate.exists || !candidate.isHittable {
            try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: rawValue, in: app)
        }
        try WorkspaceUITestNavigation.activate(candidate, in: app)
        XCTAssertTrue(app.buttons["api.run"].isEnabled)
        try WorkspaceUITestNavigation.activate(app.buttons["api.run"], in: app)
    }

    private func assertSameOwnership(_ before: [String: Any], _ after: [String: Any]) {
        for key in ["playerIdentity", "sourceIdentity", "viewIdentity"] {
            XCTAssertNotEqual(before[key] as? String, "nil")
            XCTAssertEqual(before[key] as? String, after[key] as? String, "Native \(key) must not change")
        }
        XCTAssertEqual(before["sourceLoads"] as? Int, after["sourceLoads"] as? Int, "Ordinary controls must not reload the Source")
    }

    private func assertSamePausedPlayback(_ before: [String: Any], _ after: [String: Any]) {
        assertSameOwnership(before, after)
        XCTAssertEqual(before["nativePaused"] as? Bool, true)
        XCTAssertEqual(after["nativePaused"] as? Bool, true)
        XCTAssertEqual(after["nativePlaying"] as? Bool, false)
        XCTAssertEqual(before["nativeCurrentTime"] as? Double ?? .nan,
                       after["nativeCurrentTime"] as? Double ?? .nan, accuracy: 0.25,
                       "A native reveal or preference toggle must not resume or jump paused playback")
        assertHealthy(after)
    }

    private func assertHealthy(_ snapshot: [String: Any]) {
        XCTAssertEqual(snapshot["setupError"] as? String, "")
        for key in ["sourceErrors", "playerErrors", "observationFailures"] { XCTAssertEqual(snapshot[key] as? Int, 0, key) }
        XCTAssertEqual(snapshot["apiEventsEmpty"] as? Bool, true)
        XCTAssertEqual(snapshot["sdkVersion"] as? String, "3.128.0")
    }

    private func controls(_ snapshot: [String: Any], _ name: String) -> [[String: Any]] {
        (snapshot["web"] as? [String: Any])?[name] as? [[String: Any]] ?? []
    }
    private func visiblePlayback(_ snapshot: [String: Any]) -> Bool { controls(snapshot, "playback").contains { $0["visible"] as? Bool == true } }
    private func seekVisibility(_ snapshot: [String: Any], equals visible: Bool) -> Bool {
        let seeks = controls(snapshot, "seeks")
        return !seeks.isEmpty && (visible ? seeks.contains { $0["visible"] as? Bool == true } : seeks.allSatisfy { $0["visible"] as? Bool == false })
    }
    private func newer(_ value: [String: Any], than previous: [String: Any]) -> Bool { (value["sequence"] as? Int ?? 0) > (previous["sequence"] as? Int ?? 0) }
    private func number(_ values: [String: Any], _ key: String) throws -> Double { try XCTUnwrap(values[key] as? Double) }

    private func readSnapshot() throws -> [String: Any] {
        let value = try XCTUnwrap(app.staticTexts["qualification.observation"].value as? String)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }
    private func waitSnapshot(_ stage: String, predicate: @escaping ([String: Any]) -> Bool) throws -> [String: Any] {
        var result: [String: Any]?
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard let snapshot = try? self.readSnapshot(), predicate(snapshot) else { return false }
            result = snapshot
            return true
        }, object: nil)
        guard XCTWaiter.wait(for: [expectation], timeout: 45) == .completed, let result else {
            record("native-touch-timeout-" + stage, snapshot: try? readSnapshot())
            XCTFail("Timed out waiting for \(stage)")
            throw QualificationFailure.deadline
        }
        return result
    }
    private func record(_ stage: String, snapshot: [String: Any]?) {
        if let snapshot, let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) {
            let attachment = XCTAttachment(string: text); attachment.name = stage + "-observation"; attachment.lifetime = .keepAlways; add(attachment)
            print("Apple ordinary-touch observation: " + text)
        }
        let screen = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); screen.name = stage + "-screen"; screen.lifetime = .keepAlways; add(screen)
    }
    private func fixture(_ action: String, controlURL: String? = nil) throws {
        let complete = expectation(description: "Public fixture " + action)
        let control = controlURL ?? ProcessInfo.processInfo.environment["PLAYER_LAB_CONTROLS_CONTROL_URL"] ?? "http://localhost:5199"
        var request = URLRequest(url: try XCTUnwrap(URL(string: "\(control)/\(action)")))
        request.httpMethod = "POST"
        var status: Int?
        URLSession.shared.dataTask(with: request) { _, response, _ in status = (response as? HTTPURLResponse)?.statusCode; complete.fulfill() }.resume()
        wait(for: [complete], timeout: 10)
        XCTAssertEqual(status, 200)
    }
    private enum QualificationFailure: Error { case deadline }
}
