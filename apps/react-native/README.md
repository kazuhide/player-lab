# Bitmovin Player sample for React Native and Expo

This folder contains a React Native screen and rewind-window logic using
`bitmovin-player-react-native`. It is not a complete generated Expo app.
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
Loop is not an exposed configuration property in this wrapper. Native Expo
integration, artwork/UI rendering and playback on iOS/Android still need a
device or simulator build.

## Build in an Expo project

Use an Expo project compatible with this folder's `package.json`: Expo 54,
React Native 0.81.5, React 19.1.0, and `bitmovin-player-react-native` 1.28.0.
The wrapper defaults to native Player 3.126.0 through Swift Package Manager on
iOS/tvOS and 3.165.0+jason on Android. Keep this wrapper-supported combination;
the standalone native samples have separate SDK pins.

The following creates an external project; check its generated dependency
versions against the manifest because `@latest` can change:

```bash
npx create-expo-app@latest dvr-showcase
cd dvr-showcase
npx expo install bitmovin-player-react-native@1.28.0 expo-crypto react-native-url-polyfill@4.0.0
# Copy this folder's App.tsx, src/, and generated .env into the Expo project.
```

Register the Player config plugin in the external project's `app.json` or
equivalent `app.config`, preserving any existing plugins:

```json
{
  "expo": {
    "plugins": ["bitmovin-player-react-native"]
  }
}
```

Version 1.27 migrated iOS Player and Google IMA dependencies from CocoaPods to
Swift Package Manager. When upgrading an existing app, remove explicit Player,
Player Core, Analytics, and IMA pod dependencies; keep the React Native bridge,
Expo, and optional Cast pods. With the plugin registered, rerun iOS prebuild:

```bash
npx expo prebuild --platform ios
```

Install pods if prebuild did not do so, then open the generated `.xcworkspace`.
For projects maintained without prebuild, follow the
[official iOS dependency migration guide](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.28.0/docs/ios-dependencies.md).
The installed package's `ios/dependencies.json` defines the exact Player and IMA
versions. Rebuild and check framework embedding and Release archives after
integration; the repository's type checks do not verify them.

At the repository root, `bash scripts/sync-env.sh` generates this folder's ignored
`.env` with `EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY` and optional
`EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY`. Set the source keys in the root
`.env` first; see `docs/SETUP.md`. Allow the external app's bundle ID or package
name on your player license. If supplied, the analytics key enables playback-quality
reporting to your account. Do not commit the generated key file.

The player has native modules and needs a development build. From the Expo project:

```bash
npx expo run:ios
# Or:
npx expo run:android
```

Expo Go does not provide the required native player modules.

## Shared player UI

The "UI" picker selects the default Web UI or Sports, Live, and Cinema factories
from `@showcase/ui-shared`. Custom modes set
`usePlayer({ styleConfig: { userInterfaceType: UserInterfaceType.Bitmovin, playerUiJs, playerUiCss } })`
and use `PlayerView` with `uiConfig.variant = new CustomUi("…buildSportsUI")`.
The configuration applies when the player is created, so changing it remounts the
keyed `PlayerPane`.

From the repository root, build and sync the assets:

```bash
pnpm --filter @showcase/ui-shared build && pnpm sync:webui
```

This writes ignored files under `assets/webui/`. They still need to be copied into
the generated native iOS and Android projects, and `WEBUI_JS` / `WEBUI_CSS` in
`App.tsx` must resolve to those files. The current addresses are placeholders for
that integration. The shared UI uses `bitmovin-player-ui` 4.x; check its rendering
in the native WebView after integrating it. Type-checking does not verify asset
delivery or rendering.

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
