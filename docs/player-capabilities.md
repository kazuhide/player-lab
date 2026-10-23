# Player capabilities — Picture-in-Picture, Casting, VR/360

How each capability behaves, when its toggle should be shown, and how it's wired.
The web control panel implements PiP; Casting and VR are documented (they need a
cast sender / a 360 source the showcase doesn't ship).

## Picture-in-Picture — implemented

Toggle in the panel ("Toggle Picture-in-Picture"):

```ts
const inPip = player.getViewMode() === ViewMode.PictureInPicture;
player.setViewMode(inPip ? ViewMode.Inline : ViewMode.PictureInPicture);
```

- **Behavior:** detaches the video into a floating OS window; playback (incl. DVR
  seeking) continues. Exits back to `Inline`.
- **Show the toggle when:** the browser supports it (most do). You can gate on
  `document.pictureInPictureEnabled` and hide otherwise; the player emits
  `PictureInPictureEnter` / `PictureInPictureExit`.

## Casting (Chromecast / AirPlay) — documented

Opt in via `PlayerConfig.remotecontrol`, then drive it from a cast button:

```ts
const config: PlayerConfig = {
  // …
  remotecontrol: { type: "googlecast", receiverApplicationId: "<APP_ID>" },
};
// button handler:
if (player.isCastAvailable()) player.isCasting() ? player.castStop() : player.castVideo();
```

- **Behavior:** hands the current source + position to the cast receiver; local
  playback pauses and the player mirrors the remote state via `CastStarted` /
  `CastStopped` / `CastPlaying` events.
- **Show the toggle when:** `player.isCastAvailable()` is true (a receiver is on the
  network) — otherwise **hide** it. AirPlay on Safari/iOS is surfaced by the OS.
- Not wired in the showcase: it needs a registered Chromecast **receiver app id**.

## VR / 360 — documented

For 360° sources, mark the source and use the `vr` API:

```ts
player.load({ hls: url, vr: { startupMode: "headset", contentType: "single" } });
// button handler:
const vr = player.vr;
vr.getViewingDirection();            // current orientation
vr.setViewingDirection({ yaw, pitch, roll });
vr.enableGyroscope() / vr.disableGyroscope();
```

- **Behavior:** renders the equirectangular video on a sphere; drag / gyroscope
  changes the viewing direction; cardboard mode splits the view for a headset.
- **Show the toggle when:** the loaded source is a 360 source (`SourceConfig.vr`
  present) — otherwise **hide** it; a flat stream has no VR controls.
- Not wired in Player Lab: it needs a 360° source, which is not bundled.

## Toggle-visibility summary

| Toggle | Show when | Hide when |
| --- | --- | --- |
| Picture-in-Picture | browser supports PiP | unsupported (rare) |
| Cast | `player.isCastAvailable()` | no receiver on the network |
| VR | loaded source is 360 (`SourceConfig.vr`) | flat source |
