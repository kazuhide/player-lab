import BitmovinPlayer
import Combine
import SwiftUI
import XCTest
#if os(tvOS)
@testable import Showcase_tvOS
#else
import WebKit
@testable import Showcase_iOS
#endif

/// Uses the public HLS finalization fixture on ports 5198/5199; no synthetic playback state.
@MainActor
final class NativeControlsRuntimeTests: XCTestCase {
    func testSourceFailureAndRecoveryUpdateGuardsWithEventRecordingDisabled() async throws {
        try await resetFixture()
        XCTAssertFalse(bitmovinLicenseKey().isEmpty)
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        model.setPresentation(.playerView)
        model.setApiEventRecording(false)
        var receivedSourceError = false
        let errors = model.player.events.on(SourceErrorEvent.self).sink { _ in receivedSourceError = true }
        defer { errors.cancel() }
        var draft = model.configurationDraft
        draft.sourceURL = "http://localhost:5198/missing-controls-fixture.m3u8"
        draft.autoplay = true
        try model.apply(draft)
        let (window, host) = try show(model)
        defer { model.player.destroy(); window.isHidden = true; _ = host }
        let player = model.player
        try await eventually("real source error updates permanent command observer") {
            let context = model.apiContext()
            return receivedSourceError && (context.playback.source == .failed || !context.hasSource)
        }
        XCTAssertThrowsError(try model.executeApi(.play, arguments: [:]))
        XCTAssertThrowsError(try model.executeApi(.seek, arguments: ["value": "2"]))
        XCTAssertNil(model.apiContext().rejection(for: .reload))
        XCTAssertNil(model.apiContext().rejection(for: .destroyAndRecreate))
        XCTAssertTrue(model.apiEvents.isEmpty)
        try await setFixture("finalize")
        draft.sourceURL = "http://localhost:5198/master.m3u8?recovered=1"
        try model.apply(draft)
        try await eventually("new VOD source clears retired error context") {
            model.apiContext().rejection(for: .seek, arguments: ["value": "2"]) == nil && player.isPlaying
        }
        XCTAssertTrue(model.player === player)
        XCTAssertTrue(model.apiEvents.isEmpty)
        XCTAssertNoThrow(try model.executeApi(.seek, arguments: ["value": "2"]))
    }

    #if !os(tvOS)
    func testLivePreferenceUpdatesEmbeddedControlsWithoutReplacingNativePlayback() async throws {
        continueAfterFailure = false
        try await resetFixture()
        XCTAssertFalse(bitmovinLicenseKey().isEmpty)
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        model.setPresentation(.playerView)
        var draft = model.configurationDraft
        draft.sourceURL = "http://localhost:5198/master.m3u8"
        draft.posterURL = ""; draft.autoplay = true
        try model.apply(draft)
        let (window, host) = try show(model)
        defer { model.player.destroy(); window.isHidden = true; _ = host }
        try await eventually("native live playback and Web UI handshake") {
            model.liveRewindUiReady && model.player.isPlaying && model.hasCurrentLiveSource && model.dvr.dvrAvailable
        }
        let player = model.player, source = try XCTUnwrap(model.player.source)
        let view = try XCTUnwrap(model.apiPlayerView)
        let web = try XCTUnwrap(find(WKWebView.self, in: view))
        var sourceLoads = 0
        let loads = player.events.on(SourceLoadedEvent.self).sink { _ in sourceLoads += 1 }
        defer { loads.cancel() }
        try await eventually("visible enabled embedded seek control") {
            try await self.seekControls(web, expectedVisible: true)
        }
        player.pause()
        try await eventually("paused native playback") { player.isPaused }
        let pausedTime = player.currentTime
        model.setApiEventRecording(false)
        model.timeShiftEnabled = false
        try await eventually("embedded live seek controls hidden while paused") {
            try await self.seekControls(web, expectedVisible: false)
        }
        XCTAssertTrue(model.player === player)
        XCTAssertTrue(player.source === source)
        XCTAssertTrue(model.apiPlayerView === view)
        XCTAssertTrue(player.isPaused)
        XCTAssertEqual(player.currentTime, pausedTime, accuracy: 0.75)
        XCTAssertEqual(sourceLoads, 0)
        XCTAssertThrowsError(try model.executeApi(.timeShift, arguments: ["value": "-5"]))
        model.timeShiftEnabled = true
        try await eventually("embedded live seek controls restored") { try await self.seekControls(web, expectedVisible: true) }
        XCTAssertTrue(model.player === player)
        XCTAssertTrue(player.source === source)
        XCTAssertEqual(sourceLoads, 0)
        player.play()
        let before = player.currentTime
        try await eventually("same native playback advances after toggle") { player.isPlaying && player.currentTime > before + 1 }

        model.timeShiftEnabled = false
        try await setFixture("finalize")
        model.load(ShowcaseSource(id: "controls-vod", label: "Local VOD", kind: .vodHls,
                                 url: try XCTUnwrap(URL(string: "http://localhost:5198/master.m3u8?vod=1"))))
        try await eventually("VOD playback restores embedded seeking despite live preference") {
            guard player.source !== source, !player.isLive, player.duration.isFinite, player.duration > 0 else { return false }
            return try await self.seekControls(web, expectedVisible: true)
        }
        XCTAssertTrue(model.player === player)
        XCTAssertNotNil(model.apiContext().rejection(for: .timeShift))
        XCTAssertNil(model.apiContext().rejection(for: .seek, arguments: ["value": "2"]))
        print("Apple controls: embedded Web UI seek/quickseek visibility changes while paused; exact Player, Source and PlayerView retained; no source reload; same native playback advances; VOD seeking restored")
    }

