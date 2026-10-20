import XCTest
import UIKit

/// Drives the installed opt-in entry through the same production App and SDK UI as a user.
final class RuntimeChecks: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.playerlab.reactnative")
    private var stages: [[String: Any]] = []
    private var result: [String: Any] = ["schemaVersion": 1, "platform": "ios", "passed": false]
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        result["stages"] = stages
        // hasSucceeded is not final inside tearDown; the outer runner also requires the finalized xcresult.
        result["assertionFailures"] = testRun?.failureCount ?? -1
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            .write(to: documents.appendingPathComponent("runtime-report.json"), options: .atomic)
        app.terminate()
    }

    func testNormalConfigurationPlaybackAndCleanup() throws {
        guard let media = ProcessInfo.processInfo.environment["PLAYER_LAB_MEDIA_URL"] else { throw Failure.input }
        app.launch()
        _ = try waitReport { ($0["owner"] as? [String: Any])?["viewReady"] as? Bool == true }
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
        XCTAssertTrue((sports["app"] as? [String: Any])?["dvrAllowed"] as? Bool == false)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "game info overlays")).firstMatch.exists,
                      "Packaged Sports UI must expose its INFO control")
        try tap("Default")
        result["phase"] = "default-return-playback"
        let replacement = try playback("default-return")
        let retainedOwner = try owner(replacement)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        app.activate()
        result["phase"] = "foreground-playback"
        _ = try waitReport { $0["lifecycle"] as? String == "active" }
        if try !playing(report()) { try playVisible() }
        let foreground = try playback("foreground")
        XCTAssertEqual(try owner(foreground), retainedOwner, "Foreground must retain this React Native owner")
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
        if !button.isHittable { app.descendants(matching: .any).matching(identifier: "player-lab-player").firstMatch.tap() }
        XCTAssertTrue(button.waitForExistence(timeout: 5) && button.isHittable, "Visible SDK Play control is required")
        button.tap()
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
        let field = app.textFields[label]
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
        field.typeText(text + "\n")
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
