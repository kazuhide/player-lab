# VOD multi-codec Per-Title → one combined custom DASH/HLS

Three **Per-Title** encodings (H.264 / HEVC / AV1) plus one shared **AAC** track,
combined into a **single multi-codec** DASH (`manifest.mpd`) and HLS (`master.m3u8`).
At playback the player picks the best codec the device supports (AV1/HEVC where
available, H.264 as the universal fallback) from the one manifest.

`multicodec_pertitle.py` implements this workflow in Python. The steps below
explain how the encodings and manifests fit together.

## Why this shape

- **1 codec = 1 job.** Per-Title analysis is per-codec; Bitmovin recommends one
  encoding per codec. So three encodings, run in parallel.
- **Audio rides in the H.264 job.** A separate audio-only encoding would re-download
  the source for nothing. The single AAC track lives in Job A and is referenced once
  from both manifests.
- **The manifest is built in code, post-encoding.** A custom manifest must reference
  concrete `encoding_id` / `stream_id` / `muxing_id`. Per-Title only produces those
  after the encode finishes, and the rendition count is dynamic, so they cannot be
  written ahead of time (no template, no default manifest). Custom manifests can
  combine the output of multiple encodings when generated post-encoding — which is
  exactly what the three-job layout requires.

This is the one hard constraint behind the whole design: **Per-Title + custom manifest
cannot live in a single Encoding Template** — you discover the generated resources via
the API and build the manifest afterwards.

## Workflow

```
INPUT   HTTPS input, resolved/created by host (test-source catalog)
OUTPUT  one S3 output, resolved by NAME (created once from credentials);
        everything under  <BASE>/<RUN>/   (here: test-streams/<scenario>/<RUN>/)

BUILD (create resources, do not start yet)
  Job A "h264":
    cfg   = H264VideoConfiguration(bare, no height/bitrate)      # per-title template
    vS    = Stream(cfg, mode = PER_TITLE_TEMPLATE)
    _     = Fmp4Muxing(vS, out "<BASE>/<RUN>/video/h264/{height}_{bitrate}_{uuid}")
    aCfg  = AacAudioConfiguration(128k)
    aS    = Stream(aCfg, mode = STANDARD)                         # known at build time
    aMux  = Fmp4Muxing(aS, out "<BASE>/<RUN>/audio/aac")          # HOLD aS.id, aMux.id
    start = StartEncodingRequest(perTitle.h264Configuration.autoRepresentations)
  Job B "hevc":  H265VideoConfiguration + PER_TITLE_TEMPLATE + Fmp4Muxing(video/hevc/...)
                 start = perTitle.h265Configuration.autoRepresentations
  Job C "av1" :  Av1VideoConfiguration  + PER_TITLE_TEMPLATE + Fmp4Muxing(video/av1/...)
                 start = perTitle.av1Configuration.autoRepresentations

START + BARRIER
  start all three encodings (parallel); poll status; proceed only when ALL = FINISHED
  (abort the whole run if any = ERROR)

DISCOVERY (per job, only possible after FINISH)
  list all fMP4 muxings of the encoding
  Job A: video muxings = all muxings EXCEPT the held aMux.id
  Job B/C: video muxings = all muxings
  each muxing carries its resolved output_path (placeholders filled) and stream id

CUSTOM DASH (profile ON_DEMAND)
  manifest -> period
  for each job: one VideoAdaptationSet; for each video muxing add an
                Fmp4Representation(TEMPLATE, encoding_id, muxing_id, segment_path)
  one AudioAdaptationSet(lang); add Fmp4Representation for the AAC muxing
  start manifest; poll to FINISHED

CUSTOM HLS
  manifest
  one AudioMediaInfo(group_id="audio-aac", encoding_id, stream_id, muxing_id, uri, segment_path)
  for each job: for each video muxing add a
                StreamInfo(audio="audio-aac", encoding_id, stream_id, muxing_id, uri, segment_path)
  start manifest; poll to FINISHED

segment_path  = muxing.outputs[0].output_path made RELATIVE to the manifest location
                (the manifest is at <BASE>/<RUN>/, so strip that prefix). Always read
                it back from the muxing — never reconstruct it, Per-Title resolved it.
```

