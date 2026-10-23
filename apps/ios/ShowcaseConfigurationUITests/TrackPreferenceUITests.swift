import XCTest

/// Uses the normal app, actual form controls and SDK-backed visible track/position labels.
/// Serve the generated 60-second native-subtitle HLS fixture before running this opt-in test.
final class TrackPreferenceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testInitialLanguagesScalingAndSourceReloadThroughNormalGui() throws {
        let app = XCUIApplication()
        WorkspaceUITestNavigation.launch(app)
        defer { app.terminate() }
        let open = app.buttons["configuration.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        // Configure this VOD fixture from a VOD preset. The initial live source
        // has its own playback/state/advancement smoke test.
        try WorkspaceUITestNavigation.choose("VOD HLS", picker: "source.preset", in: app)
        XCTAssertEqual(app.buttons["source.preset"].value as? String, "VOD HLS")
        try activate(open, in: app)
        let environment = ProcessInfo.processInfo.environment
        let media = environment["PLAYER_LAB_TEST_MEDIA_URL"]
            ?? "http://127.0.0.1:5284/vod-multiaudio/master.m3u8"
        let expectedAudio = environment["PLAYER_LAB_TEST_EXPECT_AUDIO"] ?? "de"
        try replace("configuration.sourceURL", with: media, in: app)
        try replace("configuration.title", with: "Initial track preferences", in: app)
        try replace("configuration.startOffset", with: "5", in: app)
        let autoplay = app.switches["configuration.autoplay"]
        try WorkspaceUITestNavigation.setting("configuration.autoplay", in: app)
        if autoplay.value as? String != "1" { try activate(autoplay, in: app) }
        try replace("configuration.audioLanguage", with: "de-AT", in: app)
        try choose("Preferred language", picker: "configuration.subtitleMode", in: app)
        try replace("configuration.subtitleLanguage", with: "de", in: app)
        try choose("Fill (crop)", picker: "configuration.videoScaling", in: app)
        XCTAssertEqual(app.staticTexts["configuration.effect"].label, "Recreate player and reload source")
        try activate(app.buttons["configuration.apply"], in: app)
        try expectPlayback(audio: expectedAudio, subtitle: "de", app: app, stage: "German")
        #if !os(tvOS)
        try WorkspaceUITestNavigation.choose("Advanced SDK", picker: "configuration.category", in: app)
        XCTAssertTrue(app.buttons["playback.compact.toggle"].isHittable)
        XCTAssertEqual(app.buttons["playback.compact.toggle"].label, "Play")
        try activate(app.buttons["playback.compact.toggle"], in: app)
        capture(app, name: "Advancing playback miniature")
        try activate(app.buttons["playback.preview.expand"], in: app)
        try expectPlayback(audio: expectedAudio, subtitle: "de", app: app, stage: "German after preview expansion", pauseAfterProof: false)
        try activate(app.buttons["playback.preview.collapse"], in: app)
        XCTAssertTrue(app.buttons["playback.compact.toggle"].isHittable)
        try WorkspaceUITestNavigation.setting("configuration.audioLanguage", in: app)
        try choose("Sports", picker: "player.theme", in: app)
        try expectPlayback(audio: "de", subtitle: "de", app: app, stage: "German in Sports after UI recreation")
        #endif

        // A subtitle-only change uses the existing player. The hosted SDK test checks identity.
        try activate(open, in: app)
        try WorkspaceUITestNavigation.setting("configuration.audioLanguage", in: app)
        capture(app, name: "guide-initial-languages-form")
        try WorkspaceUITestNavigation.setting("configuration.videoScaling", in: app)
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
        try choose("Default", picker: "player.theme", in: app)
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
        try activate(app.buttons["configuration.open"], in: app)
    }

    private func expectPlayback(audio: String, subtitle: String?, app: XCUIApplication, stage: String, pauseAfterProof: Bool = true) throws {
        try WorkspaceUITestNavigation.expandPlaybackPreview(in: app)
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
        guard pauseAfterProof else { return }
        // Pause through the app after proving playback. The short fixture must
        // not reach its end while subsequent settings are being entered.
        try activate(app.buttons["api.open"], in: app)
        if !app.staticTexts["api.target"].label.contains("Player.pause()") {
            try activate(app.buttons["api.operation"], in: app)
            try WorkspaceUITestNavigation.replace(app.textFields["api.operation.filter"], with: "Player.pause()", in: app)
            try activate(app.buttons["api.operation.select.Player.pause()"], in: app)
        }
        try activate(app.buttons["api.run"], in: app)
        XCTAssertEqual(app.staticTexts["api.related.Player.isPaused"].label, "true")
        try activate(app.buttons["configuration.open"], in: app)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func choose(_ value: String, picker: String, in app: XCUIApplication) throws {
        if picker.hasPrefix("configuration."), WorkspaceUITestNavigation.fields[picker.replacingOccurrences(of: "configuration.", with: "")] != nil {
            try WorkspaceUITestNavigation.setting(picker, in: app)
        }
        try WorkspaceUITestNavigation.choose(value, picker: picker, in: app)
    }

    private func replace(_ identifier: String, with text: String, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.setting(identifier, in: app)
        try WorkspaceUITestNavigation.replace(app.textFields[identifier], with: text, in: app)
    }

    private func activate(_ element: XCUIElement, in app: XCUIApplication) throws {
        try WorkspaceUITestNavigation.activate(element, in: app)
    }

    #if !os(tvOS)
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        XCTAssertTrue(element.isHittable, "Selected workspace control must be visible without scrolling")
    }
    #endif
    private func seconds(_ label: String) -> Double {
        Double(label.replacingOccurrences(of: "Position: ", with: "").replacingOccurrences(of: "s", with: "")) ?? 0
    }
}
