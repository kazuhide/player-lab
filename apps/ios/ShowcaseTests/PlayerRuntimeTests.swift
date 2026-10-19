import BitmovinPlayer
import Combine
import DvrKit
import UIKit
import WebKit
import XCTest
@testable import Showcase_iOS

/// Real SDK integration checks. These need an allowed app identifier and network
/// access; they deliberately fail rather than substituting a mock Player.
@MainActor
final class PlayerRuntimeTests: XCTestCase {
    private var subscriptions = Set<AnyCancellable>()
    private var errorCodes: [Int] = []
    private var sourceLoads = 0
    private var timeShiftCompletions = 0

    func testSharedUiPlaybackSourceSwitchAndDvrControls() async throws {
        XCTAssertFalse(bitmovinLicenseKey().isEmpty, "Configure a native Player license first")
        XCTAssertTrue(Sources.all.allSatisfy { $0.kind == .liveHls || $0.kind == .vodHls })
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        defer { model.player.destroy(); subscriptions.removeAll() }

        // Use the same model methods that the app's control panel calls.
        model.setUiMode(.sports)
        observeErrors(model.player)
        let controller = UIViewController()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.windowLevel = .alert + 1
        window.rootViewController = controller
        let frame = CGRect(x: 0, y: 0, width: window.bounds.width, height: window.bounds.width * 9 / 16)
        let view = PlayerView(player: model.player, frame: frame)
        controller.view.addSubview(view)
        window.makeKeyAndVisible()
        defer { view.player = nil; window.isHidden = true }

        model.load(try XCTUnwrap(Sources.all.first { $0.kind == .vodHls }))
        try await eventually("finite VOD duration") {
            model.player.duration.isFinite && model.player.duration > 0 && model.dvr.mode == .vod
        }
        let webView = try await sharedWebView(in: view, skin: "sports")
        // Click the rendered shared UI, proving its JavaScript-to-native bridge.
        let clicked = try await webView.evaluateJavaScript("""
            (() => {
              const button = [...document.querySelectorAll('.bmpui-ui-playbacktogglebutton')]
                .find(button => button.getBoundingClientRect().width > 0);
              if (!button) return false;
              button.click();
              return true;
            })()
            """) as? Bool
        XCTAssertEqual(clicked, true, "Shared UI must expose a visible playback button")
        let start = model.player.currentTime
        try await eventually("shared UI starts advancing playback") {
            model.player.isPlaying && model.player.currentTime > start + 1
        }

        let previousLoads = sourceLoads
        model.load(try XCTUnwrap(Sources.all.first { $0.kind == .liveHls }))
        try await eventually("live HLS source loads") { self.sourceLoads > previousLoads }
        model.player.play()
        try await eventually("live source supplies a rewind window", timeout: 60) {
            model.dvr.isLive && model.dvr.dvrAvailable && model.dvr.windowDuration > 10
        }
        let beforeRewind = timeShiftCompletions
        model.seek(toOffsetFromEdge: -10)
        try await eventually("rewind completes in the SDK and shared UI") {
            let offset = model.player.timeShift
            guard self.timeShiftCompletions > beforeRewind,
                  offset.isFinite && (-13 ... -7).contains(offset) else { return false }
            return try await self.sharedLiveUi(in: webView, atEdge: false)
        }
        let beforeReturn = timeShiftCompletions
        model.goToLiveEdge()
        let requestedOffset = model.player.timeShift
        let returnCompletedAtRequest = timeShiftCompletions > beforeReturn
        let uiAtEdgeAfterRequest = try await sharedLiveUi(in: webView, atEdge: true)
        print("Live return requested: offset=\(requestedOffset), completed=\(returnCompletedAtRequest), uiAtEdge=\(uiAtEdgeAfterRequest)")
        try await eventually("return to live completes in the SDK and shared UI") {
            guard self.timeShiftCompletions > beforeReturn,
                  abs(model.player.timeShift) < 1 else { return false }
            return try await self.sharedLiveUi(in: webView, atEdge: true)
        }
        print("Live return settled: offset=\(model.player.timeShift), completed=true, uiAtEdge=true")
        model.timeShiftEnabled = false
        XCTAssertFalse(model.dvr.dvrAvailable)
        model.timeShiftEnabled = true
        XCTAssertTrue(model.dvr.dvrAvailable)
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let screenshot = XCTAttachment(image: image)
        screenshot.name = "shared-sports-ui-live-playback"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        // Source switching returns to finite VOD without retaining live state.
        model.load(try XCTUnwrap(Sources.all.first { $0.kind == .vodHls }))
        try await eventually("VOD state after source switch") { model.dvr.mode == .vod }
        XCTAssertFalse(model.dvr.dvrAvailable)

        // Changing the factory recreates the Player with its current source.
        model.setUiMode(.cinema)
        subscriptions.removeAll()
        observeErrors(model.player)
        view.player = nil
        view.removeFromSuperview()
        let cinemaView = PlayerView(player: model.player, frame: frame)
        controller.view.addSubview(cinemaView)
        defer { cinemaView.player = nil }
        try await eventually("VOD survives UI recreation") { model.dvr.mode == .vod && model.player.duration > 0 }
        _ = try await sharedWebView(in: cinemaView, skin: "cinema")
        XCTAssertTrue(errorCodes.isEmpty, "Player/Source errors: \(errorCodes)")
    }

