import XCTest
import UIKit
import CoreFoundation

/// Drives the installed opt-in entry through the same production App and SDK UI as a user.
final class RuntimeChecks: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.playerlab.reactnative")
    private var stages: [[String: Any]] = []
    private var result: [String: Any] = ["schemaVersion": 1, "platform": "ios", "passed": false]
    private var uiSequence = 0
    private var uiObservations: [[String: Any]] = []
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        result["stages"] = stages
        result["embeddedUiObservations"] = uiObservations
        // hasSucceeded is not final inside tearDown; the outer runner also requires the finalized xcresult.
        result["assertionFailures"] = testRun?.failureCount ?? -1
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            .write(to: documents.appendingPathComponent("runtime-report.json"), options: .atomic)
        app.terminate()
    }

    func testLiveRewindAndOperationAvailability() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let live = environment["PLAYER_LAB_LIVE_URL"], let vod = environment["PLAYER_LAB_MEDIA_URL"] else { throw Failure.input }
        app.launch()
        _ = try waitReport { ($0["owner"] as? [String: Any])?["viewReady"] as? Bool == true }
        try configureControlsSource(live)
        try chooseWorkspace("theme-selector", "Live (DVR)")
        let playing = try waitReport { value in
            guard let owner = value["owner"] as? [String: Any], let sample = owner["sample"] as? [String: Any] else { return false }
            return owner["sourceLoaded"] as? Int ?? 0 > 0 && sample["live"] as? Bool == true && sample["playing"] as? Bool == true &&
                (sample["maxTimeShift"] as? Double ?? 0) < -10
        }
        let video = app.descendants(matching: .any).matching(identifier: "player-lab-player").firstMatch
        let pixels = try moviePixels(video.screenshot().image)
        Thread.sleep(forTimeInterval: 1.5)
        let advanced = try waitReport { value in
            guard let owner = value["owner"] as? [String: Any], let sample = owner["sample"] as? [String: Any],
                  let original = playing["owner"] as? [String: Any], let previous = original["sample"] as? [String: Any] else { return false }
            return owner["generation"] as? Int == original["generation"] as? Int &&
                (sample["sequence"] as? Int ?? 0) > (previous["sequence"] as? Int ?? 0) &&
                (sample["time"] as? Double ?? 0) > (previous["time"] as? Double ?? 0)
        }
        let afterPixels = try moviePixels(video.screenshot().image)
        let ratio = Double(zip(pixels, afterPixels).filter { abs(Int($0.0) - Int($0.1)) > 12 }.count) / Double(pixels.count)
        XCTAssertGreaterThan(ratio, 0.01, "The live native picture must change with the native clock")
        result["livePlayback"] = ["samples": [playing, advanced], "videoRegionChangedRatio": ratio]
        result["phase"] = "loaded-source-api"
        try chooseOperation("Source.loadingState")
        try tapWorkspace("api-run")
        let wireQuery = app.descendants(matching: .any).matching(identifier: "api-result-value").firstMatch
        let wireOrigin = app.descendants(matching: .any).matching(identifier: "api-result-origin").firstMatch
        let wireDeadline = Date().addingTimeInterval(10)
        var loadingWire: Int?
        while Date() < wireDeadline {
            if wireOrigin.exists && wireOrigin.label == "Source.loadingState", Int(wireQuery.value as? String ?? wireQuery.label) == 2 {
                loadingWire = 2; break
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        result["loadingStateWire"] = try XCTUnwrap(loadingWire, "The real iOS bridge must report its loaded ordinal")
        try chooseOperation("Player.getMaxTimeShift")
        try tapWorkspace("api-run")
        let query = app.descendants(matching: .any).matching(identifier: "api-result-value").firstMatch
        let origin = app.descendants(matching: .any).matching(identifier: "api-result-origin").firstMatch
        let queryDeadline = Date().addingTimeInterval(10)
        var nativeWindow: Double?
        while Date() < queryDeadline {
            if origin.exists && origin.label == "Player.getMaxTimeShift", let value = Double(query.value as? String ?? query.label), value.isFinite && value < -10 {
                nativeWindow = value; break
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        result["loadedSourceApi"] = ["id": "Player.getMaxTimeShift", "value": try XCTUnwrap(nativeWindow, "The loaded source API must run through the normal GUI")]
        result["phase"] = "native-pause-and-rewind"
        try pauseControlsPlayback()
        try chooseOperation("Player.timeShift")
        try replace("Time (seconds)", "-10"); try tapWorkspace("api-run")
        let before = try waitReport { value in
            let sample = (value["owner"] as? [String: Any])?["sample"] as? [String: Any]
            return sample?["playing"] as? Bool == false && (sample?["timeShift"] as? Double ?? 0) < -5
        }
        let visibleBefore = try embeddedSeekbar(true)
        try tapWorkspace("workspace-nav-more"); try setSwitch("Allow DVR", false)
        let disabled = try report()
        let visibleDisabled = try embeddedSeekbar(false)
        try setSwitch("Allow DVR", true)
        let enabled = try report()
        let visibleEnabled = try embeddedSeekbar(true)
        result["liveControlSamples"] = [before, disabled, enabled]
        result["liveControls"] = ["seekbarVisible": [visibleBefore, visibleDisabled, visibleEnabled]]
        let originalOwner = try XCTUnwrap(before["owner"] as? [String: Any])
        for value in [disabled, enabled] {
            let owner = try XCTUnwrap(value["owner"] as? [String: Any])
            let sample = try XCTUnwrap(owner["sample"] as? [String: Any])
            for key in ["generation", "sourceLoads", "sourceLoaded"] { XCTAssertEqual(owner[key] as? Int, originalOwner[key] as? Int) }
            XCTAssertEqual(sample["playing"] as? Bool, false)
            XCTAssertLessThan(try XCTUnwrap(sample["timeShift"] as? Double), -5)
        }
        try configureControlsSource(vod)
        try tapWorkspace("workspace-nav-more"); try setSwitch("Allow DVR", false)
        let ordinary = try waitReport { value in
            let owner = value["owner"] as? [String: Any]
            let sample = owner?["sample"] as? [String: Any]
            return owner?["sourceLoaded"] as? Int ?? 0 > 0 && sample?["live"] as? Bool == false && sample?["playing"] as? Bool == true
        }
        try pauseControlsPlayback()
        let vodVisible = try embeddedSeekbar(true)
        var unavailable: [Bool] = []
        for id in ["Player.skipAd", "Player.scheduleAd"] {
            try openOperationPicker(id)
            let option = app.buttons.matching(identifier: "api-operation-selector-option-" + id).firstMatch
            XCTAssertTrue(option.exists && !option.isEnabled, "Ordinary VOD must disable the unavailable ad operation")
            unavailable.append(option.exists && !option.isEnabled)
            try tap("Close", scroll: false)
        }
        result["vodSample"] = ordinary
        result["vodControls"] = ["seekbarVisible": vodVisible, "skipAdUnavailable": unavailable[0], "scheduleAdUnavailable": unavailable[1]]
        try tap("Finish runtime checks", scroll: false)
        let finished = try waitReport { $0["owner"] is NSNull }
        let retired = try XCTUnwrap(finished["retired"] as? [[String: Any]])
        XCTAssertEqual(retired.count, finished["created"] as? Int)
        XCTAssertTrue(retired.allSatisfy { $0["wrapperDestroyed"] as? Bool == true })
        result["final"] = finished
        result["wrapperDestroyFlagsConfirmed"] = true
        result["nativeReleaseAcknowledgementAvailable"] = false
        result["passed"] = true
    }

    private func tapWorkspace(_ identifier: String) throws {
        // RN workspace tabs have a tab role, so match their exact native identifier across element types.
        let control = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 5) && control.isHittable && control.isEnabled, "Workspace control must be usable")
        control.tap()
    }
    private func chooseWorkspace(_ identifier: String, _ value: String) throws {
        try tapWorkspace(identifier); try tapWorkspace(identifier + "-option-" + value)
    }
    private func controlsField(_ group: String, _ field: String) throws {
        try tapWorkspace("workspace-nav-settings")
        try chooseWorkspace("configuration-group-selector", group)
        try chooseWorkspace("workspace-setting-selector", field)
    }
    private func configureControlsSource(_ url: String) throws {
        try controlsField("source", "url"); try replace("Source URL", url)
        try controlsField("source", "type"); if app.buttons["HLS"].isEnabled { try tap("HLS", scroll: false) }
        try controlsField("source", "startOffset"); try replace("Start offset (seconds)", "")
        try controlsField("player", "autoplay"); try setSwitch("Autoplay", true)
        try controlsField("player", "muted"); try setSwitch("Mute on startup", true)
        try tapWorkspace("configuration-apply")
    }
    private func openOperationPicker(_ id: String) throws {
        try tapWorkspace("workspace-nav-apis"); try chooseWorkspace("api-view-selector", "operations")
        try tapWorkspace("api-operation-selector"); try replace("Find API operation", id)
    }
    private func chooseOperation(_ id: String) throws {
        try openOperationPicker(id); try tapWorkspace("api-operation-selector-option-" + id)
    }
    private func embeddedSeekbar(_ expected: Bool) throws -> Bool {
        let before = try freshNativeReport()
        let snapshot = try revealControlBarFromDom()
        let controls = try uiControls(snapshot)
        XCTAssertTrue(controls.contains { uiClass($0, "bmpui-ui-playbacktogglebutton") && $0["visible"] as? Bool == true && $0["hittable"] as? Bool == true }, "An ordinary compact control must be actually visible, including for the negative seekbar check")
        let visible = controls.contains { uiClass($0, "bmpui-ui-seekbar") && $0["visible"] as? Bool == true }
        XCTAssertEqual(visible, expected, "The computed SDK DOM seekbar must match the preference")
        let attachment = XCTAttachment(screenshot: try uiWebView(snapshot).screenshot())
        attachment.name = "embedded-seekbar-\(expected)-\(uiObservations.count)"; attachment.lifetime = .keepAlways; add(attachment)
        let after = try freshNativeReport()
        uiObservations.append(["snapshot": snapshot, "nativeBefore": before, "nativeAfter": after])
        let original = try XCTUnwrap(before["owner"] as? [String: Any])
        let current = try XCTUnwrap(after["owner"] as? [String: Any])
        let previous = try XCTUnwrap(original["sample"] as? [String: Any])
        let sample = try XCTUnwrap(current["sample"] as? [String: Any])
        for key in ["generation", "sourceLoads", "sourceLoaded"] { XCTAssertEqual(current[key] as? Int, original[key] as? Int) }
        for owner in [original, current] { XCTAssertEqual(owner["errors"] as? Int, 0); XCTAssertEqual(owner["readFailures"] as? Int, 0) }
        XCTAssertEqual(previous["playing"] as? Bool, false); XCTAssertEqual(sample["playing"] as? Bool, false)
        XCTAssertLessThanOrEqual(abs(try XCTUnwrap(sample["time"] as? Double) - XCTUnwrap(previous["time"] as? Double)), 0.25)
        if uiObservations.count <= 3 {
            XCTAssertEqual(snapshot["viewIdentity"] as? String, (uiObservations[0]["snapshot"] as? [String: Any])?["viewIdentity"] as? String)
        }
        return visible
    }
    private func pauseControlsPlayback() throws {
        let baseline = try freshNativeReport()
        XCTAssertTrue(try playing(baseline), "Pause must start from actual native playback")
        let generation = try owner(baseline)
        for _ in 0..<3 {
            let snapshot = try revealControlBarFromDom()
            let controls = try uiControls(snapshot).filter { uiClass($0, "bmpui-ui-playbacktogglebutton") && $0["visible"] as? Bool == true && $0["hittable"] as? Bool == true }
            XCTAssertEqual(controls.count, 1, "Exactly one visible compact playback control is required")
            let rect = try XCTUnwrap(controls.first?["rect"] as? [Double])
            XCTAssertEqual(rect.count, 4)
            try tapDomPoint(x: rect[0] + rect[2] / 2, y: rect[1] + rect[3] / 2, snapshot: snapshot)
            let value = try freshNativeReport()
            XCTAssertEqual(try owner(value), generation)
            let original = try XCTUnwrap(baseline["owner"] as? [String: Any])
            let current = try XCTUnwrap(value["owner"] as? [String: Any])
            for key in ["sourceLoads", "sourceLoaded"] { XCTAssertEqual(current[key] as? Int, original[key] as? Int) }
            if try !playing(value) { return }
        }
        XCTFail("The native player did not acknowledge the SDK Pause control")
        throw Failure.deadline
    }
    private func uiClass(_ control: [String: Any], _ name: String) -> Bool {
        (control["className"] as? String ?? "").split(separator: " ").contains(Substring(name))
    }
    private func uiControls(_ snapshot: [String: Any]) throws -> [[String: Any]] {
        let dom = try XCTUnwrap(snapshot["dom"] as? [String: Any])
        return try XCTUnwrap(dom["controls"] as? [[String: Any]])
    }
    private func readEmbeddedUi() throws -> [String: Any] {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(rawValue: "com.playerlab.reactnative.runtime.observe-ui" as CFString), nil, nil, true)
        let node = app.descendants(matching: .any).matching(identifier: "player-lab-native-ui-observation").firstMatch
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if node.exists, let text = node.value as? String, let data = text.data(using: .utf8),
               let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let sequence = value["sequence"] as? Int, sequence > uiSequence {
                XCTAssertNil(value["error"], "The native WK observer must return a current DOM observation")
                XCTAssertNotNil(value["dom"] as? [String: Any]); XCTAssertNotNil(value["viewIdentity"] as? String)
                uiSequence = sequence
                return value
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        XCTFail("Read-only native WK observation deadline exceeded")
        throw Failure.deadline
    }
    private func uiWebView(_ snapshot: [String: Any]) throws -> XCUIElement {
        let frame = try XCTUnwrap(snapshot["frame"] as? [Double])
        XCTAssertEqual(frame.count, 4)
        return try XCTUnwrap(app.webViews.allElementsBoundByIndex.first { view in
            abs(view.frame.minX - frame[0]) < 1 && abs(view.frame.minY - frame[1]) < 1 &&
            abs(view.frame.width - frame[2]) < 1 && abs(view.frame.height - frame[3]) < 1
        }, "The DOM observation must belong to the actual native WebView viewport")
    }
    private func tapDomPoint(x: Double, y: Double, snapshot: [String: Any]) throws {
        let dom = try XCTUnwrap(snapshot["dom"] as? [String: Any])
        let width = try XCTUnwrap(dom["width"] as? Double), height = try XCTUnwrap(dom["height"] as? Double)
        XCTAssertTrue(width > 0 && height > 0 && x > 0 && x < width && y > 0 && y < height)
        try uiWebView(snapshot).coordinate(withNormalizedOffset: CGVector(dx: x / width, dy: y / height)).tap()
    }
    private func revealControlBarFromDom() throws -> [String: Any] {
        var snapshot = try readEmbeddedUi()
        func shown(_ value: [String: Any]) throws -> Bool {
            try uiControls(value).contains { uiClass($0, "bmpui-ui-playbacktogglebutton") && $0["visible"] as? Bool == true && $0["hittable"] as? Bool == true }
        }
        if try shown(snapshot) { return snapshot }
        let dom = try XCTUnwrap(snapshot["dom"] as? [String: Any])
        let point = try XCTUnwrap(dom["revealPoint"] as? [String: Any], "A DOM-proven non-action reveal point is required")
        try tapDomPoint(x: XCTUnwrap(point["x"] as? Double), y: XCTUnwrap(point["y"] as? Double), snapshot: snapshot)
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            snapshot = try readEmbeddedUi()
            if try shown(snapshot) { return snapshot }
        }
        XCTFail("The SDK control bar must become actually visible")
        throw Failure.deadline
    }
    private func freshNativeReport() throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(40)
        var value = try report(refresh: false)
        // The first sample can drain an earlier coalesced read. The second starts after it.
        for _ in 0..<2 {
            let previous = ((value["owner"] as? [String: Any])?["sample"] as? [String: Any])?["sequence"] as? Int ?? 0
            _ = try report()
            var advanced = false
            while Date() < deadline {
                value = try report(refresh: false)
                let sequence = ((value["owner"] as? [String: Any])?["sample"] as? [String: Any])?["sequence"] as? Int ?? 0
                if sequence > previous { advanced = true; break }
                Thread.sleep(forTimeInterval: 0.1)
            }
            guard advanced else { XCTFail("A fresh native sample is required"); throw Failure.deadline }
        }
        return value
    }

    func testNormalConfigurationPlaybackAndCleanup() throws {
        guard let media = ProcessInfo.processInfo.environment["PLAYER_LAB_MEDIA_URL"] else { throw Failure.input }
        app.launch()
        let beforeApply = try waitReport { ($0["owner"] as? [String: Any])?["viewReady"] as? Bool == true }
        result["screenIdentifierMatches"] = app.descendants(matching: .any).matching(identifier: "player-lab-screen").count
        result["nativeScrollViewCount"] = app.scrollViews.count
        result["phase"] = "reset-draft"
        try tap("Show configuration")
        let title = app.textFields["Source title"]
        let originalTitle = title.value as? String
        try replace("Source title", "Unapplied runtime draft")
        try tap("Reset draft")
        XCTAssertTrue(title.value as? String == originalTitle, "Reset must restore the applied title")
        result["phase"] = "edit-configuration"
        try replace("Source URL", media)
        if app.buttons["HLS"].isEnabled { try tap("HLS") }
        try replace("Source title", "Runtime VOD")
        try replace("Start offset (seconds)", "5")
        try setSwitch("Autoplay", true)
        try setSwitch("Mute on startup", true)
        try replace("Forward buffer (seconds)", "8")
        try replace("Maximum bitrate (bits per second)", "2500000")
        try tap("Apply and recreate player")
        try tap("Hide configuration")
        result["phase"] = "default-playback"
        let initial = try playback("default")
        let defaultOwner = try owner(initial)
        XCTAssertNotEqual(defaultOwner, try owner(beforeApply), "GUI Apply must replace the actual player owner")
        try assertApplied(initial, ui: "Default", dvr: true)

        try tap("Show configuration")
        result["phase"] = "clipboard-and-draft-isolation"
        try tap("Show applied code")
        try tap("Copy code")
        try tap("Check copied code", scroll: false)
        _ = try waitReport { (($0["code"] as? [String: Any])?["clipboardMatches"] as? Bool) == true }
        try replace("Source title", "Unapplied code draft")
        try tap("Reset draft")
        XCTAssertEqual(try owner(report()), defaultOwner, "Draft edits and clipboard must retain the owner")
        try tap("Hide configuration")
        try setSwitch("Allow DVR", false)
        try tap("Sports")
        result["phase"] = "sports-playback"
        let sports = try playback("sports")
        XCTAssertNotEqual(try owner(sports), defaultOwner)
        try assertApplied(sports, ui: "Sports", dvr: false)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "game info overlays")).firstMatch.exists,
                      "Packaged Sports UI must expose its INFO control")
        try tap("Default")
        result["phase"] = "default-return-playback"
        let replacement = try playback("default-return")
        let retainedOwner = try owner(replacement)
        XCTAssertNotEqual(retainedOwner, try owner(sports), "Returning to Default must replace the actual player owner")
        try assertApplied(replacement, ui: "Default", dvr: false)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        app.activate()
        result["phase"] = "foreground-playback"
        _ = try waitReport { $0["lifecycle"] as? String == "active" }
        if try !playing(report()) { try playVisible() }
        let foreground = try playback("foreground")
        XCTAssertEqual(try owner(foreground), retainedOwner, "Foreground must retain this React Native owner")
        try assertApplied(foreground, ui: "Default", dvr: false)
        try tap("Finish runtime checks", scroll: false)
        let finished = try waitReport { $0["owner"] is NSNull }
        let retired = try XCTUnwrap(finished["retired"] as? [[String: Any]])
        XCTAssertEqual(retired.count, finished["created"] as? Int)
        XCTAssertTrue(retired.allSatisfy { $0["wrapperDestroyed"] as? Bool == true })
        result["final"] = finished
        result["wrapperDestroyFlagsConfirmed"] = true
        result["nativeReleaseAcknowledgementAvailable"] = false
        result["passed"] = true
    }

    func testExternalSubtitleConfigurationAndMenu() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let media = environment["PLAYER_LAB_MEDIA_URL"], let subtitle = environment["PLAYER_LAB_SUBTITLE_URL"] else { throw Failure.input }
        app.launch()
        _ = try waitReport { ($0["owner"] as? [String: Any])?["viewReady"] as? Bool == true }
        result["phase"] = "external-subtitle-fields"
        try tap("Show configuration")
        try replace("Source URL", media)
        if app.buttons["HLS"].isEnabled { try tap("HLS") }
        try replace("Source title", "WebVTT example")
        try replace("External WebVTT URL", subtitle)
        try replace("Subtitle label", "External English")
        try replace("Subtitle language", "EN-us")
        try setSwitch("Mark as default", false)
        try replace("Start offset (seconds)", "1")
        try setSwitch("Autoplay", true)
        try setSwitch("Mute on startup", true)
        try tap("Apply and recreate player")
        try tap("Hide configuration")
        top()
        result["phase"] = "external-subtitle-menu"
        let available = try waitReport { value in
            ((value["owner"] as? [String: Any])?["sample"] as? [String: Any])?["externalSubtitleAvailable"] as? Bool == true
        }
        let sdk = app.webViews.firstMatch
        XCTAssertTrue(sdk.exists, "The normal SDK UI WebView must be present")
        let settings = sdk.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] 'Settings'")).firstMatch
        if !settings.isHittable { tapVideoCenter() }
        XCTAssertTrue(settings.waitForExistence(timeout: 5) && settings.isHittable, "Normal SDK Settings control must be visible")
        let gear = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: settings.frame.midX, dy: settings.frame.midY))
        gear.tap()
        let external = sdk.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'External English'")).firstMatch
        let subtitles = sdk.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] 'Subtitles' OR label BEGINSWITH[c] 'Subtitles/' OR label BEGINSWITH[c] 'Subtitles /'")).firstMatch
        // Hidden Web UI controls can remain in the accessibility tree: the first
        // physical tap reveals the bar, then a second reaches the visible gear.
        if !external.exists && !subtitles.exists { gear.tap() }
        if !external.exists && !subtitles.exists { scrollSdkSettings() }
        let menuImage = XCTAttachment(screenshot: app.screenshot()); menuImage.name = "normal-sdk-settings"; menuImage.lifetime = .keepAlways; add(menuImage)
        if !external.waitForExistence(timeout: 2) {
            if subtitles.exists {
                subtitles.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            } else {
                // SDK UI 4.23 exposes unlabeled menuitem roles in WKWebView.
                // For this fixture the SmallScreen menu is Speed, Audio, Subtitles;
                // its last row is visible after the real panel scroll above.
                let rows = sdk.descendants(matching: .menuItem)
                XCTAssertEqual(rows.count, 3, "The known fixture must expose the three normal SDK settings rows")
                let row = rows.element(boundBy: 2)
                XCTAssertTrue(row.isHittable, "The actual subtitle row must be inside the video viewport")
                row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
        }
        if !external.exists { scrollSdkSettings() }
        if external.exists {
            external.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        } else {
            // The stock page adds a Back title row, then Off and source tracks.
            // This fixture appends its one external track after the HLS tracks.
            // Native selected-track + cue observations below remain mandatory.
            let count = try XCTUnwrap(((available["owner"] as? [String: Any])?["sample"] as? [String: Any])?["subtitleCount"] as? Int)
            let rows = sdk.descendants(matching: .menuItem)
            XCTAssertEqual(rows.count, count + 2, "The normal menu must list Back, Off and every available track")
            let row = rows.element(boundBy: count + 1)
            let video = app.descendants(matching: .any).matching(identifier: "player-lab-player").firstMatch.frame
            for _ in 0..<5 {
                if row.isHittable && row.frame.midY >= video.minY + 30 && row.frame.midY < video.maxY - 55 { break }
                scrollSdkSettings()
            }
            XCTAssertTrue(row.isHittable && row.frame.midY >= video.minY + 30 && row.frame.midY < video.maxY - 55,
                          "The actual external track row must be visible inside the compact menu")
            let image = XCTAttachment(screenshot: app.screenshot()); image.name = "normal-sdk-subtitle-tracks"; image.lifetime = .keepAlways; add(image)
            row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        let selected = try waitReport { value in
            let owner = value["owner"] as? [String: Any]
            return (owner?["sample"] as? [String: Any])?["externalSubtitleSelected"] as? Bool == true
        }
        let availableOwner = try XCTUnwrap(available["owner"] as? [String: Any])
        let selectedOwner = try XCTUnwrap(selected["owner"] as? [String: Any])
        let selectedSample = try XCTUnwrap(selectedOwner["sample"] as? [String: Any])
        for key in ["generation", "sourceLoads", "sourceLoaded"] {
            XCTAssertEqual(availableOwner[key] as? Int, selectedOwner[key] as? Int)
        }
        let baseline = max(availableOwner["cueEnter"] as? Int ?? 0, selectedOwner["cueEnter"] as? Int ?? 0)
        let freshCue = try waitReport { value in
            guard let owner = value["owner"] as? [String: Any], let sample = owner["sample"] as? [String: Any] else { return false }
            return ["generation", "sourceLoads", "sourceLoaded"].allSatisfy { owner[$0] as? Int == selectedOwner[$0] as? Int } &&
                sample["externalSubtitleSelected"] as? Bool == true &&
                (sample["sequence"] as? Int ?? 0) > (selectedSample["sequence"] as? Int ?? 0) &&
                (owner["cueEnter"] as? Int ?? 0) > baseline
        }
        result["externalCueSelection"] = [available, selected, freshCue]
        result["selectedExternalTrack"] = true
        result["freshCueAfterNativeSelection"] = true
        result["cueEventsObserved"] = (freshCue["owner"] as? [String: Any])?["cueEnter"]
        gear.tap() // Close the actual Settings overlay before measuring movie pixels.
        result["phase"] = "external-subtitle-playback"
        _ = try playback("external-subtitles")
        try tap("Show configuration")
        XCTAssertEqual(app.textFields["Subtitle language"].value as? String, "en-US")
        try tap("Show applied code"); try tap("Copy code"); try tap("Check copied code", scroll: false)
        _ = try waitReport { (($0["code"] as? [String: Any])?["clipboardMatches"] as? Bool) == true }
        try replace("Subtitle label", "Unapplied subtitle")
        try tap("Reset draft")
        XCTAssertEqual(app.textFields["Subtitle label"].value as? String, "External English")
        try tap("Finish runtime checks", scroll: false)
        let final = try waitReport { $0["owner"] is NSNull }
        let retired = try XCTUnwrap(final["retired"] as? [[String: Any]])
        XCTAssertEqual(retired.count, final["created"] as? Int)
        XCTAssertTrue(retired.allSatisfy { $0["wrapperDestroyed"] as? Bool == true })
        result["final"] = final; result["wrapperDestroyFlagsConfirmed"] = true
        result["nativeReleaseAcknowledgementAvailable"] = false; result["passed"] = true
    }

    private func report(refresh: Bool = true) throws -> [String: Any] {
        if refresh {
            let read = app.buttons["Read runtime report"]
            guard read.waitForExistence(timeout: 5) && read.isHittable else { throw Failure.report }
            read.tap()
        }
        let node = app.staticTexts["runtime-report"]
        guard node.exists, let data = node.label.data(using: .utf8),
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], value["protocol"] as? Int == 1 else { throw Failure.report }
        return value
    }
    private func waitReport(refresh: Bool = true, _ predicate: ([String: Any]) -> Bool) throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(40)
        while Date() < deadline {
            if let value = try? report(refresh: refresh), predicate(value) { return value }
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTFail("Public runtime observation deadline exceeded")
        throw Failure.deadline
    }
    private func owner(_ value: [String: Any]) throws -> Int { try XCTUnwrap((value["owner"] as? [String: Any])?["generation"] as? Int) }
    private func assertApplied(_ value: [String: Any], ui: String, dvr: Bool) throws {
        let applied = try XCTUnwrap(value["app"] as? [String: Any])
        XCTAssertEqual(applied["ui"] as? String, ui)
        XCTAssertEqual(applied["revision"] as? Int, 1)
        XCTAssertEqual(applied["sourceType"] as? String, "hls")
        XCTAssertEqual(applied["startOffset"] as? Double, 5)
        XCTAssertEqual(applied["forwardBuffer"] as? Double, 8)
        XCTAssertEqual(applied["maxBitrate"] as? Double, 2500000)
        XCTAssertTrue(applied["autoplay"] as? Bool == true && applied["startupMuted"] as? Bool == true)
        XCTAssertTrue(applied["externalSubtitleConfigured"] as? Bool == false)
        XCTAssertEqual(applied["dvrAllowed"] as? Bool, dvr)
    }
    private func playing(_ value: [String: Any]) throws -> Bool {
        try XCTUnwrap(((value["owner"] as? [String: Any])?["sample"] as? [String: Any])?["playing"] as? Bool)
    }
    private func playback(_ stage: String) throws -> [String: Any] {
        top()
        var snapshots: [[String: Any]] = []
        var frames: [[UInt8]] = []
        let ready = try waitReport { value in
            guard let owner = value["owner"] as? [String: Any], let sample = owner["sample"] as? [String: Any] else { return false }
            return owner["sourceLoaded"] as? Int ?? 0 > 0 && sample["playing"] as? Bool == true && sample["live"] as? Bool == false
        }
        let generation = try owner(ready)
        let oldBatch = (ready["batch"] as? [String: Any])?["id"] as? Int ?? 0
        for index in [0, 4] {
                let video = app.descendants(matching: .any).matching(identifier: "player-lab-player").firstMatch
                XCTAssertTrue(video.exists, "Native video container must exist")
                let frame = video.frame
                let clipped = frame.intersection(mainScroll().frame)
                result["nativeVideoContainerHittable"] = video.isHittable
                result["nativeVideoVisibleFraction"] = frame.width > 0 && frame.height > 0 ? clipped.width * clipped.height / (frame.width * frame.height) : 0
                // A non-interactive native container need not be an accessibility hit target.
                XCTAssertGreaterThan(frame.width, 100); XCTAssertGreaterThan(frame.height, 100)
                XCTAssertGreaterThan(clipped.width * clipped.height / (frame.width * frame.height), 0.9, "The native video region must be inside the visible App viewport")
                let shot = XCTAttachment(screenshot: video.screenshot())
                shot.name = "\(stage)-video-\(index)"; shot.lifetime = .keepAlways; add(shot)
                frames.append(try moviePixels(video.screenshot().image))
            if index == 0 {
                try tap("Read playback samples", scroll: false)
                let value = try waitReport(refresh: false) { value in
                    guard let batch = value["batch"] as? [String: Any] else { return false }
                    return batch["generation"] as? Int == generation && (batch["id"] as? Int ?? 0) > oldBatch
                }
                result["lastObservation"] = value
                var current = try XCTUnwrap(value["owner"] as? [String: Any])
                XCTAssertEqual(current["errors"] as? Int, 0)
                let samples = try XCTUnwrap((value["batch"] as? [String: Any])?["samples"] as? [[String: Any]])
                XCTAssertEqual(samples.count, 5)
                for sample in samples {
                    let duration = try XCTUnwrap(sample["duration"] as? Double)
                    XCTAssertGreaterThan(duration, 59); XCTAssertLessThan(duration, 61)
                    XCTAssertTrue(sample["muted"] as? Bool == true && sample["playing"] as? Bool == true && sample["live"] as? Bool == false)
                    current["sample"] = sample
                    var row = value; row["batch"] = NSNull(); row["owner"] = current
                    snapshots.append(row)
                }
            }
        }
        let times = snapshots.compactMap { (($0["owner"] as? [String: Any])?["sample"] as? [String: Any])?["time"] as? Double }
        XCTAssertEqual(times.count, 5)
        XCTAssertGreaterThan(try XCTUnwrap(times.last) - XCTUnwrap(times.first), 2)
        XCTAssertEqual(frames.count, 2)
        let changed = zip(frames[0], frames[1]).filter { abs(Int($0.0) - Int($0.1)) > 12 }.count
        let ratio = Double(changed) / Double(frames[0].count)
        XCTAssertGreaterThan(ratio, 0.01, "The video region must change as well as the native clock")
        stages.append(["stage": stage, "samples": snapshots, "videoRegionChangedRatio": ratio])
        return try XCTUnwrap(snapshots.last)
    }
    private func moviePixels(_ image: UIImage) throws -> [UInt8] {
        let source = try XCTUnwrap(image.cgImage)
        let crop = try XCTUnwrap(source.cropping(to: CGRect(x: Double(source.width) * 0.05, y: Double(source.height) * 0.1,
                                                          width: Double(source.width) * 0.9, height: Double(source.height) * 0.6)))
        var bytes = [UInt8](repeating: 0, count: 128 * 72 * 4)
        let context = try XCTUnwrap(CGContext(data: &bytes, width: 128, height: 72, bitsPerComponent: 8, bytesPerRow: 128 * 4,
                                             space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(crop, in: CGRect(x: 0, y: 0, width: 128, height: 72))
        return bytes
    }
    private func playVisible() throws {
        top()
        let button = app.buttons.matching(NSPredicate(format: "label ==[c] 'Play' OR label ==[c] 'Play video'")).firstMatch
        if !button.isHittable { tapVideoCenter() }
        XCTAssertTrue(button.waitForExistence(timeout: 5) && button.isHittable, "Visible SDK Play control is required")
        button.tap()
    }
    private func tapVideoCenter() {
        // The native video container is not itself an accessibility hit target.
        app.descendants(matching: .any).matching(identifier: "player-lab-player").firstMatch
            .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }
    private func scrollSdkSettings() {
        // The compact Settings panel can show two rows at a time inside a short video.
        let video = app.descendants(matching: .any).matching(identifier: "player-lab-player").firstMatch.frame
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: video.midX, dy: video.minY + video.height * 0.6)).press(forDuration: 0.05,
            thenDragTo: origin.withOffset(CGVector(dx: video.midX, dy: video.minY + video.height * 0.22)))
    }
    private func top() {
        let scroll = mainScroll()
        for _ in 0..<12 {
            let button = app.buttons["Sports"]
            if button.exists && button.isHittable && scroll.frame.contains(CGPoint(x: button.frame.midX, y: button.frame.midY)) { return }
            scroll.swipeDown()
        }
    }
    private func reveal(_ element: XCUIElement) throws {
        let scroll = mainScroll()
        for _ in 0..<30 {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? min(scroll.frame.maxY, keyboard.frame.minY) : scroll.frame.maxY
            let viewport = CGRect(x: scroll.frame.minX, y: scroll.frame.minY, width: scroll.frame.width, height: bottom - scroll.frame.minY)
            if element.exists && element.isHittable && viewport.contains(CGPoint(x: element.frame.midX, y: element.frame.midY)) { return }
            let down = element.exists && element.frame.midY < viewport.minY
            let root = app.coordinate(withNormalizedOffset: .zero)
            root.withOffset(CGVector(dx: viewport.maxX - 8, dy: down ? viewport.minY + 35 : viewport.maxY - 30))
                .press(forDuration: 0.05, thenDragTo: root.withOffset(CGVector(dx: viewport.maxX - 8, dy: down ? viewport.maxY - 30 : viewport.minY + 35)))
        }
        XCTFail("Normal App control remained outside its viewport")
        throw Failure.viewport
    }
    private func mainScroll() -> XCUIElement {
        let named = app.descendants(matching: .any).matching(identifier: "player-lab-screen").firstMatch
        if named.exists { return named }
        // Some React Native accessibility trees omit the outer ScrollView identifier.
        // The full-height App scroll view is larger than the embedded video/log/code scroll views.
        return app.scrollViews.allElementsBoundByIndex.max(by: { $0.frame.height < $1.frame.height }) ?? app.scrollViews.firstMatch
    }
    private func tap(_ title: String, scroll: Bool = true) throws {
        let button = app.buttons[title]
        if scroll { try reveal(button) }
        XCTAssertTrue(button.exists && button.isEnabled && button.isHittable, "Normal App button must be usable")
        button.tap()
    }
    private func replace(_ label: String, _ text: String) throws {
        let field = app.textFields[label].exists ? app.textFields[label] : app.textViews[label]
        try reveal(field); field.tap(); _ = app.keyboards.firstMatch.waitForExistence(timeout: 2); try reveal(field)
        let value = field.value as? String ?? ""
        if !value.isEmpty {
            field.press(forDuration: 1.1)
            let predicate = NSPredicate(format: "label IN %@", ["Select All", "すべてを選択", "すべて選択", "全選択"])
            let menu = app.menuItems.matching(predicate).firstMatch
            let button = app.buttons.matching(predicate).firstMatch
            if menu.waitForExistence(timeout: 1) { menu.tap() }
            else if button.waitForExistence(timeout: 1) { button.tap() }
            else { field.tap(withNumberOfTaps: 3, numberOfTouches: 1) }
            field.typeText(XCUIKeyboardKey.delete.rawValue)
            XCTAssertTrue(field.value as? String == "", "Controlled input must be empty before typing")
        }
        field.typeText(text + (field.elementType == .textView ? "" : "\n"))
        XCTAssertTrue(field.value as? String == text, "Controlled input must retain the exact edit")
    }
    private func setSwitch(_ label: String, _ enabled: Bool) throws {
        let control = app.switches[label]
        try reveal(control)
        if (control.value as? String == "1") != enabled { control.tap() }
        XCTAssertTrue((control.value as? String == "1") == enabled)
    }
    private enum Failure: Error { case input, report, deadline, viewport }
}
