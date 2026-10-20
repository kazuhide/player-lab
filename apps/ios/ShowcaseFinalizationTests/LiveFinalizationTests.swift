import BitmovinPlayer
import Combine
import DvrKit
import UIKit
import XCTest
#if os(tvOS)
@testable import Showcase_tvOS
#else
import WebKit
@testable import Showcase_iOS
#endif

/// Opt-in real SDK acceptance. Start runtime-fixture.mjs before running this test.
@MainActor
final class LiveFinalizationTests: XCTestCase {
    private var subscriptions = Set<AnyCancellable>()
    private var errors: [Int] = []
    private var sourceLoads = 0
    private var timeShifted = 0
    private var seeked = 0
    private var finished = 0
    private var durationChanges = 0
    private var completedRewindTime: TimeInterval?
    private var failureState: (() -> [String: Any])?
    #if !os(tvOS)
    private weak var observedWebView: WKWebView?
    #endif

    func testHlsEndListCompletesNativePlaybackAndKeepsLiveCommandsDisabledDuringReplay() async throws {
        continueAfterFailure = false
        XCTAssertFalse(bitmovinLicenseKey().isEmpty, "Configure the app's normal native Player license")
        _ = try await control("reset", method: "POST")
        let model = PlayerModel(licenseKey: bitmovinLicenseKey())
        #if !os(tvOS)
        model.setUiMode(.sports)
        #endif
        let player = model.player
        observe(player)
        failureState = { [weak player, weak model] in
            guard let player, let model else { return ["nativeOwnerAvailable": false] }
            return [
                "nativeOwnerAvailable": true, "sameOwner": model.player === player,
                "nativeLive": player.isLive, "nativePlaying": player.isPlaying,
                "durationFinite": player.duration.isFinite,
                "durationSeconds": player.duration.isFinite ? player.duration as Any : NSNull(),
                "relativeTimeSeconds": player.currentTime(.relativeTime),
                "appMode": model.dvr.mode.rawValue, "appDvrAvailable": model.dvr.dvrAvailable,
            ]
        }
        defer { player.destroy(); subscriptions.removeAll() }

        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.windowLevel = .alert + 1
        let controller = UIViewController()
        window.rootViewController = controller
        let view = PlayerView(player: player,
                              frame: CGRect(x: 0, y: 0, width: window.bounds.width,
                                            height: window.bounds.width * 9 / 16))
        controller.view.addSubview(view)
        window.makeKeyAndVisible()
        defer { view.player = nil; window.isHidden = true }

        var draft = model.configurationDraft
        draft.sourceURL = "http://localhost:5198/master.m3u8"
        draft.title = "Local live ending"
        draft.posterURL = ""
        draft.startOffset = ""
        draft.sourceType = .hls
        try model.apply(draft)
        try await eventually("native live source load") { self.sourceLoads == 1 && player.isLive }
        #if os(tvOS)
        XCTAssertEqual(player.config.styleConfig.userInterfaceType, .system)
        player.play()
        #else
        let webView = try await sharedWebView(in: view)
        observedWebView = webView
        try await eventually("visible shared UI playback control") {
            try await self.webControl(webView, expression: """
                const button = visible('.bmpui-ui-playbacktogglebutton');
                if (!button) return false;
                button.click(); return true;
                """)
        }
        #endif
        let start = player.currentTime(.relativeTime)
        try await eventually("native live playback advances") {
            player.isPlaying && player.currentTime(.relativeTime) > start + 1 &&
                model.dvr.isLive && model.dvr.dvrAvailable && model.dvr.windowDuration > 10
        }
        XCTAssertTrue(view.window != nil && !view.isHidden && view.alpha > 0)
        let beforeRewind = timeShifted
        let target = player.currentTime - player.timeShift - 10
        model.seek(toOffsetFromEdge: -10)
        try await eventually("fresh native rewind completion at the requested media time") {
            self.timeShifted > beforeRewind && self.completedRewindTime.map {
                $0.isFinite && abs($0 - target) <= 3
            } == true && player.timeShift.isFinite && player.timeShift < 0
        }
        #if !os(tvOS)
        try await eventually("visible live controls behind the edge") {
            try await self.webControl(webView, expression: """
                const button = visible('.bmpui-ui-livebutton');
                const label = visible('.bmpui-ui-label-behindlive');
                return !!button && button.classList.contains('bmpui-behind-live') &&
                  !!label && label.textContent.trim().endsWith(' behind');
                """)
        }
        #endif
        let loadedBeforeEnd = sourceLoads
        _ = try await control("finalize", method: "POST")
        try await eventually("fresh native PlaybackFinished at the controlled media end", timeout: 25) {
            self.finished == 1 && !player.isPlaying && abs(player.currentTime(.relativeTime) - 60) < 1
        }
        try await eventually("completed source disables app live commands") {
            !model.dvr.isLive && !model.dvr.dvrAvailable &&
                (model.dvr.mode == .endedLive || model.dvr.mode == .vod)
        }
        XCTAssertTrue(model.player === player)
        XCTAssertEqual(sourceLoads, loadedBeforeEnd, "ENDLIST must settle the existing source")
        let counts = try await control("state")
        XCTAssertGreaterThan(counts["liveManifests"] as? Int ?? 0, 0)
        XCTAssertGreaterThan(counts["finalManifests"] as? Int ?? 0, 0)
        XCTAssertGreaterThan(counts["mediaRequests"] as? Int ?? 0, 0)
        if player.duration.isFinite {
            XCTAssertFalse(player.isLive)
            XCTAssertEqual(player.duration, 60, accuracy: 1)
            XCTAssertEqual(model.dvr.mode, .vod)
        } else {
            // AVFoundation can complete HLS while retaining its live/infinite getters.
            XCTAssertTrue(player.isLive)
            XCTAssertTrue(player.duration.isInfinite)
            XCTAssertEqual(model.dvr.mode, .endedLive)
        }
        let shiftedAtEnd = timeShifted
        model.goToLiveEdge()
        model.seek(toOffsetFromEdge: -10)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(timeShifted, shiftedAtEnd, "Completed sources must not receive live commands")
        #if !os(tvOS)
        try await eventually("visible SDK Replay with explicitly hidden LIVE controls") {
            try await self.completedWebUi(webView, replayVisible: true)
        }
        let clickedReplay = try await webControl(webView, expression: """
            const button = visible('.bmpui-ui-hugereplaybutton');
            if (!button || button.disabled) return false;
            button.click(); return true;
            """)
        XCTAssertTrue(clickedReplay)
        #else
        player.play()
        #endif
        try await eventually("SDK replay starts this same source again") {
            player.isPlaying && player.currentTime(.relativeTime) < 50
        }
        let replayStart = player.currentTime(.relativeTime)
        try await eventually("actual native replay clock advances") {
            player.isPlaying && player.currentTime(.relativeTime) > replayStart + 1
        }
        XCTAssertFalse(model.dvr.isLive)
        XCTAssertFalse(model.dvr.dvrAvailable)
        XCTAssertEqual(sourceLoads, loadedBeforeEnd)
        XCTAssertTrue(model.player === player)
        #if !os(tvOS)
        try await eventually("replay cannot restore LIVE controls for the completed source") {
            try await self.completedWebUi(webView, replayVisible: false)
        }
        #endif
        let attachment = XCTAttachment(image: UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        })
        attachment.name = "native-hls-endlist-playback-finished"
        attachment.lifetime = .keepAlways
        add(attachment)
        let replayShifted = timeShifted
        model.goToLiveEdge()
        model.seek(toOffsetFromEdge: -10)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(timeShifted, replayShifted)

