# Bitmovin Player sample for iOS and tvOS

SwiftUI sample using the Bitmovin Player library. iPhone and iPad can use the
shared Web UI from `@showcase/ui-shared`; tvOS uses the native System UI because
the Web UI is unavailable there. DVR means the window of live media that a viewer
can rewind.

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
targets are declared in `project.yml`.

Set your keys in the repository-root `.env` as described in `docs/SETUP.md`.
The player license must allow the app's bundle ID. From the repository root:

```bash
brew install xcodegen          # if not installed
bash scripts/sync-env.sh
pnpm --filter @showcase/ui-shared build && pnpm sync:webui
cd apps/ios
xcodegen generate
open Showcase.xcodeproj
```

Build and sync the Web UI before generating the project, so `WebUI/` is included
in the iOS target's resources. Select `Showcase-iOS` or `Showcase-tvOS` to run.
For an unsigned iOS simulator build, from `apps/ios`:

```bash
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

`sync-env.sh` generates the untracked `Local.xcconfig` from
`BITMOVIN_PLAYER_LICENSE_KEY` and optional `BITMOVIN_ANALYTICS_LICENSE_KEY`.
Run it before `xcodegen generate`. The project references this file even for
compilation; an empty file is enough for the compile-only check below. Playback
needs a valid player license. If the analytics key is supplied, the
bundled collector reports playback-quality measurements to your account.
Do not commit the generated key file.

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

## Build without credentials

The Xcode project references the ignored `Local.xcconfig`. For compilation only,
create an empty file before generating the project:

```sh
touch apps/ios/Local.xcconfig
```

Run this from the repository root. CI creates the same empty file. It does not
provide a Player license or establish native playback. For a device run, use
`sync-env.sh` with your own credentials as described above.
