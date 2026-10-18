# @showcase/ui-shared

Reusable player controls built on `bitmovin-player-ui`, including a seek bar for
rewinding live media, a LIVE button, time labels, and several layouts.
The library's `SeekBar` already handles `isLive()` and `getMaxTimeShift()`, so the
custom controls use those player APIs rather than replacing the seek engine.

## Web use

Create a player without its default UI, build a layout, and include the CSS:

```ts
import { LiveUIFactory } from "@showcase/ui-shared";
import "@showcase/ui-shared/css";

const player = new Player(container, { key, ui: false });
const ui = LiveUIFactory.buildLiveUI(player);
```

The module also exports `DefaultUIFactory`, `CinemaUIFactory`, `CompactUIFactory`,
`PremiereUIFactory`, `CreatorUIFactory`, `StudioUIFactory`, `SportsUIFactory`, and
`BingeUIFactory`. It re-exports the player UI library's `UIFactory` and `UIManager`.
These layouts can have different controls and options; see `src/liveUi.ts`.

## Native WebView use

Android, iOS, and React Native integrations can load the generated
`dist/bitmovinplayer-ui.js` and `dist/bitmovinplayer-ui.css`. Configure the host
player's Web UI asset locations and a factory name, such as
`bitmovin.playerui.UIFactory.buildSportsUI`.

The browser-global bundle registers Live, Sports, Cinema, Compact, Premiere,
Creator, and Studio factories alongside the library's stock factories. Binge is
not registered in that bundle: its next-item action requires a callback to the
host app. The module export alone does not provide that native bridge.
The native sample pickers expose Sports, Live, and Cinema in addition to the
default UI; they do not expose every module factory.

tvOS uses its native System UI, and Vega uses Kepler controls. This package is
not used for those interfaces.

## LIVE button

`LiveButton` is on at the live edge and off while behind live. Clicking it calls
`timeShift(0)` to return to live; it is hidden for on-demand media. The pure
`deriveLiveButtonState` function derives its state. The component refreshes that
state on player events, including `TimeChanged` and `TimeShifted`, so changes to
the sliding live window are reflected.

## Develop and verify

From the repository root:

```bash
pnpm --filter @showcase/ui-shared test
pnpm --filter @showcase/ui-shared build
```

The build emits the module (`dist/index.js`), the browser-global WebView bundle
(`dist/bitmovinplayer-ui.js`), and CSS (`dist/bitmovinplayer-ui.css`). To copy the
WebView assets into the native sample directories, run `pnpm sync:webui` after
the build.

Unit tests check state and wiring. Check the layout, button placement, and input
in a browser and each native WebView target; a successful build does not establish
visual or runtime compatibility.
