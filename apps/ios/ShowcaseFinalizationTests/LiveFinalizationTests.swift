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
    private var timeChanged = 0
    private var completedRewindTime: TimeInterval?
    private var completedSeekTime: TimeInterval?
    private var changedRelativeTime: TimeInterval?
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
        XCTAssertEqual(player.config.styleConfig.playerUiCss,
                       Bundle.main.url(forResource: "bitmovinplayer-ui", withExtension: "css"))
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

        // seek(time:) is a VOD API. Observe the completed source as reported by
        // the SDK before explicitly reloading its final manifest as VOD.
        player.pause()
        let completedSource = try XCTUnwrap(player.source)
        let completedUrl = completedSource.sourceConfig.url
        let retainedWasLive = player.isLive
        let retainedSeeked = seeked
        player.seek(time: 30)
        let retainedDeadline = Date().addingTimeInterval(40)
        while Date() < retainedDeadline && seeked == retainedSeeked && errors.isEmpty {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let retainedSeekCompleted = seeked > retainedSeeked && completedSeekTime.map {
            $0.isFinite && abs($0 - 30) <= 1
        } == true
        XCTAssertTrue(model.player === player && player.source === completedSource)
        if !retainedWasLive { XCTAssertTrue(retainedSeekCompleted) }
        XCTAssertTrue(errors.isEmpty, "Native Player/Source numeric error codes: \(errors)")
        print("Native completed-source seek: nativeLive=\(player.isLive), durationFinite=\(player.duration.isFinite), freshSeekedAt30=\(retainedSeekCompleted)")

        // A title-only Apply is the existing source-only path: same player and
        // exact URL, a new Source reading the now-final HLS manifest.
        var finalDraft = model.configurationDraft
        finalDraft.title = "Completed HLS on demand"
        XCTAssertEqual(try model.apply(finalDraft), .reloadSource)
        try await eventually("same-URL source-only Apply loads finite VOD on the same player") {
            self.sourceLoads == loadedBeforeEnd + 1 && model.player === player &&
                player.source !== completedSource && player.source?.sourceConfig.url == completedUrl &&
                !player.isLive && player.duration.isFinite && abs(player.duration - 60) < 1 &&
                model.dvr.mode == .vod && !model.dvr.dvrAvailable
        }
        let finalSource = try XCTUnwrap(player.source)
        player.play()
        try await eventually("finite VOD starts on the reloaded final manifest") {
            player.isPlaying && player.currentTime(.relativeTime) > 1
        }
        player.pause()
        let beforeVodSeek = seeked
        player.seek(time: 30)
        try await eventually("fresh finite VOD Seeked completes at thirty seconds") {
            self.seeked > beforeVodSeek && self.completedSeekTime.map {
                $0.isFinite && abs($0 - 30) <= 1
            } == true && abs(player.currentTime(.relativeTime) - 30) <= 1
        }
        XCTAssertTrue(model.player === player && player.source === finalSource)
        XCTAssertEqual(finalSource.sourceConfig.url, completedUrl)
        XCTAssertTrue(view.window === window && !view.isHidden && view.alpha > 0 &&
                      view.convert(view.bounds, to: window).intersects(window.bounds))
        #if !os(tvOS)
        let clockStyles = try await webView.evaluateJavaScript("""
            (() => {
              const element = document.querySelector('.bmpui-ui-label-wallclock');
              const matches = [];
              let fixRulePresent = false, readableSheets = 0;
              const visit = rules => {
                for (const rule of rules) {
                  if (rule.selectorText && rule.style) {
                    if (rule.selectorText.includes('.bmpui-ui-label-wallclock.bmpui-hidden') &&
                        rule.style.display === 'none') fixRulePresent = true;
                    try {
                      if (element?.matches(rule.selectorText) && rule.style.display)
                        matches.push({ selector: rule.selectorText, display: rule.style.display,
                          important: rule.style.getPropertyPriority('display') === 'important' });
                    } catch {}
                  } else if (rule.cssRules) {
                    if (!rule.media || matchMedia(rule.conditionText).matches) visit(rule.cssRules);
                  }
                }
              };
              for (const sheet of document.styleSheets) {
                try { visit(sheet.cssRules); readableSheets++; } catch {}
              }
              return { exists: !!element, ownHidden: !!element?.classList.contains('bmpui-hidden'),
                display: element ? getComputedStyle(element).display : 'absent',
                fixRulePresent, readableSheets, matchedDisplayRules: matches.slice(0, 10) };
            })()
            """)
        if let data = try? JSONSerialization.data(withJSONObject: clockStyles, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print("Native VOD clock CSS: \(text)") }
        try await eventually("rendered VOD seek marker confirms the completed thirty-second seek") {
            try await self.webControl(webView, expression: """
                const bar = visible('.bmpui-seekbar');
                const marker = visible('.bmpui-seekbar-playbackposition-marker');
                if (!bar || !marker) return false;
                const track = bar.getBoundingClientRect(), dot = marker.getBoundingClientRect();
                const position = (dot.left + dot.width / 2 - track.left) / track.width;
                return Math.abs(position - 0.5) < 0.03 &&
                  dot.left >= 0 && dot.right <= innerWidth && dot.top >= 0 && dot.bottom <= innerHeight &&
                  !visible('.bmpui-ui-livebutton') && !visible('.bmpui-ui-label-wallclock');
                """)
        }
        #endif
        let vodAttachment = XCTAttachment(image: UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        })
        vodAttachment.name = "same-player-same-url-finite-vod-seek-thirty"
        vodAttachment.lifetime = .keepAlways
        add(vodAttachment)
        print("Native HLS finite VOD seek: samePlayer=true, sameUrl=true, newSource=true, freshSeekedAt30=true, visiblePlayer=true, relativeTimeSeconds=\(player.currentTime(.relativeTime))")
        let beforeVodPlayback = timeChanged
        player.play()
        try await eventually("native VOD playback advances after the completed seek") {
            player.isPlaying && self.timeChanged > beforeVodPlayback &&
                self.changedRelativeTime.map { $0 > 31 } == true && player.currentTime(.relativeTime) > 31
        }
        let advancingAttachment = XCTAttachment(image: UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        })
        advancingAttachment.name = "finite-vod-seek-completed-playback-advances"
        advancingAttachment.lifetime = .keepAlways
        add(advancingAttachment)
        print("Native HLS post-seek playback: freshTimeChanged=true, relativeTimeSeconds=\(player.currentTime(.relativeTime))")
        let loadedAfterFinalReload = sourceLoads

        // A new load generation clears finalization, even when the fixture is reused.
        _ = try await control("reset", method: "POST")
        model.load(ShowcaseSource(id: "next-local-live", label: "New live generation", kind: .liveHls,
                                 url: try XCTUnwrap(URL(string: "http://localhost:5198/master.m3u8?generation=2"))))
        try await eventually("new native live source resets completion") {
            self.sourceLoads == loadedAfterFinalReload + 1 && player.isLive
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
            self.sourceLoads == loadedAfterFinalReload + 2 && !player.isLive &&
                player.duration.isFinite && player.duration > 0 && model.dvr.mode == .vod && !model.dvr.dvrAvailable
        }
        XCTAssertTrue(errors.isEmpty, "Native Player/Source numeric error codes: \(errors)")
        print("Native HLS ending: PlaybackFinished=true, sameSourceReplayAdvances=true, liveCommandsStayDisabled=true, sameUrlFiniteVodSeek=true, newSourceResets=true, vodSwitch=true")
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
            .sink { [weak self, weak player] _ in
                self?.seeked += 1
                self?.completedSeekTime = player?.currentTime(.relativeTime)
            }.store(in: &subscriptions)
        player.events.on(PlaybackFinishedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.finished += 1 }.store(in: &subscriptions)
        player.events.on(DurationChangedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.durationChanges += 1 }.store(in: &subscriptions)
        player.events.on(TimeChangedEvent.self).receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                self?.timeChanged += 1
                self?.changedRelativeTime = player?.currentTime(.relativeTime)
            }.store(in: &subscriptions)
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
        state["TimeChanged"] = timeChanged
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
                wallClock: state('.bmpui-ui-label-wallclock'),
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
