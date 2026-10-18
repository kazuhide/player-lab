import SwiftUI

@main
struct ShowcaseApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// The Bitmovin Player license key, read from the app's Info.plist
/// (`BitmovinLicenseKey`, populated from the `BITMOVIN_PLAYER_LICENSE_KEY` build
/// setting — repo-root .env → scripts/sync-env.sh → Local.xcconfig).
/// Allow-list this app's bundle ID on the license.
func bitmovinLicenseKey() -> String {
    (Bundle.main.object(forInfoDictionaryKey: "BitmovinLicenseKey") as? String) ?? ""
}

/// The Bitmovin Analytics license key (same flow, `BITMOVIN_ANALYTICS_LICENSE_KEY`).
/// Empty = the analytics collector stays disabled.
func bitmovinAnalyticsLicenseKey() -> String {
    (Bundle.main.object(forInfoDictionaryKey: "BitmovinAnalyticsLicenseKey") as? String) ?? ""
}
