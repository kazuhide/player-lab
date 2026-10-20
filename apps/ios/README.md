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

The tvOS player is inline beside the app controls. Use the remote's **Play/Pause**
button to start or pause the current player; the app handles this command even
while a source or configuration button has focus. AVKit's transport controls need
full-screen video, as shown in the
[official tvOS sample](https://github.com/bitmovin/bitmovin-player-ios-samples/blob/main/BasicPlaybackTV/BasicPlaybackTV/ContentView.swift).
The command uses SwiftUI's
[`onPlayPauseCommand`](https://developer.apple.com/documentation/swiftui/view/onplaypausecommand(perform:)).

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

Some completed HLS streams keep the native `isLive == true` and infinite duration
after [`PlaybackFinished`](https://cdn.bitmovin.com/player/ios/3/documentation/bitmovinplayercore/playerlistener/onplaybackfinished(_:player:)).
The app shows `ended-live` and disables its live-seek commands for that loaded
source. The shared Live and Sports UIs hide LIVE controls and show the SDK's
Replay overlay. Replay can advance the same source again without restoring live
commands; a new source load clears the completion state. Native SDK timing
values remain unchanged.

For finite VOD seeking after this completion, open **Configure source and
playback**, keep the URL and player settings, change only the title, and choose
**Apply** when the pending action says **Reload source**. This explicitly loads
the finalized HLS manifest into a new Source on the same Player. It resets the
playback position; it is not an automatic reload. `seek(time:)` is a VOD API and
has no effect while the SDK still classifies the retained source as live.

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

### Controlled HLS ending

The `Showcase-iOS-Finalization` and `Showcase-tvOS-Finalization` schemes use real
SDK playback and a local 60-second media fixture. Generate the public media as
described in [local test media](../../docs/local-test-media.md), then start this
loopback-only server from the repository root with Node 24.19.0:

```sh
python3 encoding/test-streams/local.py --output .cache/apple-runtime-media
node apps/ios/runtime-fixture.mjs .cache/apple-runtime-media/vod-baseline
```

Keep the server running and run one scheme at a time from `apps/ios`:

```sh
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS-Finalization \
  -destination 'platform=iOS Simulator,name=<IOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild -project Showcase.xcodeproj -scheme Showcase-tvOS-Finalization \
  -destination 'platform=tvOS Simulator,name=<TVOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

These hosted tests need the app's allowed Player license. They play actual media,
check fresh native rewind completion against the requested media time, then add
HLS `ENDLIST` without replacing the source. They require native playback
completion, advancing replay on the same player/source, and disabled app live commands
during replay. They then change only the title through the existing Apply path,
require the same Player and exact URL with a new finite VOD Source, and check a
fresh `Seeked` at 30 seconds followed by advancing `TimeChanged` positions.
Reset on a new live load and an explicit VOD source switch are also checked. The
iOS test also clicks the visible shared Web UI Replay button and checks its LIVE
controls' own hidden state and rendered visibility. Its Sports UI shows the
completed VOD seek at the middle of the seek bar and hides the live-only clock.
Sports has a `WallClockLabel` and seek bar, rather than a VOD elapsed-time label;
the test compares the marker with native relative time instead of expecting
`00:30` text. The custom clock class needs its own `.bmpui-hidden` rule so the
SDK's hide operation also hides it outside live playback.
tvOS uses native System UI; the hosted test starts, replays and seeks
through the public SDK API with visible video and does not establish
remote-command or GUI Apply behavior. The server uses ports 5198 and 5199 and
is intended for simulators on the same Mac. Stop it with Ctrl-C after testing.

On 2026-10-21, the controlled ending test passed on iOS 26.4 and tvOS 26.4
simulators with Player 3.128.0: one test each, in 20.875 and 21.362 seconds.
Separate checks used the normal app's actual configuration controls and native
read-only observations. They verified Reset, source-only Apply on the same
player, recreation Apply destroying the old player, retained source options and
app DVR selection, and advancing video. iOS also retained these settings when
switching to the bundled Sports UI; tvOS used the remote Play/Pause command.
These checks used the public 734-second Tears of Steel VOD preset, separate from
the 60-second ending fixture. They do not measure bitrate enforcement, buffering
performance, or physical-device behavior.

The extended ending checks passed later that day on iPad / iOS 26.4 in
65.726 seconds and Apple TV / tvOS 26.4 in 65.579 seconds, one test each with
zero failures. The completed Source retained live/infinite getters and did not
complete a VOD seek. Title-only Apply then loaded a new finite 60-second Source
on the same Player and URL. Both completed a fresh seek at 30 seconds and
advanced through native TimeChanged events. The iPad showed the middle seek
marker with its live clock hidden; the TV display reached 00:31 / remaining
00:29. These are hosted SDK checks, separate from GUI Apply and remote seeking.

### Local HLS and progressive MP4 configuration playback

On 2026-10-21, the normal app's configuration GUI also played the generated
60-second Big Buck Bunny HLS and progressive MP4 on iPhone, iPad and Apple TV
simulators with Player 3.128.0. The MP4 checks entered the source URL, progressive
type, title, five-second start offset, autoplay, 2,500,000 bit/s maximum bitrate
and eight-second forward buffer through the actual editor. Native read-only
observations confirmed the applied values, a new Player, destruction of the old
Player, advancing positions and visible video.

| MP4 destination | Result | Case duration | Native playback samples |
| --- | --- | --- | --- |
| iPhone 17 Pro / iOS 26.4 | 1 passed, 0 failed | 47.026 s | 6.113 → 10.513 s |
| iPad Pro 11-inch (M5) / iOS 26.4 | 1 passed, 0 failed | 52.502 s | 6.118 → 10.518 s |
| Apple TV 4K (3rd generation) / tvOS 26.4 | 1 passed, 0 failed | 104.280 s | 6.017 → 10.418 s |

The remuxed MP4 reports a container duration of 60.021333 seconds. Its video has
a 60-second span starting at 0.021322 seconds; audio starts at zero and spans
60.021333 seconds. The input HLS audio starts at -0.021333 seconds while video
starts at zero. The remux shifts the file origin while retaining that track
offset, consistent with FFmpeg's [timestamp-shift handling](https://ffmpeg.org/ffmpeg-formats.html#Format-Options).
The nearly identical output track endpoints show that this is not audio trailing
21 milliseconds beyond the video. Compare track starts and endpoints as well
as container duration; the [AAC frame and presentation-time notes](../../docs/local-test-media.md)
explain why rounding every track to an exact frame boundary can mislead.
The bitrate and buffer observations establish configuration delivery, not
bandwidth enforcement or buffering performance.

To create an equivalent MP4 without re-encoding, use a separate output directory
after generating the local media. Run from the repository root:

```sh
mkdir -p .cache/apple-mp4
ffmpeg -v error -n -i .cache/apple-runtime-media/vod-baseline/master.m3u8 \
  -map 0:v:0 -map 0:a:0 -c copy -movflags +faststart \
  .cache/apple-mp4/vod-60s.mp4
```

The remux command was checked separately on 2026-10-21. Serve the MP4 using an
HTTP server with byte-range support, enter that reachable URL in Configuration,
select Progressive MP4, and apply the settings above. The HLS ending server
serves its playlist fixture; it is not the MP4 server. Keep this test input local
and use the app's normally allowed Player license.

### SDK Default UI controls

On 2026-10-21, two real-app GUI cases passed on an iPhone 17 Pro / iOS 26.4
simulator with Player 3.128.0, in 55.381 and 48.599 seconds. They used the
generated 60-second multi-audio HLS, actual touch input, read-only native
getters/listeners and visible video. The SDK bridge and stock UI resource bytes
matched the installed app. The [recorded API results](../../docs/api-coverage/apple/stock-ui-qualification.json)
include values and public resource references.

| API | Actual control and native result | Coverage |
| --- | --- | --- |
| `Player.pause()` | Pause held the native position at 10.095 seconds across three samples. | Direct |
| `Player.play()` | Play advanced the same native player from 10.583 to 14.982 seconds. | Direct |
| `Player.seek(time:)` | Dragging the visible timeline completed a fresh native `Seeked` at 30 seconds. | Direct |
| `Player.setAudio(trackIdentifier:)` | Selecting German test track changed the native selection from track 0 to track 1. | Direct |
| `Player.playbackSpeed` | Selecting 2x set the native speed to 2. | Preset |
| `Player.volume` | Speaker touch changed mute; volume stayed at 100 and no touch volume slider was offered. | Missing |
| `UserInterfaceApi.enterFullscreen()` / `exitFullscreen()` | The host has no fullscreen handler or visible fullscreen control. | Missing, two API rows |

The audio menu dynamically lists all `Player.availableAudio` IDs, covering the
public valid argument domain. Its two fixture labels are test metadata, not
translations of the soundtrack. Speed offers only 0.25x, 0.5x, normal, 1.5x and
2x; the GUI does not accept other SDK speed values. The missing controls remain
available SDK APIs in the denominator. No candidate is left unverified in this
eight-item audit; the recorded touch results apply to this iPhone simulator host.

To repeat the GUI workflow, select **Default**, configure the generated
`vod-multiaudio/master.m3u8` URL and autoplay, then Apply. Reveal the video
controls, Pause, Play, pause again, and drag **Video timeline** to the middle.
Open **Settings → Speed**, scroll to **2x** and select it. Scroll back and choose
**Back**, then **Audio Track → German test track**. Scroll within the menu when
an option is below its visible viewport. Hardware volume changes and hidden
markup do not demonstrate an app API route.

### Updated shared UI on iPad

On 2026-10-21, the updated UI 4.23.0 ownership patch passed an additional normal-app
GUI case on an iPad / iOS 26.4 simulator with Player 3.128.0: one passed, zero
failed or skipped, 116.240 seconds. The installed JavaScript/CSS matched the
generated resources after execution. The case applied 60-second HLS settings,
switched to Sports, loaded progressive MP4 and changed its title through Apply.
The title-only MP4 change kept the same Player and created a new Source, with
offset 5 seconds, autoplay, mute, maximum bitrate 2,500,000 bit/s and forward
buffer 8 seconds retained. Sports and the disabled app DVR switch also remained
selected. Native MP4 positions advanced from 6.778 to 11.178 seconds with visible
video. This is playback/configuration evidence; Web heap measurements are
documented separately in [Web performance](../../docs/web-performance.md).

Additional source-only MP4 checks passed on iPhone in 81.745 seconds and Apple TV
in 109.539 seconds. Both changed **Start muted** from on to off through the GUI,
then applied a title-only edit. Native observations confirmed the same Player,
a new Source, a fresh `SourceLoaded` count from 1 to 2, retained startup settings,
UI mode and app DVR selection, and advancing video. Together with the iPad case,
these cover source-only MP4 reload and mute delivery on all three simulators.

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
The iOS job runs the hostless configuration scheme on an available iPhone
simulator without a Player license. The workflow keeps its generic tvOS simulator
build; the tvOS unit and remote GUI results above are separate recorded checks.
This packaging check does not establish licensed playback on a device.

## Applied configuration code

In **Configuration**, open **Show applied code** to read the applied Player,
Source and UI settings. Draft edits are excluded. iOS provides **Copy code** and
text selection; tvOS displays the code without clipboard integration. The Player
key is a placeholder, and Analytics license values are not included.
