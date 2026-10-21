# Player Lab for Android and Fire TV

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

The application ID and Kotlin namespace are `com.playerlab.android`; the test APK
uses `com.playerlab.android.test`. Allow
`com.playerlab.android` on your player license. The analytics key is optional;
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

The Activity forwards start, resume, pause and stop to its active `PlayerView`,
following the [SDK lifecycle contract](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-ui-web/com.bitmovin.player/-player-view/index.html).
A replacement view catches up when the Activity is already resumed. Before a
view is retired or its player is destroyed, its lifecycle observer is removed;
the view detaches from the player before `PlayerView.onDestroy()`. The controller
retains Player ownership across UI changes.
In the SDK 3.171.0 phone-emulator check, foregrounding kept playback paused;
use the player's Play control to resume when needed.

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
URL, persistent poster, start offset in seconds, Start/End/SDK-default offset
reference, and optional live target latency in seconds. HTTP requests still depend on the device's cleartext network policy.
The SDK-default reference is the start for VOD and the end for live streams;
out-of-window offsets are corrected by the SDK. A blank offset uses the SDK
default. **Reset source draft** returns to the currently applied source without
reloading. Selecting any catalog source, including the same preset again, replaces
the source draft and clears custom metadata, offsets, and live target latency.

A blank **Live target latency (s)** keeps the original SDK defaults (`liveConfig = null`).
An explicit finite value maps to `SourceLiveConfig.targetLatency`, changes the SDK's
definition of the live edge, and asks the SDK to approach that latency while avoiding
stalls. It is ignored for VOD. Apply reloads the source; player recreation retains the
applied value. This policy does not guarantee convergence within a deadline and is
not a qualification of stable return to the moving live edge.

The editor also exposes seven language, subtitle and network settings:

| Field | Value and application |
| --- | --- |
| Player audio language priority | Comma-separated language codes, highest priority first, for example `de, en`; blank means no preference. Apply restarts the player. |
| Source audio language priority | The same format; a nonempty list overrides the player preference, while blank inherits it. Apply reloads the source. The SDK chooses the highest-priority available language before downloading the initial audio; no match uses the default track. |
| WebVTT URL / Subtitle label / Subtitle language / Default external subtitle | One optional HTTP/HTTPS WebVTT track, with an optional menu label and language code. Supply the URL before applying its metadata; clear all four fields to remove it. `isDefault` is informational metadata and does **not** automatically enable subtitles. Select the track from the existing Default UI's subtitle menu. Apply reloads the source. |
| HTTP retry delays (s) | Blank retains the SDK's linear backoff; `none` disables retries. A comma-separated list such as `0, 0.25, 2` allows one retry per finite nonnegative delay, in seconds. Apply restarts the player. This does not enable DRM renewal retries. |

Language lists trim surrounding whitespace and remove duplicate codes without
changing their priority. Subtitle URL, label and language are trimmed. Empty
items in language or retry lists are rejected. These settings participate in the
same draft validation, Reset, source retention and applied-code output as the
original fields. No request headers, credentials or arbitrary callbacks are edited.
The definitions follow the pinned
[audio preference](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-playback-config/preferred-audio-languages.html),
[subtitle track metadata](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.media/-track/is-default.html), and
[HTTP retry schedule](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.network/-retry-http-request-config/-retry/retry-timeouts.html)
contracts.

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
[SourceOptions](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source-options/index.html), and
[SourceLiveConfig.targetLatency](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.live/-source-live-config/target-latency.html)
references. Keys continue to come from build configuration.

**Show applied code** displays Kotlin `PlayerConfig`, `SourceConfig`, and
`PlayerViewConfig` values for the applied settings and current UI. Draft edits are
excluded. **Copy code** writes that text to the Android clipboard; license keys
are placeholders. The source's optional live target latency is included. The
example is SDK configuration, so the integrating app must still attach the view,
forward its lifecycle, and supply its own keys.

The draft validation and mapping tests run with `:app:testDebugUnitTest`.
`PlayerConfigurationInstrumentedTest` drives the real Compose editor and SDK with
a dummy license to verify application, reset, source retention, player/view
ownership, and D-pad focus without asserting successful media playback.
`PlayerOwnershipInstrumentedTest` independently records API calls to check
exactly-once destruction, listener removal, and retired callback rejection:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.playerlab.android.PlayerConfigurationInstrumentedTest,com.playerlab.android.PlayerOwnershipInstrumentedTest \
  -PbitmovinLicenseKey=dummy -PbitmovinAnalyticsLicenseKey=
