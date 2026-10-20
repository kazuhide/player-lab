# Test the existing Web features with local media

Generate a small, public fixture to check the existing player without a cloud
account. The fixture is a 60-second excerpt of *Big Buck Bunny*, with two H.264
video sizes (320×180 and 640×360), AAC audio, HLS and DASH manifests, sprite
thumbnails and a separate subtitle file. The cloud templates remain available
for testing the Encoding API itself.

The multi-audio HLS preset also contains English and German subtitle renditions.
Each has thirty two-second WebVTT segments with generated test text, allowing
native HLS clients to select subtitles without a separate application API. A
zero-based `X-TIMESTAMP-MAP` relates cue times to the media timeline. These cues
identify the selected language; they are not translations of the film dialogue.

## Run the checks

Install FFmpeg with `libx264` and `aac` encoders, `ffprobe`, Python 3 and `curl`,
then install the workspace dependencies. From the repository root:

```bash
python3 encoding/test-streams/local.py
E2E_MEDIA_DIR=.cache/test-streams pnpm --filter @showcase/e2e e2e:features
```

The generator downloads the 121 MB source archive from Blender, verifies its
pinned SHA-256 checksum, and writes media under `.cache/`. Generated media and
the download are ignored by Git. One decode supplies both video renditions and
the sprite image. Decoder, filter and video encoder pools use at most four
threads each, reduced for the available CPU allocation and estimated reclaimable
memory; audio and image encoders use one thread each. The fixed 360p/180p ladder
uses a two-second frame-queue estimate and reserves half the available memory
when choosing parallelism. This estimate does not impose an RSS limit. Unknown
memory availability selects one thread per pool. `fixture-report.json` records
the detected resources and chosen budget. Large intermediate raw frames are not
written to disk. HLS and DASH reuse the same fragmented MP4 segments, and feature
playlists reuse those files.

The test runner starts local media, player-harness and application servers,
uses a CPU/memory-based worker budget of one to four with zero retries, and
stops its servers afterward. Set `E2E_WORKERS=1` to reduce concurrency. Performance
measurements use their separate single-worker configuration.
A 2026-10-21 smoke run of the ten feature checks passed with zero retries in
both modes: 20.31 s with one worker and 11.51 s with the adaptive budget's two
workers, including server startup and the shared-UI build. Sampled peak summed
process-tree RSS was 2.43 GB and 3.70 GB respectively. This was one run per mode
while native qualification also ran; it is an execution/resource record rather
than a controlled speedup comparison. Shared pages may be counted more than
once in that RSS sum. See [the individual results](web-performance-results.json).
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
generator contract checks passed all sixteen cases, and workspace type-checking
and production builds passed. The fixture was encoded with FFmpeg 9.0.2.
These results cover this browser and local media, not native devices or the
cloud templates. Encoder versions and platforms can produce different bytes;
`fixture-report.json` records the version and measured timing for each run.

On 2026-10-21, all 25 generator contract checks and fresh media generation passed
on macOS with FFmpeg 9.0.2. In an idle-host comparison with the same verified
archive, fresh output directories, one warmup per version and three alternating
pairs, median generation time fell from 1.389 s to 1.146 s and child CPU time
from 6.093 s to 5.694 s. Peak child RSS rose from 74.65 MB to 77.41 MB. Encoded
segments, manifests, feature playlists, subtitle files and the sprite image were
identical, apart from generated HLS program-date-time values and the report's
resource measurements. These measurements describe this fixed fixture on this
host; resource estimates and encoder versions can change the results.

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

### FFprobe version differences at the final audio sample

The same generated audio bytes produce different final-packet measurements in
FFprobe 6.1.1 and 9.0.2. In the observed Ubuntu 24.04 output, the final MP4
track-run box (`trun`) stores a duration of 512 samples. FFprobe 6.1.1 reports
a full 1,024-sample frame instead, giving a packet end of 60.010666 s;
FFprobe 9.0.2 reports the stored partial duration and ends at 60.000000 s.
Both report the same initial 1,024 skip samples and 60.021333 s container
duration. The MOV demuxers differ in their handling of stored sample durations;
see [version 6.1.1](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavformat/mov.c#L9018)
and [version 9.0.2](https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/libavformat/mov.c#L11683).

The tool therefore reads the AAC tail's stored duration from its generated
single-track MP4 fragment. It preserves the raw probe result separately as
`probe_last_packet_end_seconds`, records the stored `last_packet_duration_samples`,
and checks the actual final presentation against sixty seconds with the same
1 ms bound. A genuinely extended audio tail still fails. Truncated boxes and
sample tables fail rather than falling back to an assumed duration. The report
also records the FFprobe version, so differences in measurement remain visible.

Fresh generation passed with FFmpeg/FFprobe 6.1.1-3ubuntu5 on Ubuntu 24.04 and
9.0.2 on macOS. Both outputs stored the same 512-sample tail and presented audio
through 60.000000 s. These checks compare timing, not encoded file checksums.
All ten feature browser checks also passed against the Ubuntu-generated media
in Chrome 155 on macOS: zero retries, one worker, 16.9 seconds.

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