        // A new load generation clears finalization, even when the fixture is reused.
        _ = try await control("reset", method: "POST")
        model.load(ShowcaseSource(id: "next-local-live", label: "New live generation", kind: .liveHls,
                                 url: try XCTUnwrap(URL(string: "http://localhost:5198/master.m3u8?generation=2"))))
        try await eventually("new native live source resets completion") {
            self.sourceLoads == loadedBeforeEnd + 1 && player.isLive
        }
        player.play()
        try await eventually("new source restores ongoing live DVR state") {
            player.isPlaying && model.dvr.isLive && model.dvr.dvrAvailable
        }
        #if !os(tvOS)
        try await eventually("new source restores shared live controls") {
            try await self.webControl(webView, expression: """
                return !!visible('.bmpui-ui-livebutton') && !!visible('.bmpui-ui-label-behindlive');
                """)
        }
        #endif
        model.load(try XCTUnwrap(Sources.all.first { $0.kind == .vodHls }))
        try await eventually("explicit VOD source switch clears live and completion state") {
            self.sourceLoads == loadedBeforeEnd + 2 && !player.isLive &&
                player.duration.isFinite && player.duration > 0 && model.dvr.mode == .vod && !model.dvr.dvrAvailable
        }
        XCTAssertTrue(errors.isEmpty, "Native Player/Source numeric error codes: \(errors)")
        print("Native HLS ending: PlaybackFinished=true, sameSourceReplayAdvances=true, liveCommandsStayDisabled=true, newSourceResets=true, vodSwitch=true")
    }

    private func observe(_ player: Player) {
        player.events.on(SourceLoadedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.sourceLoads += 1 }.store(in: &subscriptions)
        player.events.on(TimeShiftedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                self?.timeShifted += 1
                self?.completedRewindTime = player?.currentTime
            }.store(in: &subscriptions)
        player.events.on(SeekedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.seeked += 1 }.store(in: &subscriptions)
        player.events.on(PlaybackFinishedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.finished += 1 }.store(in: &subscriptions)
        player.events.on(DurationChangedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.durationChanges += 1 }.store(in: &subscriptions)
        player.events.on(PlayerErrorEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.errors.append($0.errorCode) }.store(in: &subscriptions)
        player.events.on(SourceErrorEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.errors.append($0.errorCode) }.store(in: &subscriptions)
    }

    private func control(_ operation: String, method: String = "GET") async throws -> [String: Any] {
        var request = URLRequest(url: try XCTUnwrap(URL(string: "http://localhost:5199/\(operation)")))
        request.httpMethod = method
        request.timeoutInterval = 5
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func eventually(_ label: String, timeout: TimeInterval = 40,
                            predicate: @MainActor () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !errors.isEmpty { break }
            if try await predicate() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        var state = failureState?() ?? [:]
        state["SourceLoaded"] = sourceLoads
        state["TimeShifted"] = timeShifted
        state["Seeked"] = seeked
        state["DurationChanged"] = durationChanges
        state["PlaybackFinished"] = finished
        if let counts = try? await control("state") { state["fixtureRequests"] = counts }
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print("Native HLS timeout state: \(text)") }
        #if !os(tvOS)
        if let web = observedWebView,
           let values = try? await web.evaluateJavaScript("""
            (() => {
              const visible = element => {
                if (!element) return false;
                const rect = element.getBoundingClientRect();
                if (!(rect.width > 0 && rect.height > 0)) return false;
                for (let node = element; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (style.display === 'none' || style.visibility === 'hidden' ||
                      style.visibility === 'collapse' || Number(style.opacity) <= 0) return false;
                }
                return true;
              };
              const state = selector => {
                const element = document.querySelector(selector);
                return { exists: !!element, visible: visible(element),
                  ownHidden: !!element?.classList.contains('bmpui-hidden'),
                  replayText: !!element?.textContent.toLowerCase().includes('replay'),
                  replayAria: !!element?.getAttribute('aria-label')?.toLowerCase().includes('replay') };
              };
              return { replay: state('.bmpui-ui-hugereplaybutton'),
                overlay: state('.bmpui-ui-recommendation-overlay'),
                live: state('.bmpui-ui-livebutton'), label: state('.bmpui-ui-label-behindlive') };
            })()
            """),
           let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print("Native HLS timeout Web UI: \(text)") }
        #endif
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            guard let window = scene.windows.filter({ !$0.isHidden }).max(by: { $0.windowLevel < $1.windowLevel }) else { continue }
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "native-hls-failure-state"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTFail("Timed out: \(label); native numeric error codes: \(errors)")
        throw RuntimeFailure.timeout
    }

    #if !os(tvOS)
    private func completedWebUi(_ webView: WKWebView, replayVisible: Bool) async throws -> Bool {
        try await webControl(webView, expression: """
            const live = document.querySelector('.bmpui-ui-livebutton');
            const label = document.querySelector('.bmpui-ui-label-behindlive');
            const replay = visible('.bmpui-ui-hugereplaybutton');
            return !!live && live.classList.contains('bmpui-hidden') &&
              !!label && label.classList.contains('bmpui-hidden') &&
              !visible('.bmpui-ui-livebutton') && !visible('.bmpui-ui-label-behindlive') &&
              \(replayVisible ? "!!replay && !replay.disabled && replay.getAttribute('aria-label')?.toLowerCase().includes('replay')" : "!replay");
            """)
    }

    private func sharedWebView(in root: UIView) async throws -> WKWebView {
        var result: WKWebView?
        try await eventually("actual shared Sports DOM and stylesheet") {
            for web in self.descendants(root).compactMap({ $0 as? WKWebView }) {
                if (try? await web.evaluateJavaScript("""
                    !!document.querySelector('.bmpui-ui-skin-sports') &&
                    [...document.querySelectorAll('link[rel="stylesheet"]')]
                      .some(link => link.href.includes('bitmovinplayer-ui.css'))
                    """)) as? Bool == true { result = web; return true }
            }
            return false
        }
        return try XCTUnwrap(result)
    }

    private func webControl(_ web: WKWebView, expression: String) async throws -> Bool {
        try await web.evaluateJavaScript("""
            (() => {
              const isVisible = element => {
                const rect = element.getBoundingClientRect();
                if (!(rect.width > 0 && rect.height > 0)) return false;
                for (let node = element; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (style.display === 'none' || style.visibility === 'hidden' ||
                      style.visibility === 'collapse' || Number(style.opacity) <= 0) return false;
                }
                return true;
              };
              const visible = selector => [...document.querySelectorAll(selector)].find(isVisible);
              const root = visible('.bmpui-ui-uicontainer');
              if (root) root.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
              \(expression)
            })()
            """) as? Bool == true
    }

    private func descendants(_ view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }
    #endif

    private enum RuntimeFailure: Error { case timeout }
}
