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

## Test and type-check

From the repository root:

```bash
pnpm --filter @showcase/react-native test
pnpm --filter @showcase/react-native typecheck
```

The type-check includes `App.tsx`, the source definitions, and the pure logic,
using the installed React Native and player types. It does not build the native
app or verify playback.

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
npx expo install bitmovin-player-react-native@1.28.0 expo-crypto
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
