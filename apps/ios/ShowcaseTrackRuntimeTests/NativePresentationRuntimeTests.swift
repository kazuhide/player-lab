import AVKit
import SwiftUI
import BitmovinPlayer
import XCTest
#if os(tvOS)
@testable import Showcase_tvOS
#else
@testable import Showcase_iOS
#endif

@MainActor
final class NativePresentationRuntimeTests: XCTestCase {
    func testLayerAndControllerHostsAttachAndRetireExactSdkPlayer() async throws {
        let model = try makeModel()
        model.setPresentation(.playerLayer)
        let (window, host) = try show(model)
        defer { model.apiObjects.presentationRegistration.retire(); model.player.destroy(); window.isHidden = true; _ = host }
        try await eventually("layer playback") { model.player.currentTime > 0.5 && model.apiObjects.presentationRegistration.layer?.player != nil }
        let layer = try XCTUnwrap(model.apiObjects.presentationRegistration.layer)
        let firstPlayer = model.player
        model.setPresentation(.playerController)
        XCTAssertTrue(firstPlayer.isDestroyed)
        XCTAssertNil(layer.player, "The old layer must be unregistered before destroying its player")
        try await eventually("controller playback") { model.player.currentTime > 0.5 && model.apiObjects.presentationRegistration.controller?.player != nil }
        let controller = try XCTUnwrap(model.apiObjects.presentationRegistration.controller)
        let secondPlayer = model.player
        model.setPresentation(.sdkSwiftUI)
        XCTAssertTrue(secondPlayer.isDestroyed)
        XCTAssertNil(controller.player)
        try await eventually("default host restored") { model.player.currentTime > 0.5 }
        XCTAssertNil(model.apiObjects.presentationRegistration.player)
        print("Native presentation qualification: AVPlayerLayer and AVPlayerViewController registration, exact-owner retirement and original SwiftUI restoration passed")
    }

    func testSwiftUiBindingsReachTheActualSdkPlayerView() async throws {
        let model = try makeModel()
        model.setPresentation(.sdkBindings); model.boundPiPEnabled = true; model.boundScalingMode = .zoom
        let (window, host) = try show(model)
        defer { model.player.destroy(); window.isHidden = true; _ = host }
        try await eventually("bound SDK view") { self.playerView(in: host.view)?.player === model.player && model.player.currentTime > 0.5 }
        let view = try XCTUnwrap(playerView(in: host.view))
        try await eventually("edited SDK bindings") { view.pictureInPicture.isEnabled && view.scalingMode == .zoom }
        XCTAssertEqual(model.boundPiPAvailable, view.isPictureInPictureAvailable)
        model.boundScalingMode = .stretch; model.boundPiPEnabled = false
        try await eventually("live binding changes") { !view.pictureInPicture.isEnabled && view.scalingMode == .stretch }
        print("Native presentation qualification: SwiftUI PiP enabled/availability and scaling bindings reached the actual SDK view; PiP activation requires platform availability")
    }

    func testFactorySelectionAndPublisherSubscriptionsUseActualSdkInstances() async throws {
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        model.setApiEventTransport(.publisher)
        var draft = model.configurationDraft; draft.sourceURL = "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8"; draft.autoplay = true
        try model.apply(draft); model.setPresentation(.playerView)
        let (window, host) = try show(model)
        defer { model.player.destroy(); window.isHidden = true; _ = host }
        try await eventually("publisher playback and source events") {
            model.player.currentTime > 0.5 && model.apiEvents.contains { $0.api == "BitmovinPlayerCore.ReadyEvent" && $0.owner == "Player" } && model.apiEvents.contains { $0.api == "BitmovinPlayerCore.SourceLoadedEvent" && $0.owner == "Source" }
        }
        try model.executeApi(.viewScaling, arguments: ["value": "zoom"])
        try await eventually("view publisher") { model.apiEvents.contains { $0.api == "BitmovinPlayerCore.ScalingModeChangedEvent" && $0.owner == "Player view" } }
        model.setApiEventRecording(false); model.clearApiEvents(); model.player.pause()
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(model.apiEvents.isEmpty)
        model.setApiEventRecording(true); model.player.play()
        try await eventually("publisher reattachment") { model.apiEvents.contains { $0.api == "BitmovinPlayerCore.PlayingEvent" && $0.owner == "Player" } }
        for factory in [NativePlayerFactory.core, .legacy, .standard] {
            let previous = model.player
            model.setNativePlayerFactory(factory)
            XCTAssertTrue(previous.isDestroyed)
            try await eventually("selected factory playback") { model.player.currentTime > 0.5 && model.apiPlayerView?.player === model.player }
            XCTAssertEqual(model.nativePlayerFactory, factory)
        }
        print("Native presentation qualification: both PlayerEventsApi generic overloads, source/view Combine subscriptions, cancellation/rebind and Core/legacy/default factory playback passed")
    }

    private func makeModel() throws -> PlayerModel {
        let key = bitmovinLicenseKey(); XCTAssertFalse(key.isEmpty)
        let model = PlayerModel(licenseKey: key)
        var draft = model.configurationDraft; draft.sourceURL = "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8"; draft.autoplay = true
        try model.apply(draft); return model
    }
    private func show(_ model: PlayerModel) throws -> (UIWindow, UIHostingController<NativePresentationSurface>) {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene), host = UIHostingController(rootView: NativePresentationSurface(model: model))
        window.rootViewController = host; window.windowLevel = .alert + 1; window.makeKeyAndVisible(); host.view.frame = window.bounds; host.view.layoutIfNeeded()
        return (window, host)
    }
    private func playerView(in root: UIView) -> PlayerView? {
        if let view = root as? PlayerView { return view }
        for child in root.subviews { if let result = playerView(in: child) { return result } }
        return nil
    }
    private func eventually(_ stage: String, predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline { if predicate() { return }; try await Task.sleep(nanoseconds: 100_000_000) }
        XCTFail("Timed out waiting for \(stage)"); throw QualificationFailure.deadline
    }
    private enum QualificationFailure: Error { case deadline }
}
