#if !os(tvOS)
import BitmovinPlayer
import Combine
import UIKit
import XCTest
@testable import Showcase_iOS

/// Opt-in licensed SDK qualification against the public short HLS asset.
@MainActor
final class OfflineRuntimeTests: XCTestCase {
    func testOfflineDownloadTrackSelectionCachedPlaybackAndCleanup() async throws {
        XCTAssertFalse(bitmovinLicenseKey().isEmpty, "Configure the app's normal Player license first")
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        var draft = model.configurationDraft
        draft.sourceURL = "https://kazuhide.github.io/player-lab/web/media/vod-multiaudio/master.m3u8"
        draft.title = "Short offline HLS qualification"
        draft.autoplay = false
        try model.apply(draft)
        let view = PlayerView(player: model.player, frame: CGRect(x: 0, y: 0, width: 320, height: 180))
        let controller = UIViewController()
        controller.view.addSubview(view)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.windowLevel = .alert + 1
        window.makeKeyAndVisible()
        let workbench = model.offlineWorkbench
        defer {
            let values: [String: Any] = ["result": workbench.result,
                "state": workbench.state.map { ["id": $0.id, "value": $0.value] },
                "events": workbench.events.map { ["id": $0.api, "timestamp": $0.timestamp] }]
            if let data = try? JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "offline-sdk-observations.json"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
            if let manager = workbench.manager, manager.offlineState != .notDownloaded || manager.usedStorage > 0 {
                model.unloadFromApi()
                manager.cancelDownload()
                manager.deleteOfflineData()
            }
            view.player = nil
            model.player.destroy()
            window.isHidden = true
        }
        workbench.restrictToWifi = false
        try workbench.initialize(useConfig: true)
        try workbench.setWifiRestriction()
        workbench.identifier = "player-lab-qualification-" + UUID().uuidString
        try workbench.create(source: XCTUnwrap(model.sourceSettings))
        let manager = try XCTUnwrap(workbench.manager)
        XCTAssertEqual(manager.offlineState, .notDownloaded)
        try workbench.run(.fetchTracks)
        try await eventually(workbench, "actual available tracks") { !workbench.tracks.isEmpty }
        for track in workbench.tracks { workbench.setTrackAction(track, download: track.audio) }
        workbench.minimumBitrate = "0"
        try workbench.run(.selectedDownload)
        try await eventually(workbench, "completed offline download", timeout: 120) { manager.offlineState == .downloaded }
        XCTAssertGreaterThan(manager.usedStorage, 0)
        XCTAssertTrue(workbench.events.contains { $0.api == "BitmovinPlayerCore.ContentDownloadFinishedEvent" })
        workbench.restrictedToAssetCache = true
        try workbench.makeCachedSource()
        let cached = try XCTUnwrap(workbench.cachedSource)
        XCTAssertTrue(cached.isRestrictedToAssetCache)
        model.loadApiSourceConfig(cached)
        model.player.play()
        try await eventually(workbench, "cached source playback", timeout: 45) { model.player.isPlaying && model.player.currentTime > 1 }
        XCTAssertTrue(model.player.duration.isFinite)
        XCTAssertGreaterThan(model.player.duration, 59)
        model.unloadFromApi()
        try workbench.run(.delete)
        try await eventually(workbench, "selected qualification asset cleanup") { manager.offlineState == .notDownloaded && manager.usedStorage == 0 }
        print("Offline SDK qualification: tracks, selected download, cache-only source, playback progress and selected-asset cleanup passed")
    }

    private func eventually(_ workbench: OfflineWorkbench, _ stage: String, timeout: TimeInterval = 45, predicate: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate() { return }
            if workbench.events.contains(where: { $0.api == "BitmovinPlayerCore.OfflineErrorEvent" }) {
                XCTFail("\(stage): \(workbench.result)")
                throw QualificationFailure.sdkError
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out waiting for \(stage): \(workbench.result)")
        throw QualificationFailure.deadline
    }
    private enum QualificationFailure: Error { case sdkError, deadline }
}
#endif
