# Bitmovin Player sample for React Native and Expo

This folder contains the React Native showcase screen, rewind-window logic, and
a generator for an external Expo development project using that same screen.
The player library bridges to native iOS and Android players. Its reads return
Promises, so the screen awaits a snapshot before calculating the live window.
DVR means the window of live media that a viewer can rewind.

## Layout

- `src/dvr/`: TypeScript rewind calculations and state handling.
- `src/sources.ts`: test source definitions; `App.tsx` maps source kind to
  the player's `SourceType`.
- `App.tsx`: player, control panel, and snapshot refresh on `onTimeChanged`.
- `src/ConfigurationPanel.tsx`, `src/configuration.ts`: draft configuration controls
  and validation before player creation/source loading.
- `expo/`, `scripts/create-expo-project.mjs`: pinned Expo host, native asset plugin,
  and dependency locks. Generated native projects stay outside this checkout.

## Test and type-check

From the repository root:

```bash
pnpm --filter @showcase/react-native test
pnpm --filter @showcase/react-native typecheck
```

The type-check includes `App.tsx`, the source definitions, and the pure logic,
using the installed React Native and player types. It does not build the native
app or verify playback.

The App interaction tests mount the screen with mocked native hosts and player
objects. They exercise form edits, Apply/Reset, source selection, recreation,
bitrate integer boundaries and URL validation with incomplete native global URL
getters. React 19
deprecates `react-test-renderer`; that expected warning is retained in test output,
and other console errors fail the tests. These tests do not render native layout,
the Web UI, a video surface, or a stream.

## Configuration controls

Open **Show configuration** to edit the source URL, HLS/DASH/progressive type,
title, poster URL, signed start offset and its timeline reference. iOS starts
with HLS and hides DASH sources/types because its native player does not support
DASH. Android retains the existing HLS and DASH presets.

The same panel exposes autoplay, startup mute, forward buffer duration and the
adaptation bitrate cap. URL fields accept HTTP/HTTPS; optional fields can be
cleared. Start offsets and buffer durations accept finite decimal seconds.
The bitrate cap uses whole bits per second: 1–2,147,483,647 on Android, and
1–9,007,199,254,740,991 on iOS. The native bridge converts bitrate to an integer;
fractions would lose precision, Android uses a signed 32-bit integer, and values
above JavaScript's safe-integer limit cannot be represented exactly. Invalid
input leaves the active player unchanged. Blank means no cap. The buffer field
accepts zero on iOS to let the SDK choose a duration. This screen requires a
positive Android buffer target: zero has no automatic-selection meaning there.
Blank leaves the platform SDK default (iOS 0, Android 50 seconds) untouched.
No startup/restart thresholds are overridden.

URL validation uses the locally imported `URL` from `react-native-url-polyfill`
4.0.0. Older React Native global URL implementations leave `protocol` and
`hostname` unimplemented, which would reject valid sources before loading.
The local import leaves global URL and the SDK's media shims unchanged; it does
not install the package's global polyfill.

**Apply and recreate player** validates the whole draft, recreates the player
and reloads the selected source from its configured start offset. Playback
position is reset. Invalid input and an unchanged configuration do not replace
the player. **Reset draft** only restores the currently applied values. Source
preset buttons still load immediately and replace the draft's source fields;
unapplied playback/buffer/adaptation edits remain in the draft.

The complete applied source, chosen UI, log and **Allow DVR** setting survive
recreation. Playback starts according to the Autoplay setting. Source/player
errors add log entries. **Allow DVR** controls the application's DVR helper;
it does not edit the SDK's creation-time `isTimeShiftEnabled` property.

The direct editable mappings are:

| GUI control | Public SDK configuration |
| --- | --- |
| URL / type / title / poster | `SourceConfig.url`, `.type`, `.title`, `.poster` |
| Start offset / reference | `SourceConfig.options.startOffset`, `.startOffsetTimelineReference` |
| Autoplay / startup mute | `PlayerConfig.playbackConfig.isAutoplayEnabled`, `.isMuted` |
| Forward buffer | `PlayerConfig.bufferConfig.audioAndVideo.forwardDuration` |
| Bitrate cap | `PlayerConfig.adaptationConfig.maxSelectableBitrate` |