```

## Playback checks

Unit tests and APK builds do not verify licensed playback. On a device or
emulator, check live seeking, returning to live, and recovery when paused media
expires. Android TV and Fire TV also need remote-control checks; the app declares
a `LEANBACK_LAUNCHER` entry for TV launchers. Use your own license and reachable
test streams.

The full instrumented suite also uses a local 60-second HLS/DASH finalization
fixture. Generate the [local test media](../../docs/local-test-media.md), then
start its server from the repository root with Node 24:

```sh
python3 encoding/test-streams/local.py
node apps/android/runtime-fixture.mjs .cache/test-streams/vod-baseline
```

In another terminal, connect the owned emulator or device and forward the three
loopback ports before running the suite from `apps/android`:

```sh
adb reverse tcp:5272 tcp:5272
adb reverse tcp:5273 tcp:5273
adb reverse tcp:5274 tcp:5274
cd apps/android
./gradlew :app:connectedDebugAndroidTest
# Remove these forwards and stop the fixture server after testing.
adb reverse --remove tcp:5272
adb reverse --remove tcp:5273
adb reverse --remove tcp:5274
```

The debug build permits HTTP only for `localhost` and `127.0.0.1`; release network
policy is unchanged. The fixture and authorized license are required for the full
suite. Select individual test classes when checking only their documented scope.

For automation, the Android-specific entry point builds and installs both APKs,
runs the public `AndroidJUnitRunner` on an explicitly selected device, and writes
a safe JSON result. It requires successful individual tests and the final runner
completion; an `adb` exit code of zero alone does not pass. Raw build and test
output stays in the private directory outside the repository. The runner stops
the app and test package afterward, including on timeout. It does not start an
emulator or manage the fixture server or port forwards:

```sh
python3 apps/android/runtime-tests.py --serial emulator-5554 \
  --output-dir /tmp/player-lab-android-runtime
# Configuration-only example; this builds with a dummy key and cannot qualify playback.
python3 apps/android/runtime-tests.py --serial emulator-5554 \
  --output-dir /tmp/player-lab-android-configuration \
  --dummy-license --classes com.playerlab.android.PlayerConfigurationInstrumentedTest
python3 apps/android/test-runtime-tests.py
```

Use `--classes` with comma-separated classes or `class#method` to limit the scope.
`--skip-build` uses existing APKs and must be used only after building the intended
source and credential configuration. Configuration-only and playback results must
be reported separately.

The same fixture serves the generated `vod-multiaudio` sibling directory on
port 5274, WebVTT cues spanning the 60-second video, and a manifest that fails a bounded number of
times before serving the original bytes. The control endpoint exposes only
counters and a reset accepting zero through three failures. The server stays on
loopback and does not proxy upstream requests or log request data. Its own checks
run with `node --test apps/android/configuration-fixture.test.mjs` from the repository root.

`PlayerLanguageNetworkInstrumentedTest` uses the real configuration editor and
public SDK APIs to check initial audio-language selection, a source override and
return to player inheritance; external subtitle metadata followed by a visible
Default UI menu selection, a fresh native cue and visible subtitle text; and two
configured HTTP retries versus no retries. The expected no-retry source error is
kept separate from successful playback, then a healthy source reload must advance
on the same player. It uses the authorized license and the fixture above, with no
private observer or diagnostic bridge.

`PlayerDvrInstrumentedTest` checks the real library's source loading and finite
on-demand duration. `PlayerControlsInstrumentedTest` uses the app's actual Compose
buttons and switch, checks the bundled Sports UI's elements and stylesheet in its
WebView, starts playback through that UI, then checks source switching, live
rewind, return to live, and the DVR setting. Both tests need network access and a
valid license allowing `com.playerlab.android`; neither substitutes a mock player.
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
The start-offset check captures the first `TimeChanged` after both `Ready` and
`RenderFirstFrame` for the newly applied source and player. It retains the
9.0–13.0-second range and 40-second deadline, including zero samples. Loaded and
`isPlaying` alone can precede those readiness events.

The standard UI checks drive Play, Pause, Mute, Unmute, the seek bar, 1.5x speed,
and audio/subtitle/video-quality choices, then verify native state or fresh native
completion events. A seek-bar hover reaches the native thumbnail query; the
reference asset returns no thumbnail image. The SDK's deprecated
`Player.getThumbnail` delegates to the active `Source.getThumbnail`. On the tested
phone, fullscreen and picture-in-picture have no configured handlers or visible
buttons, and the mobile volume slider is hidden. Those routes are recorded as
unavailable rather than playback successes.

`PlayerFinalizationInstrumentedTest` changes HLS to ENDLIST and DASH to static
at the same URL. It checks fresh `PlaybackFinished`, finite native duration and
position, retained source/player, disabled DVR/live commands, visible Replay and
replay-clock progress, fresh VOD seek completion, a new live generation, and an
explicit VOD switch. Shared live labels stay hidden during Replay and return for
the new live load. This sample derives VOD from the SDK's finite duration; it does
not replace native getter values.

