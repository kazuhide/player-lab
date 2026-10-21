import BitmovinPlayer
import UIKit
import XCTest
#if os(tvOS)
@testable import Showcase_tvOS
#else
@testable import Showcase_iOS
#endif

@MainActor
final class NativeExtendedRuntimeTests: XCTestCase {
    func testRealManualSubtitleControllerMetadataAndViewOperations() async throws {
        XCTAssertFalse(bitmovinLicenseKey().isEmpty)
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        model.setNativeApiHost(true)
        var draft = model.configurationDraft
        draft.sourceURL = "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8"
        draft.autoplay = true
        draft.subtitleMode = .off
        try model.apply(draft)
        let view = PlayerView(player: model.player, frame: CGRect(x: 0, y: 0, width: 320, height: 180))
        model.attachApiView(view)
        let controller = UIViewController()
        controller.view.addSubview(view)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller; window.windowLevel = .alert + 1; window.makeKeyAndVisible()
        defer { model.detachApiView(view); view.player = nil; model.player.destroy(); window.isHidden = true }
        try await eventually("content playback") { model.player.currentTime > 0.5 && !model.player.availableSubtitles.isEmpty }
        try model.executeApi(.sourceMetadata, arguments: ["json": "{\"category\":\"manual-subtitle-qualification\"}"])
        XCTAssertEqual(model.player.source?.metadata?["category"] as? String, "manual-subtitle-qualification")
        try model.executeApi(.subtitleAdd, arguments: ["json": "{\"identifier\":\"manual-qualification\",\"label\":\"Manual example\",\"language\":\"en\",\"url\":null}"])
        try await eventually("manual subtitle addition") { model.player.availableSubtitles.contains { $0.identifier == "manual-qualification" } }
        try model.executeApi(.subtitle, arguments: ["value": "manual-qualification"])
        try await eventually("manual subtitle selection") { model.player.subtitle.identifier == "manual-qualification" }
        try model.executeApi(.cueEnter, arguments: ["track": "manual-qualification", "json": "{\"startTime\":0,\"endTime\":30,\"text\":\"Manual API qualification\"}"])
        try await eventually("actual CueEnterEvent") { model.apiEvents.contains { $0.api == "BitmovinPlayerCore.CueEnterEvent" } }
        XCTAssertEqual(model.apiObjects.enteredCues.count, 1)
        try model.executeApi(.cueExit, arguments: ["track": "manual-qualification"])
        try await eventually("actual CueExitEvent") { model.apiEvents.contains { $0.api == "BitmovinPlayerCore.CueExitEvent" } }
        XCTAssertTrue(model.apiObjects.enteredCues.isEmpty)
        try model.executeApi(.subtitleStyles, arguments: ["json": "[]"])
        try model.executeApi(.viewSubtitleStyles, arguments: ["json": "null"])
        try model.executeApi(.thumbnailContainer, arguments: ["enabled": "true"])
        XCTAssertTrue(model.player.thumbnails.container === model.apiObjects.thumbnailContainer)
        try model.executeApi(.playerAdContainer, arguments: ["x": "4", "y": "8", "width": "280", "height": "140"])
        XCTAssertTrue(model.apiObjects.adContainer.superview === view.contentOverlay.view)
        XCTAssertEqual(model.apiObjects.adContainer.frame, CGRect(x: 4, y: 8, width: 280, height: 140))
        #if !os(tvOS)
        try model.executeApi(.pipSkipControls, arguments: ["value": "true"])
        XCTAssertTrue(view.pictureInPicture.showSkipControls)
        try model.executeApi(.hidePiPControls, arguments: ["value": "true"])
        XCTAssertTrue(view.tweaks.hidePlaybackControlsInPictureInPicture)
        #endif
        try model.executeApi(.sourceMetadata, arguments: ["json": "null"])
        XCTAssertNil(model.player.source?.metadata)
        let previous = model.player.source
        try model.executeApi(.loadConfig, arguments: [:])
        try await eventually("sourceConfig overload reload") { model.player.source !== previous && model.player.currentTime > 0.5 }
        XCTAssertTrue(model.apiObjects.enteredCues.isEmpty)
        print("Native API qualification: manual subtitle add/select/enter/exit, metadata set/clear, native view options and sourceConfig reload passed")
    }

    private func eventually(_ stage: String, predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if predicate() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out waiting for \(stage)")
        throw QualificationFailure.deadline
    }
    private enum QualificationFailure: Error { case deadline }
}
