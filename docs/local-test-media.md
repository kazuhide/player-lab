# Test the existing Web features with local media

Generate a small, public fixture to check the existing player without a cloud
account. The fixture is a 60-second excerpt of *Big Buck Bunny*, with two H.264
video sizes (320×180 and 640×360), AAC audio, HLS and DASH manifests, sprite
thumbnails and a separate subtitle file. The cloud templates remain available
for testing the Encoding API itself.

## Run the checks

Install FFmpeg with `libx264` and `aac` encoders, `ffprobe`, Python 3 and `curl`,
then install the workspace dependencies. From the repository root:

```bash
python3 encoding/test-streams/local.py
E2E_MEDIA_DIR=.cache/test-streams pnpm --filter @showcase/e2e e2e:features
```

The generator downloads the 121 MB source archive from Blender, verifies its
pinned SHA-256 checksum, and writes media under `.cache/`. Generated media and
the download are ignored by Git. Encoding uses up to four threads per stage;
large intermediate raw frames are not written to disk. HLS and DASH reuse the
same fragmented MP4 segments, and feature playlists reuse those files.

The test runner starts local media, player-harness and application servers,
runs one browser worker with zero retries, and stops its servers afterward.
The default ports are 5180, 5174 and 5175. Set `E2E_MEDIA_PORT`,
`E2E_HARNESS_PORT` and `E2E_APP_PORT` to use distinct ports for parallel runs.
Google Chrome must be installed; continuous integration uses Playwright's
Chromium instead. A player key is not required on `localhost`.

An existing output directory is never overwritten. To generate another fixture,
choose a new directory; keep the previous output if you need to compare results:

```bash
python3 encoding/test-streams/local.py --output .cache/test-streams-next
E2E_MEDIA_DIR=.cache/test-streams-next pnpm --filter @showcase/e2e e2e:features
```

`--source-archive` can reuse a previously downloaded copy of the same verified
Blender ZIP file. A different checksum fails before extraction or encoding.

## What is checked

The feature command checks actual HLS and DASH playback, finite duration,
available video qualities, seeking, two audio tracks and switching, subtitle
cue delivery, thumbnail coordinates and image fetching, and the player's HTTP
request callback. Three additional checks use the original Web application's
source buttons, settings menus and seek-bar preview. The application keeps its
14 themes, seven source presets, setting panels and construction-code display.

On 2026-10-19, all ten feature browser checks passed on macOS with Google Chrome
155.0.8059.85 and Node.js 24.19.0: one worker, zero retries, 16.7 seconds. The
generator contract checks passed all five cases, and workspace type-checking
and production builds passed. The fixture was encoded with FFmpeg 9.0.2.
These results cover this browser and local media, not native devices or the
cloud templates. Encoder versions and platforms can produce different bytes;
`fixture-report.json` records the version and measured timing for each run.

The local runner configures the existing optional `VITE_VOD_*` values for the
application. To try the same presets manually, serve the generated directory,
set the URLs in [the Web environment example](../apps/web/.env.example), and
start the Web app. The regular public-reference defaults are unchanged.

The two audio tracks carry the same nonverbal soundtrack at different volumes.
Their `en` and `de` labels are test metadata, not translations. Subtitle checks
use the existing retimed *Sintel* text to verify cue delivery and rendering; it
does not describe *Big Buck Bunny*. Playback tests run muted and do not establish
audible synchronization. This fixture does not verify HEVC, protected content,
casting devices, mobile devices or real cloud encoding.

## Why audio segment times differ from video

The generator places a video keyframe every 48 frames at 24 frames per second.
This produces thirty two-second video segments. AAC audio frames use a different
clock: FFmpeg's AAC encoder groups 1,024 samples and adds 1,024 samples of initial
padding. At 48,000 samples per second, one audio frame lasts about 21.333 ms;
two seconds is 93.75 frames. Audio boundaries therefore cannot all coincide
with the two-second video boundaries. See the
[FFmpeg AAC encoder](https://ffmpeg.org/doxygen/9.0/aacenc_8c_source.html) and
[DASH muxer options](https://ffmpeg.org/ffmpeg-formats.html#dash-2).

The tool keeps the audio packets and their timing information instead of
trimming or duplicating a frame at every segment boundary. It records both
playlist durations and independently inspected packet timing in
`fixture-report.json`. It rejects a video ladder that is not thirty two-second
segments, or encoded packets whose presentation does not end at sixty seconds.
It does not require every audio segment to report exactly two seconds.

With FFmpeg 9.0.2, the generated fixture reported:

| Measurement | Video | Each audio track |
| --- | --- | --- |
| Segments | 30 | 30 |
| Interior segment durations | 2.000000 s | 1.984000–2.005333 s |
| Sum of playlist durations | 60.000000 s | 59.999993 s |
| First packet timestamp | 0 s | −0.021333 s |
| Last packet end | 60.000000 s | 60.000000 s |
| Initial samples to skip | 0 | 1,024 |
| Container duration reported by `ffprobe` | 60.000000 s | 60.021333 s |

The audio container duration includes the initial encoder padding, while its
skip-sample information starts presentation at zero. The rounded playlist
values are a separate measurement. Comparing those durations alone would
misidentify this expected padding as accumulating playback drift.

## Attribution

*Big Buck Bunny*: (c) copyright 2008, Blender Foundation /
www.bigbuckbunny.org. The fixture is a resized 60-second excerpt with an
attenuated alternate audio track and generated thumbnails. The source is
licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/);
see [the project's license information](https://peach.blender.org/about/).
The generator writes attribution beside the output; retain it when sharing
the generated media.

The separate *Sintel* subtitle text is also credited to Blender Foundation
under Creative Commons Attribution 3.0. See the
[subtitle asset details](../encoding/test-streams/assets/README.md) for its
source and timing adjustment.