### Bitmovin SDK calls

| Step | Resource / call |
| --- | --- |
| Per-Title video stream | `Stream(mode = PER_TITLE_TEMPLATE)` |
| Per-Title start | `StartEncodingRequest(per_title = PerTitle(<codec>_configuration = <Codec>PerTitleConfiguration(auto_representations = AutoRepresentation())))` |
| Video configs | `H264VideoConfiguration`, `H265VideoConfiguration`, `Av1VideoConfiguration` |
| Muxing (one stream each) | `Fmp4Muxing` → `encodings.muxings.fmp4.create` |
| Discover renditions | `encodings.muxings.fmp4.list(encoding_id)` (paginate) |
| DASH | `manifests.dash.create` → `…periods.create` → `…adaptationsets.video/audio.create` → `…representations.fmp4.create` → `…dash.start` |
| HLS | `manifests.hls.create` → `…media.audio.create` (group) → `…streams.create` (variants) → `…hls.start` |
| Representation type | `DashFmp4Representation(type_ = DashRepresentationType.TEMPLATE, …)` |

## Run

Configuration follows the repo convention (`docs/SETUP.md`): the script loads the
repo-root `.env` (`BITMOVIN_API_KEY`, `BITMOVIN_OUTPUT_*`, optionally
`BITMOVIN_TENANT_ORG_ID`) and `config/encoding.conf` (the
`SOURCE_VOD_MULTICODEC_PERTITLE_HOST/_PATH` test source and
`BITMOVIN_OUTPUT_NAME`) itself — environment variables override both. The S3
output is resolved **by exact name** across all pages and created only if missing.
Multiple outputs with that name stop the run before any encoding is created or
started; choose a unique `BITMOVIN_OUTPUT_NAME` or set `OUTPUT_ID` to an existing
output ID. The HTTPS input is resolved/created by host. Keep account IDs in local
configuration rather than committing them.

```bash
# Activate the Python environment from docs/SETUP.md first.
python3 -m pip install -r encoding/requirements.txt

# resolved plan only — no API calls, no cost:
DRY_RUN=1 python3 encoding/vod-multicodec-pertitle/multicodec_pertitle.py

# real run (3 encodes + 2 manifests):
python3 encoding/vod-multicodec-pertitle/multicodec_pertitle.py
```

Output lands under `test-streams/vod-multicodec-pertitle/<RUN>/` on your configured
S3 output (the provisioning layout plus a directory for each run), and the final public
URLs are printed when `BITMOVIN_OUTPUT_BUCKET/_REGION` are set.

Starting encodings incurs cost. AV1 Per-Title in particular is slow/expensive — test
with a short clip first.

## Verify on first run

- **Multi-codec really combined:** the `.mpd` should show three video `AdaptationSet`s
  (H.264, HEVC, AV1) plus one audio set; the HLS master should list three codec variant
  groups sharing the one `audio-aac` group.
- **Rendition discovery:** confirm `fmp4.list` returns the expected Per-Title renditions
  per job using the API or dashboard.
- **HLS codecs:** HEVC and AV1 require fMP4 (CMAF) in HLS — all muxings here are fMP4, so
  the `CODECS` attribute is computed correctly by the API.
- **Configuration checks:** each fMP4 muxing holds
  exactly one stream (true by construction); the AV1 min-bitrate floor is waived under
  Per-Title; encoding-mode uniformity is per-job (not cross-codec) since the jobs are
  separate.

## Notes

- This script does not configure encrypted output.
- Per-Title min/max bitrate or a fixed-resolution HD anchor can be added per job; if you
  add anchors, mind the per-title bitrate step-size rules.
