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
- `src/ConfigurationPanel.tsx`, `src/configuration.ts`: validated source and
  creation-time playback/buffer/adaptation controls.

## Test and type-check without the Vega toolchain

From the repository root:

```bash
pnpm --filter @showcase/vega test
pnpm --filter @showcase/vega typecheck
```

The type-check includes the actual App, configuration/control panels, video
surface component, tests, rewind logic and modular player wiring against the
installed SDK, React Native and Kepler declarations. `tsconfig.json` binds React
declaration imports to this app's React 18 types; the workspace also contains
React 19 for Expo. This resolves the earlier cross-app `ReactNode`/JSX mismatch
without substituting native component declarations or suppressing errors.
Passing these commands does not establish that the device app builds or plays.

The session tests use delayed Promises with fake media and player objects. They
check source changes during initialization and loading, cleanup ordering, and
the current "Allow DVR" setting. Each session releases its own controller,
player, surface handle, and media object once. A replacement waits for the old
player and media cleanup before installing the global media shim. Late callbacks
from a cancelled session cannot publish controls for a previous source. These
tests do not exercise the Vega runtime, a device video surface, or playback.

The App interaction tests also mount the real App, control panels, video-surface
component, DVR controller and session owner. Native hosts, W3C media and player
creation are mocked at their boundaries. Tests cover draft isolation, validation,
Apply/Reset, direct SDK mapping, preset/source retention and rapid Apply during
initialization or cleanup. The Vega core installs browser globals, so these
App tests mock its event/timeline constants using the published declarations.
Console errors/warnings fail these tests. No TV layout, focus behavior, software
keyboard or playback is qualified by this renderer.

## Configuration controls

Open **Show configuration** to edit a source URL/type (HLS, DASH or progressive
MP4), title, poster URL, signed start offset and timeline reference. The panel
also exposes autoplay, startup mute, separate audio/video forward buffer targets
and a video adaptation bitrate cap. Only HTTP/HTTPS URLs and finite decimal
numbers are accepted. This form requires positive buffer/bitrate targets;
blank omits the overrides. The SDK buffer default is 40 seconds per media type,
and live media windows can constrain the effective buffer. Bitrates are in bits
per second. Format/engine/device support still requires target-device testing.

**Apply and recreate player** validates the entire draft, releases the previous
session and creates a player that loads the selected source from its start
offset. Playback position is reset. Unchanged/invalid input does not replace
resources. **Reset draft** only restores applied values. Preset buttons continue
to select sources immediately and replace draft source fields while preserving
unapplied player-setting edits. Selected/custom source fields, logs and the
**Allow DVR** helper setting survive Apply. The same React video component keeps
the cleanup barrier, so rapid configuration changes cannot bypass the prior
media/player teardown or publish callbacks from a retired owner.

`ui:false` stays fixed because the HTML Player UI is unavailable on Vega. Source
title/poster values are passed in the SDK source configuration; this Kepler screen does
not add a poster-artwork renderer. There is no loop configuration in this
published SDK surface. **Allow DVR** remains an application helper, separate
from `PlayerConfig.playback.timeShift`.

The direct editable mappings are:

| GUI control | Public SDK configuration |
| --- | --- |
| URL / type | One of `SourceConfig.hls`, `.dash`, `.progressive` (string form) |
| Title / poster | `SourceConfig.title`, `.poster` |
| Start offset / reference | `SourceConfig.options.startOffset`, `.startOffsetTimelineReference` |
| Autoplay / startup mute | `PlayerConfig.playback.autoplay`, `.muted` |
| Video / audio forward buffer | `PlayerConfig.buffer.video.forwardduration`, `.audio.forwardduration` |
| Video bitrate cap | `PlayerConfig.adaptation.bitrates.maxSelectableVideoBitrate` |

These paths are checked against the installed public
`bitmovin-player@8.138.0-beta.28/types/core/PlayerConfigAPI.d.ts`. They do not
imply support for the general Web SDK or untested Vega feature parity. A Kepler
build and on-device checks of source playback, buffers/adaptation and remote
editing remain required for runtime qualification.

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
