# Test streams for end-to-end playback tests

For the existing Web feature checks without a cloud account, use
`python3 encoding/test-streams/local.py` from the repository root. It generates
60-second public *Big Buck Bunny* fixtures with two-second video segments.
See [local test media](../../docs/local-test-media.md) for the browser command,
requirements, attribution and the reason audio boundaries differ from video.
The scripts below continue to exercise the Encoding API itself.

Test streams created via the Bitmovin Encoding Templates API, consumed by
`tests/e2e`. Each `templates/<scenario>.yaml` is a parameterized Encoding Template;
`provision.sh` resolves the account's input/output IDs at run time (never
committed), substitutes them, validates, starts, and polls to `FINISHED`.

## Cost model

- **VOD scenarios** (`vod-*`) are **one-shot** encodes. Once `FINISHED`, the output
  lives in your S3 output (`PUBLIC_READ`) and can be reused by later end-to-end
  test runs. Encoding stops when the job finishes; storage and delivery charges
  can continue. Re-provision when the template or source changes.
- For a continuous live encoder, use the separate
  [Live DVR instructions](../README.md) and stop it after testing.

## Usage

Sources come from the committed catalog in `config/encoding.conf`
(`SOURCE_<SCENARIO>_HOST/_PATH`, incl. the multi-audio 2nd source), secrets from
the repo-root `.env`, and the S3 output is resolved by name — created on first
use from `BITMOVIN_OUTPUT_*`. So a provision run takes **no arguments beyond
the scenario**:

```bash
# Validate only — no encode, no cost:
DRY_RUN=1 encoding/test-streams/provision.sh vod-baseline

# Provision for real (one-shot VOD encode):
encoding/test-streams/provision.sh vod-baseline
# → prints the public HLS/DASH manifest URLs on FINISHED

# One-off override (environment beats the catalog — see docs/SETUP.md):
SOURCE_HOST=download.samplelib.com INPUT_PATH=/mp4/sample-30s.mp4 \
  encoding/test-streams/provision.sh vod-baseline
```

The default host (`SOURCE_DEFAULT_HOST`) is `test-videos.co.uk`. Confirm that your
chosen source is reachable by the encoder. Output URLs follow
`https://<bucket>.s3.<region>.amazonaws.com/test-streams/<scenario>/{master.m3u8,manifest.mpd}`.
Use the URLs printed by your run when configuring the tests in
`tests/e2e/src/streams.ts`. Do not commit your deployment addresses.

## Scenario matrix

| Template or asset | What to verify | Requirements or limits |
| --- | --- | --- |
| `vod-baseline` | H.264 adaptive quality levels, DASH+HLS, finite duration, seek | Provision the template before running the tests. |
| `vod-hevc` | H.265 (`hvc1`) 480p, DASH+HLS | Playback requires HEVC support. |
| `vod-sprites` | WebVTT sprite-sheet `thumbnailTrack`; `getThumbnail` geometry and sheet fetch | Use a source long enough to produce several thumbnails. |
| `vod-multiaudio` | Two selectable audio tracks (en/de) in one HLS group; `getAvailableAudio` and `setAudio` | Both input files must contain audio. The labels do not establish that the soundtracks are translations. |
| Subtitles (client-side) | WebVTT `subtitleTracks`; list, enable, and cue rendering | Upload the [subtitle asset](assets/README.md) separately; no encoder template is needed. |

No `vod-iframe` template is included. A normal HLS master playlist does not provide
an I-frame-only playlist for trick-play; that needs separate manifest generation.

Network-API interception is a player-side feature, but the included test uses
`vod-baseline`. Provision that fixture and configure `VITE_TEST_STREAM_BASE_URL`
before running the test; an unset URL is a missing prerequisite, rather than a
playback result. See [the test setup](../../tests/e2e/README.md).
