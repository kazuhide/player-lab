#if DEBUG
import CoreFoundation
import UIKit
import WebKit

/// Compiled only into the opt-in external runtime host, never the ordinary showcase.
@MainActor
@objc(PlayerLabRuntimeUiObserver)
final class PlayerLabRuntimeUiObserver: NSObject {
    private static let shared = PlayerLabRuntimeUiObserver()
    private static let signal = "com.playerlab.reactnative.runtime.observe-ui"
    private static var installed = false
    private var sequence = 0
    private weak var observation: UIView?

    @objc static func install() {
        guard !installed else { return }
        installed = true
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            DispatchQueue.main.async { PlayerLabRuntimeUiObserver.shared.capture() }
        }, signal as CFString, nil, .deliverImmediately)
    }

    private func visibleWebViews(in window: UIWindow) -> [WKWebView] {
        func find(_ view: UIView) -> [WKWebView] {
            guard !view.isHidden, view.alpha > 0, view === window || view.window === window else { return [] }
            if let web = view as? WKWebView {
                let rect = web.convert(web.bounds, to: window)
                return rect.width > 0 && rect.height > 0 && rect.intersects(window.bounds) ? [web] : []
            }
            return view.subviews.flatMap(find)
        }
        return find(window)
    }

    private func capture() {
        sequence += 1
        let request = sequence
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }.flatMap(\.windows)
        guard let window = windows.first(where: \.isKeyWindow) else { return }
        let views = visibleWebViews(in: window)
        guard views.count == 1, let web = views.first else {
            publish(["sequence": request, "error": "Exactly one visible SDK WebView is required"], in: window)
            return
        }
        Task { @MainActor [weak self, weak web, weak window] in
            guard let self, let web, let window else { return }
            do {
                let result = try await web.evaluateJavaScript(PlayerLabRuntimeUiScript.program)
                guard request == self.sequence, web.window === window, window.isKeyWindow,
                      self.visibleWebViews(in: window).count == 1, self.visibleWebViews(in: window).first === web,
                      let dom = result as? [String: Any] else { return }
                let frame = web.convert(web.bounds, to: window)
                self.publish(["sequence": request, "viewIdentity": String(describing: ObjectIdentifier(web)),
                    "frame": [frame.minX, frame.minY, frame.width, frame.height], "dom": dom], in: window)
            } catch {
                guard request == self.sequence else { return }
                self.publish(["sequence": request, "error": "Read-only SDK DOM observation failed"], in: window)
            }
        }
    }

    private func publish(_ value: [String: Any], in window: UIWindow) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), data.count < 65536,
              let text = String(data: data, encoding: .utf8) else { return }
        let view: UIView
        if let current = observation, current.window === window { view = current }
        else {
            view = UIView(frame: CGRect(x: window.safeAreaInsets.left, y: window.safeAreaInsets.top, width: 1, height: 1))
            view.backgroundColor = .clear
            view.isUserInteractionEnabled = false
            view.isAccessibilityElement = true
            view.accessibilityIdentifier = "player-lab-native-ui-observation"
            view.accessibilityLabel = "Read-only embedded SDK UI observation"
            window.addSubview(view)
            observation = view
        }
        // This changes only a dedicated observation value; layout and SDK UI stay untouched.
        view.accessibilityValue = text
    }
}
#endif