These mappings use the [public wrapper 1.28.0 source declarations](https://github.com/bitmovin/bitmovin-player-react-native/tree/v1.28.0/src),
including its [platform-specific buffer documentation](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/src/bufferConfig.ts).
The public [Android](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/android/src/main/java/com/bitmovin/player/reactnative/converter/JsonConverter.kt#L163-L165)
and [iOS](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/ios/RCTConvert%2BBitmovinPlayer.swift#L964-L965)
converters explain the bitrate integer limits. The URL package documents
[local imports without replacing global URL](https://www.npmjs.com/package/react-native-url-polyfill/v/4.0.0).
Loop is not an exposed configuration property in this wrapper. Native rendering
and playback require a development build with an authorized Player license.

## Build in an Expo project

Use Node **24.19.0** and pnpm **10.33.0**. The generated host pins Expo **54.0.35**,
React Native **0.81.5**, React **19.1.0**, wrapper **1.28.0**, and Expo Crypto
**15.0.9**, the version required by Expo 54. Its standalone `pnpm-lock.yaml`
preserves the resolved JavaScript dependency graph. Expo 54 supplies its native
prebuild template; no moving `create-expo-app@latest` template is used.

The display name is **Player Lab React Native**. Both the iOS bundle identifier
and Android application ID are **`com.playerlab.reactnative`**, defined in
`expo/app.json`. Authorize this identifier on the Player license you supply.
Analytics uses its own optional license and authorization settings.

From the repository root, after configuring the keys described in
[`docs/SETUP.md`](../../docs/SETUP.md):

```bash
pnpm install --frozen-lockfile
pnpm --filter @showcase/ui-shared build
bash scripts/sync-env.sh
node apps/react-native/scripts/create-expo-project.mjs ../player-lab-react-native --env-from apps/react-native/.env
cd ../player-lab-react-native
pnpm install --frozen-lockfile
pnpm exec expo prebuild --no-install
```

The target must be a new directory outside this checkout. The generator copies
the existing `App.tsx` and TypeScript sources, registers that screen with a safe
area, and includes both native config plugins and built shared UI assets.
`--env-from` explicitly copies the ignored generated key file with mode `0600`;
omit it to create a project without keys. It never inserts keys into `app.json`.
The copied `.env` supplies `EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY` and optional
`EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY`. Do not commit that file or native
build output.

The generator copies the environment file once. To refresh an existing external
host after changing the repository keys, run these commands from the repository
root, then restart Metro in the external host:

```bash
bash scripts/sync-env.sh
install -m 600 apps/react-native/.env ../player-lab-react-native/.env
```

The copied file uses the client-facing EXPO_PUBLIC_ variable names. Keep it
outside version control.

On macOS, install Xcode and CocoaPods for iOS. Android requires Java 17 and the
Android SDK/toolchain selected by Expo 54. Restore the checked-in native locks
after prebuild, before the first iOS build:

```bash
cp native-locks/Podfile.lock ios/Podfile.lock
(cd ios && pod install)
mkdir -p ios/PlayerLabReactNative.xcworkspace/xcshareddata/swiftpm
cp native-locks/Package.resolved ios/PlayerLabReactNative.xcworkspace/xcshareddata/swiftpm/Package.resolved
pnpm exec expo run:ios
# Or, for Android:
pnpm exec expo run:android
```

The supplied CocoaPods lock was generated with CocoaPods **1.17.0**. Keep
`Podfile.lock` and the workspace's `Package.resolved` when maintaining the
generated project. A subsequent prebuild can refresh native files; restore the
locks again if generating a fresh project. Expo Go cannot load the native Player.

The wrapper-supported native resolutions are:

| Dependency | React Native host |
| --- | --- |
| iOS Player / Player Core | 3.126.0 / 3.126.0 |
| iOS Analytics collector | 3.28.1 |
| iOS Google IMA | 3.26.1 |
| Android Player | 3.165.0+jason |

The standalone iOS sample's Player 3.128.0 and standalone Android sample's Player
3.171.0 are separate integrations. Do not force those versions into wrapper
1.28.0. Since wrapper 1.27, Player and IMA use Swift Package Manager on iOS; the
bridge and Expo still use CocoaPods. Existing projects should follow the
[official migration guide](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/docs/ios-dependencies.md).

## Shared player UI

The "UI" picker selects the default Web UI or Sports, Live, and Cinema factories
from `@showcase/ui-shared`. Custom modes set
`usePlayer({ styleConfig: { userInterfaceType: UserInterfaceType.Bitmovin, playerUiJs, playerUiCss } })`
and use `PlayerView` with `uiConfig.variant = new CustomUi("…buildSportsUI")`.
The configuration applies when the player is created, so changing it remounts the
keyed `PlayerPane`.

The generator consumes the repository's built shared UI. After editing that UI,
rebuild it and copy the two updated files into an existing external project:

```bash
pnpm --filter @showcase/ui-shared build
cp packages/ui-shared/dist/bitmovinplayer-ui.{js,css} ../player-lab-react-native/assets/webui/
# In the external project, refresh native resources and rebuild:
# pnpm exec expo prebuild --no-install
```

The config plugin copies JS/CSS into Android's `app/src/main/assets/webui/` and
adds the two files to iOS Copy Bundle Resources. `App.tsx` uses
`file:///android_asset/webui/…` on Android and relative main-bundle filenames on
iOS. The SDK default UI continues to use the SDK's bundled assets. Rebuild the
native app after changing packaged UI files; a Metro reload alone cannot replace
native resources.

For a short runtime check, select **VOD HLS** and use the SDK Default UI to play
until its media clock advances. Select **Sports**, confirm its INFO control, and
play again. In configuration, edit the title and choose **Reset draft**; the
applied title should return without interrupting playback. Then edit the title,
start offset, autoplay and mute, apply, and confirm that the source and chosen
UI are retained while the position restarts. **Allow DVR** and the existing log
should remain. Background the app, return, and check that VOD can advance again.

The screen logs numeric Player/Source error codes without copying SDK error
messages. Android Player error
[1003](https://cdn.bitmovin.com/player/android/3.165.0/docs/player-core/com.bitmovin.player.api.deficiency/-player-error-code/-license-authentication-failed/index.html)
means the license request failed or was denied; it does not establish which
cause occurred. Check the installed application ID and key configuration, device
time, and network/TLS connectivity before changing license settings. If a
dedicated emulator reports an Unknown Host error, Android documents an
[AVD-specific `-dns-server` launch option](https://developer.android.com/studio/run/emulator-networking-dns).

## Native qualification

The generated host has built successfully for an iPhone 17 Pro simulator on
iOS 26.4 with Xcode 27.1, and for an ARM64 Android API 36.1 emulator with Java 17.
Packaged shared JS/CSS bytes matched the built assets on both platforms.

Actual iOS native checks exercised SDK Default VOD playback, the packaged Sports
factory's INFO control and Play/Pause, Reset draft, Apply with autoplay/mute and
a start offset, source/UI/log/Allow DVR retention, and advancing VOD after
background/foreground return.

Android API 36.1 checks used the public VOD HLS preset, Tears of Steel, with a
native duration of 734 seconds. Default and Sports showed visible video with
advancing native SDK positions. Sports loaded the packaged JS/CSS and its custom
factory, with the INFO control visible. Native UI actions exercised Reset and
Apply. Native getters confirmed the title, start-offset value of 5 seconds,
autoplay and startup mute. Apply
destroyed the old player, created a new owner and retained the complete source,
selected Default UI, log and Allow DVR state. After background/foreground return,
the applied owner was retained and VOD advanced after checking the on-screen
playback controls. The check did not record whether Play was tapped or playback
had already resumed, so automatic resume without interaction remains unqualified.

These checks do not qualify physical devices, Release archives, DRM,
advertisements, every shared factory, live/DVR behavior, accuracy of the initial
seek or quantitative buffer/bitrate effects. The repository's App tests use native mocks; generator
tests and TypeScript checks provide separate evidence and do not establish
playback.

## Player event handling

- `refresh()` reads the snapshot with `Promise.all` before deriving state. Native
  events share one in-flight batch and at most one pending refresh, so a burst
  cannot create an unbounded queue of bridge reads. Successful batches publish
  in order even if events keep arriving during each read; discarding every such
  batch would prevent the controls from updating on a slower bridge. Source
  changes and unmounts invalidate older completions.
- A rejected read keeps the last valid display and logs `Snapshot read failed`.
  The other reads in that batch finish before another batch starts. Read and
  seek completions from a previous source cannot update controls or seek.
- "Allow DVR" updates the cached display immediately, including while paused.
- The screen detects a live stream becoming on-demand by comparing snapshots on
  `onTimeChanged`, rather than relying on an `onDurationChanged` event.
- Recovery from an expired rewind position is also detected from snapshots. The
  screen returns to the live edge when the position falls outside the window;
  it does not rely on a `DvrWindowExceeded` event prop.

Verify these behaviors in the external Expo build with a valid player license.

## Applied configuration code

Open **Show configuration → Show applied code** to inspect the Player, Source and
selected UI settings sent to the SDK. The output excludes draft edits and license
values. **Copy code** uses Expo Clipboard 8.0.8, matched to Expo 54. Regenerate and
build the external native host after changing native dependencies; refreshing
JavaScript alone does not install a native module.
