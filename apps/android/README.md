# Bitmovin Player sample for Android and Fire TV

Kotlin sample using the Bitmovin Player library, with a Compose control panel and
`PlayerView`. The app targets phones, tablets, Android TV, and Android-based Fire
TV devices. DVR means the window of live media that a viewer can rewind.

The app pins Bitmovin Player Android **3.171.0**, released on 2026-10-16
([official release notes](https://developer.bitmovin.com/playback/docs/release-notes-android)).
Android TV and Fire TV use the same Android SDK dependency.

## Layout

- `dvr/`: Kotlin module with rewind-window calculations and tests for the Java
  Virtual Machine; these tests do not need the Android SDK.
- `app/`: Android player and controls. Shared Web UI assets are loaded through
  `UiConfig.WebUi` from `file:///android_asset/`.

## Test the rewind logic

From the repository root, with a Java development kit installed:

```bash
cd apps/android && ./gradlew :dvr:test
```

## Build the app

Use Java 17 and an Android SDK matching the requirements in `app/build.gradle.kts`.
The build uses Gradle 9.3.1, Android Gradle plugin 9.1.1 with built-in Kotlin,
Kotlin/Compose plugins 2.4.20, and Android SDK Platform 37.0. These plugin versions
fit the [Kotlin Gradle compatibility table](https://kotlinlang.org/docs/gradle-configure-project.html).
The Player's OkHttp dependency requires
`compileSdk` 37; `targetSdk` remains 36 and `minSdk` remains 23. AGP 9.1.1 is
the [minimum officially supported AGP for API 37](https://developer.android.com/build/releases/about-agp).
`settings.gradle.kts` includes the app module when `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, or `local.properties` supplies an SDK context. Player
artifacts are resolved from `artifacts.bitmovin.com`.

Set your keys in the repository-root `.env` as described in `docs/SETUP.md`.
From the repository root:

```bash
bash scripts/sync-env.sh
pnpm --filter @showcase/ui-shared build && pnpm sync:webui
cd apps/android && ./gradlew :app:assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

You can also open `apps/android` in Android Studio. The Gradle properties
`-PbitmovinLicenseKey=…` and `-PbitmovinAnalyticsLicenseKey=…` take precedence over
`bitmovinLicenseKey` and `bitmovinAnalyticsLicenseKey` in the untracked
`local.properties`. The sync script updates those entries from `.env` while
preserving the local SDK path.

Allow `com.showcase.dvr` on your player license. The analytics key is optional;
when provided, the bundled collector reports playback-quality measurements to
your account. Do not commit keys or local SDK configuration.

## Shared player UI

The "UI" picker selects the default Web UI or the Sports, Live, and Cinema
factories from `@showcase/ui-shared`. A custom mode creates a configuration such as:

```kotlin
PlayerViewConfig(uiConfig = UiConfig.WebUi(
    jsLocation = "file:///android_asset/bitmovinplayer-ui.js",
    cssLocation = "file:///android_asset/bitmovinplayer-ui.css",
    variant = Variant.Custom("bitmovin.playerui.UIFactory.buildSportsUI")
))
```

The app recreates `PlayerView` when the mode changes. The build-and-sync command
above writes the ignored assets under `app/src/main/assets/`.

The shared UI uses `bitmovin-player-ui` 4.x. A successful Android build does not
establish that it renders correctly in the native player library's WebView;
check rendering and input on each target.

The control rows scroll horizontally on narrow displays, so all existing source,
UI, and seek buttons remain reachable. The full panel scrolls vertically, including
the collapsible **Configuration** editor. Its buttons, fields, and switches support
directional focus; focused configuration switches show an outline.

## Configuration editor

Configuration changes remain drafts until Apply. **Apply source (reload)** builds
a fresh source configuration and reloads the existing player. It exposes a custom
HTTP/HTTPS stream URL, DASH/HLS/Smooth/Progressive type, optional title and poster
URL, persistent poster, start offset in seconds, and Start/End/SDK-default offset
reference. HTTP requests still depend on the device's cleartext network policy.
The SDK-default reference is the start for VOD and the end for live streams;
out-of-window offsets are corrected by the SDK. A blank offset uses the SDK
default. **Reset source draft** returns to the currently applied source without
reloading. Selecting any catalog source, including the same preset again, replaces
the source draft and clears custom metadata and offsets.

**Apply & restart player** creates a new player and reloads the currently applied
source, retaining its metadata/options, selected UI mode, Allow DVR setting, and
event log. Playback restarts according to autoplay and the source start offset.
Used SDK configuration objects are never mutated. PlayerViews detach before the
previous player is destroyed, and retired player/source callbacks cannot update
the active controller. Invalid drafts leave the active player and source intact.

| Player field | Unit / default |
| --- | --- |
| Autoplay / Start muted | Off / off |
| Enable SDK live time shifting | On; separate from the app's Allow DVR switch |
| Startup / restart threshold | Seconds; 2.5 / 5; nonnegative, at most forward buffer minus 0.5 |
| Forward buffer | Seconds; 50; at least 0.5 to leave threshold headroom |
| Maximum automatic video bitrate | Whole bits per second; blank uses `Int.MAX_VALUE` (2147483647, no ABR cap); higher qualities remain available for manual selection |
| Preload content / Allow rebuffering | On / on |
| Live quality / stability balance | 0 through 1; 0.5; relevant near the live edge only |

**Reset player draft** restores these SDK defaults without applying them. All
numeric fields reject non-finite values; bitrate uses the SDK's nonnegative `Int`
range. The field definitions and defaults follow the pinned
[PlaybackConfig](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-playback-config/index.html),
[BufferConfig](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.buffer/-buffer-config/index.html),
[AdaptationConfig](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.media/-adaptation-config/index.html), and
[SourceOptions](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source-options/index.html)
references. Keys continue to come from build configuration.

The draft validation and mapping tests run with `:app:testDebugUnitTest`.
`PlayerConfigurationInstrumentedTest` drives the real Compose editor and SDK with
a dummy license to verify application, reset, source retention, player/view
ownership, and D-pad focus without asserting successful media playback.
`PlayerOwnershipInstrumentedTest` independently records API calls to check
exactly-once destruction, listener removal, and retired callback rejection:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.showcase.app.PlayerConfigurationInstrumentedTest,com.showcase.app.PlayerOwnershipInstrumentedTest \
  -PbitmovinLicenseKey=dummy -PbitmovinAnalyticsLicenseKey=
```

## Playback checks

Unit tests and APK builds do not verify licensed playback. On a device or
emulator, check live seeking, returning to live, and recovery when paused media
expires. Android TV and Fire TV also need remote-control checks; the app declares
a `LEANBACK_LAUNCHER` entry for TV launchers. Use your own license and reachable
test streams.

With an emulator or device connected, run the real playback tests from
`apps/android`:

```sh
./gradlew :app:connectedDebugAndroidTest
```

`PlayerDvrInstrumentedTest` checks the real library's source loading and finite
on-demand duration. `PlayerControlsInstrumentedTest` uses the app's actual Compose
buttons and switch, checks the bundled Sports UI's elements and stylesheet in its
WebView, starts playback through that UI, then checks source switching, live
rewind, return to live, and the DVR setting. Both tests need network access and a
valid license allowing `com.showcase.dvr`; neither substitutes a mock player.
Player and Source failures report numeric error codes without printing their
messages or license values. A failed license request is a failed playback check,
even when compilation and packaging pass. Leave the optional Analytics key empty
when no collection is intended.

`PlayerConfigurationPlaybackInstrumentedTest` requires the authorized license
and checks the new editor's actual playback effect: a custom VOD source starts
muted at the applied 10-second offset and advances automatically after applying
player settings. The configuration-only tests do not establish media playback or
completion of all SDK resource cleanup; `Player.isDestroyed` reports API
invalidation, and the recording test counts the app's destroy calls.

`PlayerUiHandoffInstrumentedTest` keeps the same player playing VOD while cycling
through Sports, Live (DVR), Cinema and Default three times. It checks that each
retired view detaches, one active view intersects the viewport, and playback time
advances after every handoff. This also requires an authorized license.

The shared UI can exist before its playback control becomes visible. The test
waits for that control, then checks that native playback time advances. It reveals
controls through WebView pointer input and checks element dimensions and the
computed display, visibility and opacity of each ancestor. Hidden controls with
nonzero dimensions do not establish a visible result.

Live offsets use a moving reference: the live edge can advance while a rewind
buffers. The test fixes a media reference from the SDK-reported position and
offset just before seeking, then checks that the next `TimeShifted` event lands
within three seconds of the resulting target. It also requires a negative live
offset and the visible behind-live state. The return-to-live check requires a new
completion event, an SDK-reported offset within one second of zero, and visible
`LIVE` text and button state.

If that check fails, its report includes monotonic request/completion times,
the requested media target, completion position and offset, native-ready poll
count, and the live controls' text, classes, dimensions and hidden ancestors.
It does not include SDK error messages or configuration dumps.

The app's event log also retains startup error codes, so a failed initial request
can be distinguished from a source that is still loading.

On 2026-10-20, Player 3.171.0 passed the six DVR JVM tests, six configuration JVM
tests, and debug app/instrumentation builds. An Android 16 phone emulator passed
all four configuration/ownership checks with a dummy license in 41.737 seconds.
Touch swipes reached both Apply sections; D-pad Down/Center moved focus and
changed a draft switch after entering remote input mode.

An earlier configured VOD playback case passed with an authorized license in
18.342 seconds. An earlier grouped authorized-license run passed six of seven
checks in 71.104 seconds, including configured VOD playback and the existing
VOD-duration check. The existing shared-UI/DVR controls check reported non-network timeout
1004 in the grouped run. In separate comparisons, both base `2c90983` and the
changed app failed the return-to-live assertion with the same SDK, shared UI
bundle, and emulator. This does not qualify that shared-UI/live-edge path for
3.171.0. No error or timing threshold was relaxed. Physical devices, Android TV,
Fire TV, and completed SDK resource cleanup remain outside these checks.

A further 2026-10-20 comparison used the same 3.171.0 SDK, shared UI bundle and
Android 16 emulator for base `2c90983` and main `09e0a37`. Both failed the unchanged
current-edge/visible-`LIVE` check with no Player or Source errors. The SDK reached
the requested media target, but the live edge advanced between request and completion:

| App revision | Return completion latency | Completion minus requested target | Offset at completion |
| --- | --- | --- | --- |
| `2c90983` | 6.598 s | +0.057 s | -6.573 s |
| `09e0a37` | 4.439 s | +0.367 s | -4.116 s |

The shared UI's behind-live text and button class agreed with that SDK offset.
Reaching the requested timestamp does not establish arrival within one second
of the subsequently moving edge. Alternating diagnostic runs with restart
thresholds of 0.1 and 5 seconds each passed twice and failed once, so changing that threshold alone
did not remove the failure. Production defaults and acceptance conditions were
kept. These observations do not establish stable live-return behavior.

The original seven-check grouped run subsequently passed in 102.038 seconds,
and the separate 12-handoff playback check passed in 49.268 seconds. Neither
reproduced timeout 1004. That earlier timeout remains a separate, unresolved
observation; it has not been attributed to the moving-edge failure.

The final eight-check grouped run passed seven checks in 97.328 seconds,
including the strict live-return and viewport-aware UI-handoff checks. The
unchanged configured-VOD check failed its first-observed-position assertion
(`9.0..13.0` seconds for the configured 10-second start offset). That report did
not record the sampled position, so it does not distinguish late observation
from an incorrect start position. The assertion now includes the numeric sample
for future diagnosis; its range and timing are unchanged. This startup-offset
qualification remains open independently of live-return stability and timeout
1004. No further runtime repeats were used to obtain a passing result.

On 2026-10-19, the debug app and instrumentation APK compiled with Player 3.155.0.
An Android 16 emulator passed both real playback tests through the Gradle command
above: 2 passed, 0 failed, 0 skipped in 29.294 seconds. The APK contained the final
shared UI bundle. These checks used the catalog's public sample sources; physical
devices, Android TV and Fire TV were not covered by this run.
