#if !os(tvOS)
import UIKit
import BitmovinPlayer

final class OfflineBackgroundDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        OfflineStartup.restore()
        NativeCastStartup.restore()
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        OfflineStartup.restore()
        guard OfflineManager.isOfflineManagerInitialized else { completionHandler(); return }
        // Forward the system-supplied completion and identifier; do not synthesize session identifiers.
        OfflineManager.sharedInstance().add(completionHandler: completionHandler, for: identifier)
    }
}
#endif