    private func observeErrors(_ player: Player) {
        player.events.on(TimeShiftedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.timeShiftCompletions += 1 }
            .store(in: &subscriptions)
        player.events.on(SourceLoadedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.sourceLoads += 1 }
            .store(in: &subscriptions)
        player.events.on(PlayerErrorEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] event in self?.errorCodes.append(event.errorCode) }
            .store(in: &subscriptions)
        player.events.on(SourceErrorEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] event in self?.errorCodes.append(event.errorCode) }
            .store(in: &subscriptions)
    }

    private func eventually(
        _ label: String, timeout: TimeInterval = 40, predicate: @MainActor () async throws -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !errorCodes.isEmpty { break }
            if try await predicate() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out: \(label); Player/Source error codes: \(errorCodes)")
        throw RuntimeFailure.timeout
    }

    private func sharedLiveUi(in webView: WKWebView, atEdge: Bool) async throws -> Bool {
        let script = """
            (() => {
              const visible = selector => [...document.querySelectorAll(selector)]
                .find(element => element.getBoundingClientRect().width > 0);
              const label = visible('.bmpui-ui-label-behindlive');
              const button = visible('.bmpui-ui-livebutton');
              if (!label || !button) return false;
              const atEdge = \(atEdge ? "true" : "false");
              const text = label.textContent.trim();
              return atEdge
                ? text === 'LIVE' && button.classList.contains('bmpui-at-live-edge')
                  && !button.classList.contains('bmpui-behind-live')
                : text.endsWith(' behind') && button.classList.contains('bmpui-behind-live')
                  && !button.classList.contains('bmpui-at-live-edge');
            })()
            """
        return try await webView.evaluateJavaScript(script) as? Bool == true
    }

    private func sharedWebView(in root: UIView, skin: String) async throws -> WKWebView {
        let deadline = Date().addingTimeInterval(40)
        while Date() < deadline {
            for webView in descendants(of: root).compactMap({ $0 as? WKWebView }) {
                let script = """
                    typeof bitmovin?.playerui?.UIFactory?.buildSportsUI === 'function' &&
                    !!document.querySelector('.bmpui-ui-skin-\(skin)') &&
                    [...document.querySelectorAll('link[rel="stylesheet"]')]
                      .some(link => link.href.includes('bitmovinplayer-ui.css'))
                    """
                if (try? await webView.evaluateJavaScript(script)) as? Bool == true { return webView }
            }
            if !errorCodes.isEmpty { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Shared UI DOM/styles did not load; error codes: \(errorCodes)")
        throw RuntimeFailure.timeout
    }

    private func descendants(of view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants(of: $0) }
    }

    private enum RuntimeFailure: Error { case timeout }
}
