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

On 2026-10-20, Player 3.171.0 passed all 14 JVM tests (six DVR, six
configuration and two lifecycle tests) and debug app/instrumentation builds.
The final authorized-license group on an Android 16/API 36.1 ARM64 phone
emulator passed eight of nine checks in 149.519 seconds. Configuration/ownership,
configured VOD autoplay/mute/10-second offset, finite VOD duration, 12 UI handoffs,
and two background/resume/UI-replacement cycles with explicit Play all passed.
The lifecycle regression tests first failed with missing forwarding, then passed
with host callbacks and resumed-view catch-up implemented.

The unchanged strict return-to-live check failed without Player or Source errors.
Its fresh completion arrived 3.070 seconds after the request and only 0.011
seconds past the requested media target, but the offset was still -3.059 seconds.
The UI truthfully reported behind-live state; auto-hidden controls did not satisfy
the visible-LIVE condition. Earlier comparisons of base `2c90983` and main
`09e0a37`, using the same SDK, shared UI bundle and emulator, showed the same
request-target versus moving-edge distinction:

| App revision | Return completion latency | Completion minus requested target | Offset at completion |
| --- | --- | --- | --- |
| `2c90983` | 6.598 s | +0.057 s | -6.573 s |
| `09e0a37` | 4.439 s | +0.367 s | -4.116 s |

An additional diagnostic required advancing playback before both the rewind and
return requests. A fresh return completion took 4.253 seconds, reached the exact
requested target, and still reported -4.270 seconds from the moving edge.
The 14.009-second jump was beyond the 11.811-second forward video buffer; those
measurements do not identify the specific operation responsible for the delay.
The pinned SDK defines [isStalled](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-player/is-stalled.html)
as false during time shifting. A zero offset was also observed before a fresh
completion, so neither field alone establishes a completed return. The app keeps
its actual behind-live display and the existing strict checks; it does not add
automatic seek retries.

The lifecycle correction follows the SDK integration contract. It does not
establish resolution of timeout 1004: a separate focused background/resume run
completed both playback cycles but recorded 1004 during Activity close. Its
specific timed-out operation was not captured. The final grouped run did not
reproduce it. Failure diagnostics now classify an available surface/release
message or cause and record the current test phase without printing opaque SDK
messages. No timeout, seek, visibility or playback condition was relaxed.

An earlier eight-check group passed seven in 97.328 seconds but failed the
configured-VOD first-observed-position range (`9.0..13.0` seconds for a 10-second
start offset). That report omitted the sampled position, so late observation
and an incorrect starting position cannot be distinguished. The assertion now
reports the number with the same range and timing. Its later pass does not
establish stable grouped startup-offset behavior. Live-return stability,
startup-offset qualification and timeout 1004 remain open independently.
Physical devices, Android TV, Fire TV, offline, casting, Analytics receipt and
completed SDK resource cleanup remain outside these checks.

## Applied configuration code

Open **Configuration → Show applied code** to read the Player, Source and selected
UI settings sent to the SDK. Draft edits do not change this output. **Copy code**
writes the code to the Android clipboard; you can also select the text. License
values are excluded and the Player key is a placeholder. The app’s Allow DVR
switch remains separate from the SDK configuration.
