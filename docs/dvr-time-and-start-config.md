# DVR time display + start configuration ()

Concrete guidance for three DVR knobs: absolute vs relative time, `startOffset`,
and `minTimeShiftBufferDepth` — what each does, when to use it, and what value to
set. The web control panel implements all three; the native apps follow the same
shapes.

## Absolute vs relative time (`TimeMode`, )

`player.getCurrentTime(mode)` takes a `TimeMode`:

| Mode | Returns | Use it for |
| --- | --- | --- |
| `RelativeTime` (`"relativetime"`) | seconds from the DVR window start at tune-in (live) / 0…duration (VOD) | the **scrubber position** and the **"−Xs behind live"** label |
| `AbsoluteTime` (`"absolutetime"`) | Unix timestamp — from `EXT-X-PROGRAM-DATE-TIME` (live HLS) / `availabilityStartTime` (live DASH) | the **wall-clock "live at HH:MM:SS"** label; **resume / deep-link** into a live event (survives manifest sliding); **multiview / multi-player sync** |

The control panel shows **both** (`time (rel)` and `time (abs/PDT)`).

**Web caveat:** the web SDK declares `TimeMode` but doesn't export the enum at
runtime, so pass the string values (`"relativetime"` / `"absolutetime"`), typed via
`getCurrentTime`'s own signature — see `controlPanel.ts`.

**Absolute time needs PDT in the stream.** Without `EXT-X-PROGRAM-DATE-TIME` (HLS)
or `availabilityStartTime` (DASH), `AbsoluteTime` mirrors relative time and the
panel shows `— (needs PDT)`. To emit it from the **encode**, enable PDT on the live
HLS manifest (`insertProgramDateTime` / `programDateTimeSettings` in the Encoding
Templates schema) — add this to `encoding/live-dvr/template.yaml` before running
the DVR-live channel.

## `startOffset` — start behind the live edge

`SourceConfig.options.startOffset` + `startOffsetTimelineReference`, applied on
(re)load:

```ts
player.load({
  hls: liveUrl,
  options: {
    startOffset: -20,                          // 20s …
    startOffsetTimelineReference: "end",       // … behind the live edge (default for live)
  },
});
```

- **Live:** negative offset + `End` → start N seconds behind the edge. Use for a
  "join behind live" UX, or to land inside the DVR window for a demo.
- **VOD:** positive offset + `Start` (the default) → start N seconds in.

The control panel's **"Reload at offset"** reloads the current source this way
(`-20` by default). `startOffset` does **not** fire a `Seek` event.

## `minTimeShiftBufferDepth` — when DVR turns on

`SourceConfig` live config's `minTimeShiftBufferDepth` (seconds): timeshift stays
disabled until at least this much buffer has accumulated, so `getMaxTimeShift()`
returns `0` until the window is deep enough.

```ts
player.load({
  hls: liveUrl,
  options: { startOffset: -20, startOffsetTimelineReference: "end" },
  // require ~30s of window before exposing DVR controls
  // (SourceLiveConfig) minTimeShiftBufferDepth: 30,
});
```

- **When:** avoid showing a tiny, jumpy DVR window right at tune-in; gate the DVR
  UI until the window is usable.
- **Value:** a fraction of the configured window — e.g. `30` for a 300s window. Too
  high delays DVR availability; `0` (default) exposes it as soon as any window
  exists.
