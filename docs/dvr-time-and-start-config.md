# DVR time display and start settings

Digital video recorder (DVR) controls let viewers rewind within a live stream's
available window. The Web control panel displays relative and absolute time and
can reload at an offset. Native SDK settings have their own names and units;
they are not all exposed in the Web panel.

## Absolute and relative time (`TimeMode`)

`player.getCurrentTime(mode)` takes a `TimeMode`:

| Mode | Returns | Use it for |
| --- | --- | --- |
| `RelativeTime` (`"relativetime"`) | seconds on the playback timeline | playback position; use `getTimeShift()` for the distance behind the live edge |
| `AbsoluteTime` (`"absolutetime"`) | Unix timestamp when the stream supplies a clock reference | wall-clock display and comparing playback time with the current clock |

The control panel shows **both** (`time (rel)` and `time (abs/PDT)`).

**Web caveat:** the web SDK declares `TimeMode` but doesn't export the enum at
runtime, so pass the string values (`"relativetime"` / `"absolutetime"`), typed via
`getCurrentTime`'s own signature — see `controlPanel.ts`.

Program date time (PDT) maps media time to a clock, for example through
`EXT-X-PROGRAM-DATE-TIME` in an HTTP Live Streaming (HLS) playlist. Dynamic
Adaptive Streaming over HTTP (DASH) uses its manifest timing information.
The panel shows `— (needs PDT)` when it cannot obtain a usable absolute time.
Clock-based latency also depends on the viewer's system clock being accurate.

## `startOffset` — start behind the live edge

`SourceConfig.options.startOffset` applies when loading a source. For live
playback its default reference is the end of the timeline, so a negative value
starts behind the live edge. Given an existing player and a live HLS URL:

```ts
import type { SourceConfig } from "bitmovin-player";

const source: SourceConfig = {
  hls: liveUrl,
  options: {
    startOffset: -20, // Start 20 seconds behind the live edge.
  },
};
await player.load(source);
```

- **Live:** a negative offset with the default end reference starts behind the
  edge, within the available window.
- **Video on demand (VOD):** the default reference is the start. A positive offset
  starts that many seconds into the clip.

The panel's **Reload at offset** uses an explicit end reference (`-20` by
default), including when the selected source is VOD. The example above relies on
the SDK's live default; see [SourceConfigOptions](https://cdn.bitmovin.com/player/web/8/docs/interfaces/core_config.sourceconfigoptions.html)
for explicit timeline references. A start offset configures initial playback;
it is not a call to `seek()`.

## Minimum window depth is platform-specific

The pinned Web SDK has no `minTimeShiftBufferDepth` field in `SourceConfig`, and
the Web panel has no control with that name. Do not paste a native setting into
a Web source configuration.

For example, iOS exposes [`SourceLiveConfig.minTimeshiftBufferDepth`](https://cdn.bitmovin.com/player/ios/3/documentation/bitmovinplayercore/sourceliveconfig/mintimeshiftbufferdepth/index.html)
in platform code. It uses a non-positive offset and defaults to `-40` seconds;
timeshifting remains unavailable until the stream has sufficient depth. It is
not a positive Web option or a setting exposed by this sample's iOS screen.

The DVR window comes from media still advertised by the stream and available
from the origin. The player's forward buffer holds downloaded media ahead of
the playhead. Increasing **Forward buffer** can use more memory and tolerate
network interruptions, but cannot restore expired segments or widen the DVR
window. The panel keeps those values separate for this reason.
