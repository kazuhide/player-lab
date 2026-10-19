# Bitmovin Player sample for Android and Fire TV

Kotlin sample using the Bitmovin Player library, with a Compose control panel and
`PlayerView`. The app targets phones, tablets, Android TV, and Android-based Fire
TV devices. DVR means the window of live media that a viewer can rewind.

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
UI, and seek buttons remain reachable without changing the control layout.

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

The app's event log also retains startup error codes, so a failed initial request
can be distinguished from a source that is still loading.

On 2026-10-19, the debug app and instrumentation APK compiled with Player 3.155.0.
An Android 16 emulator passed both real playback tests through the Gradle command
above: 2 passed, 0 failed, 0 skipped in 29.294 seconds. The APK contained the final
shared UI bundle. These checks used the catalog's public sample sources; physical
devices, Android TV and Fire TV were not covered by this run.
