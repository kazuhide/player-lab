import BitmovinPlayer
import Combine
import SwiftUI
import WebKit

/// A test-only viewport for the original native host and workspace controls.
/// The production application target does not compile this file.
@main
struct NativeControlsQualificationHost: App {
    @StateObject private var state = NativeControlsQualificationState()

    var body: some Scene {
        WindowGroup {
            GeometryReader { geometry in
                // Leave the original workspace usable when the OS keyboard
                // reduces this test viewport; the same native host is resized.
                let previewHeight = min(max(1, geometry.size.width - 24) * 9 / 16,
                                        max(44, geometry.size.height - 420))
                VStack(spacing: 8) {
                    NativePresentationSurface(model: state.model)
                        .frame(height: previewHeight)
                        .accessibilityIdentifier("qualification.player.surface")
                    NativeControlsObservationLabel(state: state).frame(height: 20)
                    ControlPanel(model: state.model)
                }
                .padding(12)
                .background(Color.workspaceBackground.ignoresSafeArea())
            }
            .task { await state.observe() }
        }
    }
}

func bitmovinLicenseKey() -> String {
    (Bundle.main.object(forInfoDictionaryKey: "BitmovinLicenseKey") as? String) ?? ""
}

func bitmovinAnalyticsLicenseKey() -> String { "" }

@MainActor
private final class NativeControlsQualificationState: ObservableObject {
    let model: PlayerModel
    weak var label: UILabel?
    private weak var observedPlayer: Player?
    private var subscriptions = Set<AnyCancellable>()
    private var sourceLoads = 0
    private var sourceErrors = 0
    private var playerErrors = 0
    private var observationFailures = 0
    private var sequence = 0
    private var setupError: String?

    init() {
        let key = bitmovinLicenseKey()
        precondition(!key.isEmpty, "The native controls qualification requires a configured player key")
        let model = PlayerModel(licenseKey: key)
        self.model = model
        model.setPresentation(.playerView)
        model.setApiEventRecording(false)
        var draft = model.configurationDraft
        draft.sourceURL = ProcessInfo.processInfo.environment["PLAYER_LAB_CONTROLS_MEDIA_URL"] ?? "http://localhost:5198/master.m3u8"
        draft.posterURL = ""
        draft.autoplay = true
        do { try model.apply(draft) }
        catch { setupError = String(describing: error) }
    }

    func observe() async {
        while !Task.isCancelled {
            await capture()
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        subscriptions.removeAll()
    }

    private func capture() async {
        let player = model.player
        guard !player.isDestroyed else { return }
        if observedPlayer !== player {
            subscriptions.removeAll()
            observedPlayer = player
            player.events.on(SourceLoadedEvent.self).sink { [weak self] _ in self?.sourceLoads += 1 }.store(in: &subscriptions)
            player.events.on(SourceErrorEvent.self).sink { [weak self] _ in self?.sourceErrors += 1 }.store(in: &subscriptions)
            player.events.on(PlayerErrorEvent.self).sink { [weak self] _ in self?.playerErrors += 1 }.store(in: &subscriptions)
        }
        let source = player.source
        let view = model.apiPlayerView
        var webValues: [String: Any] = [:]
        if let view, let web = findWebView(in: view) {
            do {
                webValues = (try await web.evaluateJavaScript(Self.readOnlyDomSnapshot) as? [String: Any]) ?? [:]
                let screen = web.convert(web.bounds, to: nil)
                webValues["screenBounds"] = ["x": screen.minX, "y": screen.minY, "width": screen.width, "height": screen.height]
            } catch {
                observationFailures += 1
                webValues["readError"] = String(describing: error)
            }
        }
        // A read that straddles replacement is discarded rather than attributed
        // to the new owner or source.
        guard model.player === player, player.source === source, model.apiPlayerView === view else { return }
        sequence += 1
        let context = model.apiContext()
        let values: [String: Any] = [
            "sequence": sequence, "sdkVersion": PlayerFactory.sdkVersion,
            "playerIdentity": String(describing: ObjectIdentifier(player)),
            "sourceIdentity": source.map { String(describing: ObjectIdentifier($0)) } ?? "nil",
            "viewIdentity": view.map { String(describing: ObjectIdentifier($0)) } ?? "nil",
            "nativePlaying": player.isPlaying, "nativePaused": player.isPaused,
            "nativeLive": player.isLive, "nativeCurrentTime": finite(player.currentTime),
            "nativeTimeShift": finite(player.timeShift), "nativeMaxTimeShift": finite(player.maxTimeShift),
            "nativeDuration": finite(player.duration), "sourceLoads": sourceLoads,
            "sourceErrors": sourceErrors, "playerErrors": playerErrors,
            "observationFailures": observationFailures, "setupError": setupError ?? "",
            "appRewindEnabled": model.timeShiftEnabled, "webUiReady": model.liveRewindUiReady,
            "apiEventsEmpty": model.apiEvents.isEmpty,
            "timeShiftZeroAvailable": context.rejection(for: .timeShift, arguments: ["value": "0"]) == nil,
            "timeShiftRewindAvailable": context.rejection(for: .timeShift, arguments: ["value": "-5"]) == nil,
            "web": webValues,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            // Updating only the AX value does not redraw or interact with the SDK UI.
            label?.accessibilityValue = text
        }
    }

    private func finite(_ value: Double) -> Any { value.isFinite ? value : NSNull() }

    private func findWebView(in view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        for child in view.subviews { if let web = findWebView(in: child) { return web } }
        return nil
    }

    /// Observation only: no events, property writes, classes, styles or DOM mutations.
    private static let readOnlyDomSnapshot = """
    (() => {
      const visible = element => {
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const rect = element => {
        const box = element.getBoundingClientRect();
        return {x:box.x, y:box.y, width:box.width, height:box.height};
      };
      const describe = element => ({visible:visible(element), rect:rect(element),
        classes:element.className, label:element.getAttribute('aria-label')});
      const bars = [...document.querySelectorAll('.bmpui-ui-controlbar')];
      let safeRevealPoint = null;
      for (const bar of bars) {
        const box = bar.getBoundingClientRect();
        for (const inset of [4, 8, 12]) {
          const x = box.right - inset, y = box.bottom - inset;
          if (x <= box.left || y <= box.top || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && bar.contains(hit) && !hit.closest('button,a,input,[role="button"],[role="slider"],.bmpui-ui-hugeplaybacktogglebutton,.bmpui-ui-playbacktogglebutton,.bmpui-ui-seekbar')) {
            safeRevealPoint = {x,y,hitClasses:hit.className};
            break;
          }
        }
        if (safeRevealPoint) break;
      }
      return {ready:document.readyState, width:innerWidth, height:innerHeight,
        roots:[...document.querySelectorAll('.bmpui-ui-uicontainer')].map(describe),
        seeks:[...document.querySelectorAll('.bmpui-ui-seekbar,.bmpui-ui-quickseekbutton')].map(describe),
        playback:[...document.querySelectorAll('.bmpui-ui-playbacktogglebutton')].map(describe),
        bars:bars.map(describe), safeRevealPoint};
    })()
    """
}

private struct NativeControlsObservationLabel: UIViewRepresentable {
    let state: NativeControlsQualificationState
    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.text = "Read-only native/Web UI observation"
        label.font = .preferredFont(forTextStyle: .caption2)
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = "qualification.observation"
        label.accessibilityValue = "{}"
        state.label = label
        return label
    }
    func updateUIView(_ label: UILabel, context: Context) {}
}
