# Verification test streams — encoding config + `.env`

Config requirements for the encoder-built verification streams (multi-audio,
sprites/thumbnails, HLS I-frame playlist, WebVTT subtitles), and which settings are
`.env`-configurable.

**Structural note:** **sprites and thumbnails** work with the `defaultapi`
generator — the encoder writes the sprite sheet / images + a WebVTT alongside the
output, and the player references that VTT via `SourceConfig.thumbnailTrack`
(independent of the manifest). **I-frame playlist, multi-audio, and subtitles** do
need an **explicit manifest**: the `EXT-X-I-FRAME-STREAM-INF`, `media.audio`, and
`media.subtitles` entries are only emitted when you author the HLS `streams` /
`media` blocks yourself, so those templates are larger than `vod-baseline`.

**Sprite naming gotcha:** with `hTiles`/`vTiles` set, Bitmovin's VTT always
references an indexed sheet (`sprite-0.jpg`), but `spriteName` without the
`%number%` placeholder writes the file literally (`sprite.jpg`) — a mismatch that
404s the scrub preview. Use `spriteName: sprite-%number%.jpg` so the written file
and the VTT reference agree. (`spriteName` must keep a `.jpg`/`.jpeg`/`.png`
extension.)

## Per-stream requirements

| Stream | Encoding config (schema path) | Assets | `.env`-driven |
| --- | --- | --- | --- |
| **Sprites** (scrub preview) | `encodings.<e>.streams.<v>.sprites.<n>`: `width`,`height` (tile px), `distance`+`unit` (SECONDS), `spriteName`,`vttName`,`hTiles`,`vTiles`,`outputs`. Player loads `vttName` as `thumbnailTrack`. | **video only** | sprite tile size + interval (optional) |
| **Thumbnails** (images) | `streams.<v>.thumbnails.<n>`: `width`,`height`,`interval`,`unit`,`pattern`,`positions`,`outputs` | **video only** | interval / size (optional) |
| **iFrame playlist** (trick-play) | **explicit** HLS manifest `streams.<s>.iframe.filename` (emits `EXT-X-I-FRAME-STREAM-INF`) | **video only** | — |
| **Multi-audio** (track switch) | 2+ `configurations.audio.aac.<n>` + 2+ audio `streams` (distinct sources) + fMP4 audio muxings + **explicit** HLS `media.audio.<n>`: `language`,`groupId`,`name`,`isDefault`,`streamId`/`muxingId` | **video + ≥2 audio tracks** | source paths + language codes |
| **Subtitles** (WebVTT) | `encodings.<e>.sidecars.<n>` (`inputId`,`inputPath`,`outputs`) to copy a `.vtt` + **explicit** HLS `media.subtitles.<n>`: `language`,`name`,`uri` | **WebVTT file(s)** | subtitle paths + language codes |

### SubRip (.srt) → WebVTT

`inputs.srt` in the schema is the **SRT *streaming protocol*** (host/port/latency),
**not** SubRip subtitle files. The HLS player needs **WebVTT**, and a `sidecar`
copies a file as-is (no convert). So the Sintel `.srt` must be converted to `.vtt`
(trivial: `WEBVTT` header + `,`→`.` in timestamps) and hosted (e.g. upload the
converted `.vtt` to storage you control, then reference it as a sidecar input).

### Multi-audio: distinct tracks

Two audio *renditions* of one source = ABR, not selectable tracks. For **track
selection** the manifest needs ≥2 audio tracks with different `language`/`name`. Two
ways: (a) a source with embedded multi-language audio, or (b) two audio inputs
(e.g. the Sintel-trailer audio as `en` + a second source as `de`). The showcase uses
(b) since public multi-language single-asset sources are scarce.

## Where the asset locations live (implemented)

The encoding *structure* lives in the committed templates; the **asset
locations** live in the committed test-source catalog,
**`config/encoding.conf`** (`SOURCE_<SCENARIO>_HOST/_PATH`, plus
`SOURCE_<SCENARIO>_AUDIO2_*` for the multi-audio second source) — they are
public URLs, not secrets. Secrets and the account-specific S3 values stay in
the repo-root `.env`. Precedence: environment > `.env` > `config/encoding.conf`
(so `SOURCE_HOST=… INPUT_PATH=… provision.sh <scenario>` remains a one-off
override). See `docs/SETUP.md`.

Second-source requirement: the 2nd
multi-audio source MUST carry an audio stream (verified via ffprobe — the small
`test-videos.co.uk` BBB clips are video-only). Audio-bearing options
(codec/duration): `media.w3.org/2010/05/sintel/trailer.mp4` (h264+aac, 52.2s),
`download.samplelib.com/mp4/sample-30s.mp4` (h264+aac, 30.4s). To avoid a
track/video duration mismatch, align the encode to the shortest source.

Sprite/thumbnail geometry and subtitle assets remain committed in the templates
and `encoding/test-streams/assets/` — they are structure, not account config.

## Available examples and limits

- **Sprites** ✅ `vod-sprites.yaml` — sprite sheet + WebVTT `thumbnailTrack`
  (defaultapi manifests + the `%number%` naming fix).
- **Multi-audio** ✅ `vod-multiaudio.yaml` — HLS-only custom manifest with two
  `media.audio` renditions (en default + de) from **two** inputs (`provision.sh`
  gained `AUDIO2_HOST`/`INPUT_PATH2`). The audio sources differ in length; an HLS
  audio group handles that cleanly where a defaultapi DASH period would not.
- **I-frame playlist** ⛔ blocked — the Encoding Templates API accepts an
  `iframePlaylists` resource but never emits one (verified across fMP4/TS ×
  manifest-level/nested × V2/LEGACY). It needs the direct manifest API
  (`POST …/manifests/hls/streams/{streamId}/iframe`) post-encode, which a template
  can't express. See `encoding/test-streams/README.md`.
- **Subtitles** ✅ — re-timed Sintel `sintel_en.srt` → `.vtt` (cues shifted into the
  clip window), hosted on your storage, loaded **client-side** via `SourceConfig.subtitleTracks`
  (`encoding/test-streams/assets/`). This sideloaded-subtitle path reliably verifies
  the player's list / enable / cue-render behaviour. The encoder can also embed
  subtitles (a `WebVttSidecarFile` sidecar segmented into HLS `media.subtitles`); the
  client-side path was chosen to avoid coupling the test to the sidecar-manifest wiring.
