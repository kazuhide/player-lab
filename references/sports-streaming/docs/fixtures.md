# Sports media fixtures

[English](fixtures.md) · [日本語](fixtures.ja.md)

The supplied media is self-authored: a baseball diamond, fielders, an animated
pitch and hit, score, elapsed time and UTC label. It supplies live-event playback, clips and archives
without requiring a cloud encoding account. See [Android setup](../README.md#requirements-and-configuration)
and [the implementation guide](implementation.md) for Player and Cast integration.

## Generate and serve

Run these commands from `references/sports-streaming`. Use Python 3.9 or later
on macOS or Linux, FFmpeg with `drawtext`, and `ffprobe`. No additional Python
packages or account credentials are required.

For an installed macOS Homebrew `ffmpeg-full` build:

```sh
export FFMPEG_BIN="$(brew --prefix ffmpeg-full)/bin/ffmpeg"
export FFPROBE_BIN="$(brew --prefix ffmpeg-full)/bin/ffprobe"
```

Otherwise, the helper uses `ffmpeg` and `ffprobe` from `PATH`. Both variables can
select other compatible executables. The selected FFmpeg must list `drawtext`
in `-filters`.

```sh
python3 tools/media/media.py generate
python3 tools/media/media.py verify
python3 tools/media/media.py serve --port 8622 --window 60 --archive-delay 6
```

Complete generation before starting the publisher. It creates ignored files
under `fixtures/generated/`. Encoder concurrency adapts to the CPU, with an
upper bound of two encoders and two codec threads per encoder. Video is H.264,
640 × 360 at 25 frames per second; audio is AAC at 48 kHz. HLS and DASH use
fragmented MP4 and approximately two-second segments.

`verify` compares decoded video-frame hashes at the retained boundaries of the
edited archive. Its receipt binds the checks to the source and output hashes.
It is sampled verification, not an exhaustive frame comparison, device playback
test or cloud-delivery check.

`generate --asset SP-CLIP-A` prepares that clip and any missing source dependency
without generating the long event. `--asset` is repeatable. After changing a
source, regenerate its dependent clips/edited archive as well; a full generation
does this. Restart the publisher after replacing media. Stop it with Ctrl-C.

## Supplied media

| Prepared asset | Requested duration | Source interval |
| --- | --- | --- |
| `SP-ARCH-S` | 3 minutes | Short practice source |
| `SP-ARCH-EVENT` | 30 minutes | Full event source |
| `SP-CLIP-A` | 20 seconds | Short source, 00:30–00:50 |
| `SP-CLIP-B` | 30 seconds | Short source, 01:20–01:50 |
| `SP-ARCH-E` | 2 minutes | Short source, 00:30–01:30 followed by 02:00–03:00 |

`SP-LIVE-S` publishes `SP-ARCH-S` progressively; `SP-LIVE-EVENT` publishes
`SP-ARCH-EVENT`. Publication follows real monotonic elapsed time after server
startup. The events last three and thirty minutes respectively. Archive
readiness is separate; the default delay is six seconds after an event ends.

`--window` sets retention in seconds, from 6 to 7,200. HLS retains at least three
target durations and briefly retains removed files for readers of an earlier
playlist. Future segments are unavailable. Finished playlists retain their
final window and signal completion; they do not become a full-archive URL.
Restarting the server starts another development run, not evidence of a
real-time endurance test.

## Catalog and timing contracts

[`media-spec.json`](../fixtures/media-spec.json) defines prepared assets, cuts
and live aliases. [`catalog.json`](../fixtures/catalog.json) defines events,
asset kinds, stable `sports:SP-*` video IDs, delivery paths and subtitle tracks.
English/Japanese WebVTT derives from each asset's canonical transcript cues.
Sports HLS uses `media.m3u8` with external tracks to avoid registering the same
captions twice; DASH also uses the external tracks.

The checked-in catalog contains expected durations. The publisher's
`/catalog.json` replaces them with verified video duration in `durationMs`;
`expectedDurationMs` retains the request and `measuredDurationMs` records the
container. Missing/mismatched file receipts leave actual timing unknown.

The [local probe record](../fixtures/local-media-validation.json) records
video/audio/container timing separately. Its AAC packets contain 1,024 samples
at 48 kHz, about 21.33 ms per packet. Stream-copy trimming preserves compressed
packet boundaries, so a requested 20-second clip can have a slightly longer
audio/container tail. A tail is not extra verified video content for UTC mapping.
Use each generation's measurements rather than assuming its duration is exact.

Each full source gets a synthetic UTC base when generated. Its literal UTC text
uses FFmpeg's [frame-timestamp `gmtime` expansion](https://ffmpeg.org/ffmpeg-filters.html#Text-expansion),
not a claim about an actual broadcast. Receipts bind `renderUtcStartMs`, render
mode and source hash. A continuous clip inherits the source base plus its trim
offset. An edited archive has no single UTC origin.

The publisher uses the matching backing source's base for HLS program dates,
DASH availability/clock timing and status mappings. `mediaUtcNow` advances with
that synthetic clock; `observedAt` is the real request time. Missing rendered
clock metadata leaves UTC bounds/mappings unknown and live manifests unavailable.
The clock is not replaced with the current wall time.

[`mapping-validation.json`](../fixtures/mapping-validation.json) records the
edited archive's sampled boundary checks. Its UTC intervals are half-open:
`[utcStartMs, utcEndMs)`, mapped to `archiveStartMs`. The current video tail
beyond the verified intervals remains unmapped. Deleted intervals and unknown
positions must not become zero-second handoffs.

`/api/events/<eventId>` reports event/archive states, identity, optional
`archiveMapping`, and `seekableUtcStartMs` / `seekableUtcEndMs`. Bounds come from
complete published HLS/DASH tracks; unknown or ended-event bounds are null.
These values are availability inputs, not proof that a Player or receiver
completed a seek or handoff.

## Device and Cast access

| Client | Media base |
| --- | --- |
| Browser on the development computer | `http://127.0.0.1:8622/` |
| Android emulator | `http://10.0.2.2:8622/` |
| Phone and Cast receiver | The same reachable HTTPS media origin |

Set `MEDIA_BASE_URL` in `android/.env` with a trailing slash and rebuild. A
development HTTPS reverse proxy can forward the origin to
`http://127.0.0.1:8622/`; the helper itself binds only to loopback. Merely changing
the hostname does not expose it on the network.

Both sender and receiver must reach manifests, segments and captions and trust
the TLS certificate. Preserve cross-origin and byte-range responses through
the proxy. A receiver cannot use the phone/emulator's localhost or its USB port
forwarding. The helper has no authentication; expose only the intended fixture
routes. Development tools can fetch prepared MP4 inputs at
`/prepared/<ID>/source.mp4`, which is separate from ordinary live playback paths.

## Separately prepared cloud media

Cloud preparation is separate from the executed local generator.
The public bitovp guides cover [API tokens](https://kazuhide.github.io/bitovp/guide/access-and-administration/),
[VOD encoding](https://kazuhide.github.io/bitovp/guide/vod-encoding/),
[Live encoding](https://kazuhide.github.io/bitovp/guide/live-encoding/), and
[recording / Live-to-VOD](https://kazuhide.github.io/bitovp/guide/programs-and-recording/).
A created job, returned URL or these links alone do not establish verified
playback or receiver compatibility.

`CATALOG_URL` can select an HTTP(S) catalog; otherwise Android requests
`catalog.json` from `MEDIA_BASE_URL` and can fall back to its bundled catalog.
Relative URLs in that catalog resolve against `MEDIA_BASE_URL`, even when the
catalog is hosted elsewhere. The sports catalog also accepts absolute HTTP(S)
delivery URLs without embedded username/password credentials.

An encoder's manifest alone does not provide this app's event-status contract
or verified archive intervals. Supply compatible status/mapping data when
testing live-to-archive behavior, or leave unavailable mappings unknown. The
local publisher remains tied to its generated files; it is not a cloud proxy.

Keep account tokens, storage credentials and private/signed delivery URLs out
of committed catalogs, receipts, command examples and captures. The fixture
CLI accepts no cloud credentials. Application licenses belong in the private
configuration described in [Android setup](../README.md#requirements-and-configuration).
