# Bitmovin Player sample for iOS and tvOS

SwiftUI sample using the Bitmovin Player library. iPhone and iPad can use the
shared Web UI from `@showcase/ui-shared`; tvOS uses the native System UI because
the Web UI is unavailable there. DVR means the window of live media that a viewer
can rewind.

The Apple sample offers HLS sources. The pinned native library accepts HLS and
progressive MP4; loading a DASH source violates its precondition and terminates
the app. DASH remains available in the Web and Android samples. See the
[official Apple sample formats](https://github.com/bitmovin/bitmovin-player-ios-samples#available-sample-apps).

## Layout

- `DvrKit/`: Swift package containing the rewind-window calculations and tests.
- `Showcase/`: player and control panel, shared by the iOS and tvOS targets.
- `project.yml`: XcodeGen configuration and Swift Package Manager dependencies.

## Test the rewind logic

This needs a Swift toolchain, but not the player library or a running simulator.
From the repository root:

```bash
cd apps/ios/DvrKit && swift test
```

## Build the app

The app needs Xcode. Its player dependency is a binary XCFramework, so the app
cannot be built with `swift build`. Dependency requirements and deployment
targets are declared in `project.yml`. Use [XcodeGen 2.46.0](https://github.com/yonaskolb/XcodeGen/releases/tag/2.46.0).
The app pins Player 3.128.0; `Package.resolved` also records its transitive
package revisions.

Set your keys in the repository-root `.env` as described in `docs/SETUP.md`.
The generated targets use `com.showcase.dvr.Showcase-iOS` and
`com.showcase.dvr.Showcase-tvOS`. Allow the identifier of the target you run on
your Player license; if you change it in Xcode, allow the changed identifier.
See the [official bundle identifier setup](https://github.com/bitmovin/bitmovin-player-ios-samples#add-the-bundle-identifier-as-an-allowed-domain).
From the repository root:

```bash
xcodegen version              # must be 2.46.0; install the linked release if needed
bash scripts/sync-env.sh
pnpm --filter @showcase/ui-shared build && pnpm sync:webui
cd apps/ios
xcodegen generate
mkdir -p Showcase.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
cp Package.resolved Showcase.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
open Showcase.xcodeproj
```

Build and sync the Web UI before generating the project, so `WebUI/` is included
in the iOS target's resources. Select `Showcase-iOS` or `Showcase-tvOS` to run.
For an unsigned iOS simulator build, from `apps/ios`:

```bash
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS \
  -destination 'generic/platform=iOS Simulator' \
  -onlyUsePackageVersionsFromResolvedFile \
  CODE_SIGNING_ALLOWED=NO build
```

`sync-env.sh` generates the untracked `Local.xcconfig` from
`BITMOVIN_PLAYER_LICENSE_KEY` and optional `BITMOVIN_ANALYTICS_LICENSE_KEY`.
Run it before `xcodegen generate`. The project references this file even for
compilation; an empty file is enough for the compile-only check below. Playback
needs a valid player license. If the analytics key is supplied, the
bundled collector reports playback-quality measurements to your account.
Do not commit the generated key file.

`Showcase/Info.plist` maps the license build settings to the entries read at
startup; it stores references, never credential values. The previously generated
plist omitted these custom entries, so configured builds started with an empty
key. Both app targets now use the explicit plist. CI rejects missing or unresolved
entries while allowing empty values for compilation without credentials.

## Shared player UI

On iOS, the "Player UI" picker selects the default Web UI or Sports, Live, and
Cinema factories. tvOS keeps its native System UI.

Custom modes point `config.styleConfig.playerUiJs` and `playerUiCss` at bundled
`WebUI/bitmovinplayer-ui.*` files. They set
`config.styleConfig.userInterfaceConfig = BitmovinUserInterfaceConfig()` and a
factory such as `uiManagerFactoryFunction = "bitmovin.playerui.UIFactory.buildSportsUI"`.
This configuration is applied when the player is created, so switching modes
recreates the player and its SwiftUI view.

`pnpm --filter @showcase/ui-shared build && pnpm sync:webui` generates the ignored
Web UI resources. The shared UI uses `bitmovin-player-ui` 4.x. Compilation alone
does not establish that this UI renders correctly in the native player library's
WebView; check that combination on your target device or simulator.

## Playback checks

A successful build or `DvrKit` test does not verify licensed playback. With your
license and a running live source, check seeking within the window, returning to
live, recovery when paused media expires, and a live stream becoming on-demand.
The app also checks for the latter transition from `TimeChanged` snapshots,
because relying only on `DurationChanged` can miss it.

The opt-in `Showcase-iOS-Runtime` scheme runs a hosted test against the real
library and shared Web UI. After the setup/build steps above, select an available
iOS simulator in Xcode or run this command from `apps/ios`, replacing the simulator
name with one installed on your machine:

```sh
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS-Runtime \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.4' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

The test checks finite on-demand playback, the bundled Sports UI's rendered
elements and stylesheet, playback started through that UI, switching to live HLS
and back, seeking behind live, returning to live, disabling/enabling DVR, and
recreating the player with the Cinema UI. It retains a screenshot in the Xcode
test result. It uses public reference streams and needs a valid license allowing
`com.showcase.dvr.Showcase-iOS`. Leave the optional Analytics key empty when no
collection is intended. A library error or unavailable stream fails the test;
there is no mock fallback or success-on-skip behavior.

Live HLS can expose its rewind window only after playback starts. The runtime
test waits for the new source to load, starts playback, then checks the window;
waiting for a window while the source is paused can time out.

A native seek and its WebView display update complete asynchronously. For both
rewinding and returning to live, the test waits for
[`TimeShiftedEvent`](https://cdn.bitmovin.com/player/ios/3/documentation/bitmovinplayercore/playerlistener/index.html),
which signals completed live seeking, then checks the SDK offset and the visible
behind-live label and LIVE button. An offset check alone does not establish that
the on-screen controls have caught up.

On 2026-10-19, this runtime test passed on an iPhone 17 Pro simulator running
iOS 26.4 with Player 3.128.0 and `bitmovin-player-ui` 4.15.1 including the
repository's cleanup patch: one test, zero failures, 12.161 seconds. The shared
Sports UI was also inspected in the retained image. This is simulator evidence;
physical-device, tvOS, remote-control, casting, and offline playback checks remain
separate.

## Build without credentials

The Xcode project references the ignored `Local.xcconfig`. For compilation only,
create an empty file before generating the project:

```sh
touch apps/ios/Local.xcconfig
```

Run this from the repository root. CI creates the same empty file. It does not
provide a Player license or establish native playback. For a device run, use
`sync-env.sh` with your own credentials as described above.

CI builds and syncs the shared UI before generating the project. It also checks
that the resulting iOS app contains the exact generated JavaScript and CSS.
This packaging check does not establish licensed playback on a device.
