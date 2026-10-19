# Bitmovin Player sample for Vega OS and Fire TV

Vega OS is a separate target from Android-based Fire TV. This example uses the
modular Bitmovin web player attached to a W3C media element, with React Native /
Kepler controls. It does not use the browser-based `bitmovin-player-ui` because
that library requires a browser document. DVR means the window of live media that
a viewer can rewind.

This folder is source for integration into a Vega/Kepler project, not a complete
standalone device build. Its manifest requests `bitmovin-player@8.138.0-beta.28`
and the Amazon device packages. Third-party libraries and platform tools are
external dependencies with their own licenses and access requirements; they are
not bundled or relicensed by this repository.

Vega uses a separate Player release channel. As of 2026-10-20, the
[official Vega sample](https://github.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/blob/0c7463104d3c18f56440aeec7beccd0d92c11aaa/README.md#features-and-limitations)
supports only `8.138.0-beta.XX`; its latest
[listed release](https://github.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/blob/0c7463104d3c18f56440aeec7beccd0d92c11aaa/PLAYER-CHANGELOG.md)
is `8.138.0-beta.28`, which this app retains. Keep this Vega-specific pin when
updating the browser and native SDKs; general Web releases are not declared
supported on Vega by that sample.

## Layout

- `src/dvr/`: TypeScript rewind-window calculations and state handling.
- `src/dvrController.ts`: player events, clamped live seeking, live-to-on-demand
  transition handling, and expired-position recovery.
- `src/vegaPlayer.ts`: modular player registration and construction.
- `src/playerSession.ts`: asynchronous media/player ownership and cleanup.
- `src/Sources.ts`: player source configurations.
- `src/App.tsx`, `src/ControlPanel.tsx`, `src/BitmovinPlayer.tsx`: Kepler controls
  and video surface, including `KeplerVideoSurfaceView` and `useTVEventHandler`.
- `src/polyfills.ts`: minimal compatibility shim, not the full runtime setup.

## Test and type-check without the Vega toolchain

From the repository root:

```bash
pnpm --filter @showcase/vega test
pnpm --filter @showcase/vega typecheck
```

The type-check covers the rewind logic, source definitions, compatibility shim,
and modular player wiring against the installed player types. As specified in
`tsconfig.json`, it excludes the React/Kepler `.tsx` controls. Those components
need to be built and checked in the Kepler project. Passing the commands above
does not establish that the device app builds or plays.

The session tests use delayed Promises with fake media and player objects. They
check source changes during initialization and loading, cleanup ordering, and
the current "Allow DVR" setting. Each session releases its own controller,
player, surface handle, and media object once. A replacement waits for the old
player and media cleanup before installing the global media shim. Late callbacks
from a cancelled session cannot publish controls for a previous source. These
tests do not exercise the Vega runtime, a device video surface, or playback.

## Build in a Kepler project

Use Amazon's Vega/Kepler development tools, including
`@amazon-devices/kepler-cli-platform`, and a compatible Fire TV device or Vega
simulator. Use the React Native 0.72 dependency set in `package.json`. From your
configured Kepler project:

```bash
react-native build-kepler --build-type Debug
kepler device install-app --dir . && kepler device launch-app
```

Replace the minimal `src/polyfills.ts` shim with the runtime compatibility setup
from the Bitmovin Vega sample available to you. It must provide Base64 helpers,
`DOMParser`, W3C media integration, and WebCrypto. The minimal file in this folder
alone is not sufficient for playback.

The entry point must set the following globals before the app mounts; `App.tsx`
does not load a `.env` file itself. Use your keys from the repository-root `.env`
(see `docs/SETUP.md`):

```ts
// Kepler entry (index.js), before AppRegistry.registerComponent:
globalThis.BITMOVIN_PLAYER_LICENSE_KEY = "<BITMOVIN_PLAYER_LICENSE_KEY>";
globalThis.BITMOVIN_ANALYTICS_LICENSE_KEY = "<BITMOVIN_ANALYTICS_LICENSE_KEY>"; // optional
```

Allow the app ID on your player license. Do not commit key values. Check playback,
live seeking, expired-position recovery, and remote-control input on the target
Fire TV device; the pure tests and a simulator run do not replace those checks.