`PlayerConfigurationCodeInstrumentedTest` checks draft exclusion, applied source
and live policy, current UI selection, Copy feedback, and exact text in the real
Android clipboard. It does not require successful media playback.

`PlayerUiHandoffInstrumentedTest` keeps the same player playing VOD while cycling
through Sports, Live (DVR), Cinema and Default three times. It checks that each
retired view detaches, one active view intersects the viewport, and playback time
advances after every handoff. A separate check drives the real Activity through
two stopped/resumed cycles, then replaces the UI while resumed. It checks source,
settings, UI and Allow DVR retention, muted playback progress, viewport visibility,
and Player invalidation with no recorded errors through Activity teardown. It
requests playback explicitly after foregrounding. These
checks require an authorized license; they do not prove that all SDK resources
have completed release.

`PlayerViewLifecycleTest` uses a real AndroidX lifecycle registry on the JVM. It
checks host event order, immediate catch-up for a resumed replacement, observer
removal and rejection of late views after release. The recording ownership test
separately checks app-owned Player destruction.

The shared UI can exist before its playback control becomes visible. The test
waits for that control, then checks that native playback time advances. It reveals
controls through WebView pointer input, or one native tap on a visible Default
touch overlay when its controls have hidden, and checks element dimensions and the
computed display, visibility and opacity of each ancestor. Hidden controls with
nonzero dimensions do not establish a visible result.

Live offsets use a moving reference: the live edge can advance while a rewind
buffers. The test fixes a media reference from the SDK-reported position and
offset just before seeking, then checks that the next `TimeShifted` event lands
within three seconds of the resulting target. It also requires a negative live
offset and the visible behind-live state. The return-to-live check requires a new
completion event, an SDK-reported offset within one second of zero, and visible
`LIVE` text and button state within the same 40-second deadline. The native
predicate is checked again after the visible UI check.

`LowLatencyApi.latency - targetLatency` is recorded separately: it measures distance
from the configured latency target, which the SDK approaches while avoiding
stalls. It is not a promised sub-second convergence deadline. The SDK can classify
playback as live (`timeShift == 0`) while that distance remains nonzero.
[Source.seekableRange](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source/seekable-range.html)
returns `(0, 0)` for live sources and cannot provide a separate live media endpoint.
Request-time targets, current position, latency, configured/effective targets,
forward audio/video buffers and seekable range remain numeric diagnostics.

If that check fails, its report includes monotonic request/completion times,
the requested media target, completion position and offset, native-ready poll
count, and the live controls' text, classes, dimensions and hidden ancestors.
It does not include SDK error messages or configuration dumps.

The app's event log also retains startup error codes, so a failed initial request
can be distinguished from a source that is still loading.

On 2026-10-21, Player 3.171.0 passed 18 JVM tests (six DVR, ten configuration
and two lifecycle tests) and debug app/instrumentation builds. The authorized
Android 16/API 36.1 ARM64 phone-emulator group passed all 16 checks in 237.139
seconds: configuration/ownership, configured VOD autoplay/mute/start offset,
strict live return, standard SDK UI actions and availability, HLS/DASH
finalization, applied-code/clipboard behavior, finite VOD duration, 12 UI
handoffs, and two background/resume/UI-replacement cycles with explicit Play.
Normal live return completed in 157 ms, within +0.002 s of its requested target;
native zero offset and genuinely visible LIVE agreed 206 ms after the request.
No automatic seek retry is included.

The configured VOD check captured 10.256 s after fresh Ready and first-frame
events for the applied source. The final HLS/DASH follow-up passed both cases in
69.860 s, explicitly checking a fresh VOD Seeked event and visible live controls
restored by a new load. The optional 30-second target-latency policy also passed
the coupled completion/native-offset/visible-LIVE check under a controlled
emulator delay. These recorded runs do not establish a seek-completion or
latency-convergence SLA. The optional policy keeps the SDK synchronization
defaults; temporary catch-up adjustments are not reported by Player.playbackSpeed.

These checks use an Android phone emulator. Physical-device, Android TV, Fire TV,
offline, casting and Analytics delivery require their respective environments.
The recorded native observations establish playback and control behavior; they
do not measure complete internal SDK resource reclamation.

## Applied configuration code

Open **Configuration → Show applied code** to read the Player, Source and selected
UI settings sent to the SDK. Draft edits do not change this output. **Copy code**
writes the code to the Android clipboard; you can also select the text. License
values are excluded and the Player key is a placeholder. The app's Allow DVR
switch remains separate from the SDK configuration.
