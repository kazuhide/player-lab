# Bitmovin Player sample for iOS and tvOS

SwiftUI sample using the Bitmovin Player library. iPhone and iPad can use the
shared Web UI from `@showcase/ui-shared`; tvOS uses the native System UI because
the Web UI is unavailable there. DVR means the window of live media that a viewer
can rewind.

The Apple sample offers HLS presets and a configuration editor for custom HLS
and progressive MP4 sources. The pinned native library accepts these formats;
loading a DASH source violates its precondition and terminates
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

## Configure a source and playback

Choose **Configure source and playback** below the source presets. iPhone and
iPad show a sheet; tvOS opens a full-screen native form with focusable fields,
inline choices, and the system text keyboard. Edit the draft, check the pending
action, then choose **Apply**. Invalid fields show an explanation and disable
Apply. **Reset to applied** restores the current applied values in the draft;
**Cancel** discards the draft. Neither action reloads or changes the player.
Applied settings last for the current app session.

| Field | Accepted value and behavior |
| --- | --- |
| Source URL | Absolute HTTP or HTTPS URL; HLS or progressive MP4 only. |
| Source type | HLS or Progressive MP4. DASH and offline packages are not offered. |
| Title, Poster URL | Optional title and optional absolute HTTP(S) poster URL. Empty values clear them. |
| Start offset | Optional finite seconds, including negative values. Empty uses the SDK default. |
| Offset reference | Automatic, Start, or End. Automatic uses the beginning for VOD and the live edge for live. The SDK corrects offsets to stream boundaries. A VOD offset applies on load; a live offset applies when playback starts. |
| Autoplay after source load | Starts the source automatically after Apply or source selection when enabled. Default: off. |
| Start muted | Initial mute setting when the player is created. Default: on. |
| SDK time shift / DVR | Enables live DVR in the SDK. Default: on. The separate **Allow DVR controls (app)** switch also governs the app's quick-seek buttons. |
| Maximum bitrate | Nonnegative whole bit/s; `0` means unlimited. |
| Forward buffer | Nonnegative finite seconds; `0` lets the SDK choose. |

Source fields and start position changes reload the source on the existing
player. Playback, bitrate, or buffer changes recreate the player and its native
view, then reload the full current source, including title, poster, and offset
options. The selected iOS UI mode, app DVR switch, and event log remain in place.
The pending action says which operation will run. Apply does not preserve the
current playback position or playing state; playback starts from the configured
offset or the SDK default, according to Autoplay.

Selecting a source preset replaces the source URL, type, title, poster, and
offset options with that preset's values. Player settings, UI mode, and the app
DVR switch remain active. Changing the iOS UI mode also keeps the complete
current source configuration while recreating the player.

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

The live edge advances while a seek buffers. The rewind check captures the
requested media position and checks the position recorded at seek completion
within the same three-second tolerance. A finite negative offset and the
behind-live controls then confirm that playback remains behind the moving edge.

Shared controls also need time to finish layout, and automatic hiding can make
an ancestor transparent while its controls keep nonzero bounds. The test waits
for positive width and height and checks display, visibility, and opacity through
the ancestor chain. When controls are hidden, ordinary mouse movement on the
rendered UI requests their display before the same state checks run again.

On 2026-10-19, this runtime test passed on an iPhone 17 Pro simulator running
iOS 26.4 with Player 3.128.0 and `bitmovin-player-ui` 4.15.1 including the
repository's cleanup patch: one test, zero failures, 11.670 seconds. The shared
Sports UI was also inspected in the retained image. This is simulator evidence;
physical-device, tvOS, remote-control, casting, and offline playback checks remain
separate.

## Configuration tests

After generating the project and restoring `Package.resolved`, the hostless
configuration schemes run without a Player license or shared Web UI resources.
They compile the exact app model/configuration sources and use an explicitly
invalid synthetic key only to construct the SDK player. They check validation,
SDK configuration mapping, no-op and rejected Apply, source reload, and player
recreation retaining source options, UI selection, and the app DVR switch. They
do not establish playback or network behavior. Run from `apps/ios`, replacing
the simulator names with installed destinations:

```sh
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS-Configuration \
  -destination 'platform=iOS Simulator,name=<IOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild -project Showcase.xcodeproj -scheme Showcase-tvOS-Configuration \
  -destination 'platform=tvOS Simulator,name=<TVOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

The opt-in GUI schemes launch the real app and therefore require its normal
allowed Player license. An empty key is an SDK startup precondition failure.
They also use the public reference source and require network access. Keep
Analytics empty when collection is not intended. These tests retain screenshots
in the Xcode result bundle:

```sh
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS-ConfigurationUI \
  -destination 'platform=iOS Simulator,name=<IOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild -project Showcase.xcodeproj -scheme Showcase-tvOS-ConfigurationUI \
  -destination 'platform=tvOS Simulator,name=<TVOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

The iOS GUI check edits invalid input, resets the draft, applies source metadata,
and applies startup mute/bitrate/buffer settings while retaining the source. The
tvOS check uses remote focus and Select to change a source type and autoplay,
then restores the draft with Reset. These configuration checks use the SDK
default UI and do not qualify the shared Web UI, advancing playback, stream
offset accuracy, bitrate enforcement, physical devices, casting, offline
playback, or Analytics receipt. The separate `Showcase-iOS-Runtime` scheme above
checks the shared UI and playback behavior.

On 2026-10-20, the configuration schemes passed six tests each on iOS and tvOS
simulators. The GUI scheme passed one test each on iPhone 17 Pro / iOS 26.4,
iPad Pro 11-inch (M5) / iOS 26.4, and Apple TV 4K (3rd generation) / tvOS 26.4.
The retained iPhone and TV editor images were inspected. This verifies the
configuration workflows described above, using the SDK default UI; it adds no
physical-device or playback qualification to the separate October 19 record.

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
