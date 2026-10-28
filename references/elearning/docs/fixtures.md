# Learning media fixtures

The supplied lessons are self-authored number-line videos with HLS, DASH,
subtitles and timed transcripts. This page covers preparing and delivering the
media. See [Android setup](../README.md#configure-and-run-android) for application
licenses and [the implementation guide](implementation.md) for Player integration.

## Generate and serve

Run these commands from `references/elearning`. Use Python 3.9 or later on
macOS or Linux, FFmpeg with the `drawtext` filter, and `ffprobe`. The helper uses
only the Python standard library. It does not read license keys or call cloud
services.

On macOS, an installed Homebrew `ffmpeg-full` build can be selected with:

```sh
export FFMPEG_BIN="$(brew --prefix ffmpeg-full)/bin/ffmpeg"
export FFPROBE_BIN="$(brew --prefix ffmpeg-full)/bin/ffprobe"
```

Otherwise, `ffmpeg` and `ffprobe` are read from `PATH`; the same variables can
select other compatible executables. Check that the selected FFmpeg lists
`drawtext` in `-filters` before generating.

```sh
python3 tools/media/media.py generate
python3 tools/media/media.py verify
python3 tools/media/media.py serve --port 8621
```

`generate` creates the media under `fixtures/generated/`, which is excluded
from Git. It uses at most two encoders, reduces that count on smaller CPUs, and
caps each encoder at two codec threads. The picture size stays 640 × 360 at
25 frames per second. Audio is AAC at 48 kHz; HLS and DASH use fragmented MP4
with approximately two-second segments and a possible shorter final segment.

`verify` checks sampled boundaries of edited assets. This course has no edited
assets, so it reports zero checks; that is not a playback or full-media
validation result. Each generated asset has its own `receipt.json` with its
source SHA-256 and probed track/container durations.

For a short generation check, use `generate --asset EDU-FX-03`. Other lessons
remain unavailable until generated. `--asset` is repeatable. Complete generation
before starting the publisher, and restart the publisher after replacing media.
Stop it with Ctrl-C.

## Lessons and catalog

| Lesson ID | Requested duration | Captions |
| --- | --- | --- |
| `EDU-FX-01` | 3 minutes | English and Japanese |
| `EDU-FX-02` | 13 minutes; resume checkpoint at 12:34 | English and Japanese |
| `EDU-FX-03` | 8 seconds | None |

[`media-spec.json`](../fixtures/media-spec.json) defines generation inputs.
[`catalog.json`](../fixtures/catalog.json) defines the course, ordered lesson
IDs, stable Analytics video IDs, relative delivery paths and checkpoint.
Android bundles this catalog and the transcripts at build time; it does not
download an alternate catalog from the media server. Rebuild after changing
them.

The checked-in catalog marks its durations as `expected`. The publisher's
`/catalog.json` reports verified video duration in `durationMs`, the request in
`expectedDurationMs`, and container duration in `measuredDurationMs`. A missing
or mismatched generated-file receipt leaves actual timing unknown. The Android
course continues to use its bundled catalog.

The current [probe record](../fixtures/local-media-validation.json) describes
the recorded local generation, including file identities. Its successful
generation/probing does not establish device playback or cloud delivery.
Regeneration produces new receipts and may change measured durations and hashes.

## Captions and transcripts

`fixtures/transcripts/<ID>.json` is the canonical cue list. Each cue has
`startMs`, `endMs`, `text` and `language`; times are integer milliseconds.
Generation derives the language-specific JSON and WebVTT files from those
cues. The fixture tests check that their text and timestamps agree.

The catalog exposes two HLS choices:

| Field | Playlist | Caption delivery |
| --- | --- | --- |
| `streams.hls` | `<ID>/hls/media.m3u8` | The app attaches the catalog's external WebVTT tracks. |
| `streams.hlsWithSubtitles` | `<ID>/hls/master.m3u8` | The manifest registers the subtitle tracks; the app does not attach them again. |

Choose caption delivery before opening the course. DASH uses the external
tracks. The summary intentionally has no tracks. The separate malformed and
overlapping WebVTT examples are error/comparison fixtures, not normal lessons.

The recorded AAC packets contain 1,024 samples at 48 kHz, about 21.33 ms per
packet. Requested duration, video duration, audio duration and container
duration are therefore recorded separately rather than assumed identical.
Subtitle cue boundaries remain the canonical millisecond values; they are not
rounded to media-segment boundaries.

## Reach the publisher

| Client | Media base |
| --- | --- |
| Browser on the development computer | `http://127.0.0.1:8621/` |
| Android emulator | `http://10.0.2.2:8621/` |
| Physical device | A reachable HTTPS origin forwarding the same paths to the publisher |

Set `MEDIA_BASE_URL` in `android/.env`, including its trailing slash, then rebuild.
The publisher binds to loopback; changing the URL to a LAN address alone does
not expose it. A development HTTPS reverse proxy can forward your chosen origin
to `http://127.0.0.1:8621/`. Keep manifests, segments and subtitles reachable from
the device. Use a certificate the device trusts.

The local helper serves only its fixture routes and has no authentication.
Expose the intended test media, not the repository or private configuration.
For tooling that needs the prepared MP4, use `/prepared/<ID>/source.mp4`;
ordinary playback paths do not expose that source file.

## Use separately prepared media

The local method above has been executed. Cloud preparation is a separate
workflow: see bitovp's public [VOD encoding guide](https://kazuhide.github.io/bitovp/guide/vod-encoding/)
and [API-token setup](https://kazuhide.github.io/bitovp/guide/access-and-administration/).
These links do not imply that a cloud output has passed this reference's checks.

This app accepts relative paths under one `MEDIA_BASE_URL`. It has no
`CATALOG_URL` setting and does not accept absolute or query-bearing paths in its
lesson catalog. To use cloud-prepared media, publish the required layout under
that origin, update this application's catalog/transcript inputs, and rebuild.
Check the resulting HLS/DASH delivery, caption timing and actual duration before
using it as a lesson.

The media CLI takes asset IDs and local publisher options, not account
credentials. Keep tokens, private or signed URLs and storage credentials out
of committed catalogs, receipts, commands and screenshots. Application license
setup remains in the [Android instructions](../README.md#configure-and-run-android).
