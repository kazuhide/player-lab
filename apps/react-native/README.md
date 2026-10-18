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
React Native 0.81.5, and `bitmovin-player-react-native` 1.x. The following creates
an external project; check its generated dependency versions against the manifest
because `@latest` can change:

```bash
npx create-expo-app@latest dvr-showcase
cd dvr-showcase
npx expo install bitmovin-player-react-native expo-crypto
# Copy this folder's App.tsx, src/, and generated .env into the Expo project.
```

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

- `refresh()` reads the snapshot with `Promise.all` before deriving state.
- The screen detects a live stream becoming on-demand by comparing snapshots on
  `onTimeChanged`, rather than relying on an `onDurationChanged` event.
- Recovery from an expired rewind position is also detected from snapshots. The
  screen returns to the live edge when the position falls outside the window;
  it does not rely on a `DvrWindowExceeded` event prop.

Verify these behaviors in the external Expo build with a valid player license.