    private func seekControls(_ web: WKWebView, expectedVisible: Bool) async throws -> Bool {
        let script = """
        (() => {
          const visible = e => {
            for (let p = e; p; p = p.parentElement) {
              const s = getComputedStyle(p);
              if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
            }
            const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
          };
          const seek = [...document.querySelectorAll('.bmpui-ui-seekbar, .bmpui-ui-quickseekbutton')];
          if (!seek.length) return false;
          // Autohide may hide the entire control bar. The policy itself must remove
          // seek controls even when the containing UI is made visible for this check.
          for (const root of document.querySelectorAll('.bmpui-ui-uicontainer')) {
            root.classList.remove('bmpui-controls-hidden');
          }
          const playback = [...document.querySelectorAll('.bmpui-ui-playbacktogglebutton')].some(visible);
          return playback && \(expectedVisible ? "seek.some(visible)" : "seek.every(e => !visible(e))");
        })()
        """
        return (try await web.evaluateJavaScript(script) as? Bool) == true
    }
    #else
    func testTvSystemUiKeepsUnsupportedPreferenceAndNativePlaybackAligned() async throws {
        try await resetFixture()
        XCTAssertFalse(bitmovinLicenseKey().isEmpty)
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        model.setPresentation(.playerView)
        var draft = model.configurationDraft
        draft.sourceURL = "http://localhost:5198/master.m3u8"; draft.autoplay = true
        try model.apply(draft)
        let (window, host) = try show(model)
        defer { model.player.destroy(); window.isHidden = true; _ = host }
        try await eventually("native tvOS playback") { model.player.isPlaying && model.hasCurrentLiveSource }
        let player = model.player, source = try XCTUnwrap(player.source), view = try XCTUnwrap(model.apiPlayerView)
        XCTAssertNotNil(view.systemUi)
        XCTAssertEqual(player.config.styleConfig.userInterfaceType, .system)
        model.timeShiftEnabled = false
        XCTAssertTrue(model.timeShiftEnabled)
        XCTAssertNotNil(model.liveRewindControlsUnavailableReason)
        XCTAssertTrue(model.player === player)
        XCTAssertTrue(player.source === source)
        XCTAssertTrue(model.apiPlayerView === view)
        let before = player.currentTime
        try await eventually("same System UI playback advances") { player.currentTime > before + 1 }
    }
    #endif

    private func show(_ model: PlayerModel) throws -> (UIWindow, UIHostingController<NativePresentationSurface>) {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene), host = UIHostingController(rootView: NativePresentationSurface(model: model))
        window.rootViewController = host; window.windowLevel = .alert + 1; window.makeKeyAndVisible()
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
        return (window, host)
    }
    private func resetFixture() async throws {
        try await setFixture("reset")
    }
    private func setFixture(_ action: String) async throws {
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://localhost:5199/\(action)")))
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }
    #if !os(tvOS)
    private func find<T: UIView>(_ type: T.Type, in root: UIView) -> T? {
        if let result = root as? T { return result }
        for child in root.subviews { if let result = find(type, in: child) { return result } }
        return nil
    }
    #endif
    private func eventually(_ stage: String, predicate: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            if try await predicate() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out waiting for \(stage)"); throw QualificationFailure.deadline
    }
    private enum QualificationFailure: Error { case deadline }
}
