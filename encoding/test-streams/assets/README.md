# test-stream assets

External assets referenced by the verification streams.

## `sintel_en.vtt`

English subtitles for the subtitle verification stream. Upload the file to your
S3 output (`test-streams/assets/sintel_en.vtt`, `text/vtt`, `PUBLIC_READ`) and
load it client-side via `SourceConfig.subtitleTracks` (Bitmovin's sideloaded-subtitle
path — see `apps/web/src/sources.ts` and `tests/e2e/specs/subtitles.spec.ts`).

**Source & licence:** Blender Foundation's *Sintel* `sintel_en.srt`
(durian.blender.org), CC-BY 3.0.

**Conversion** (SubRip → WebVTT, with a time shift): the original movie subtitles
start at `00:01:47`, past our short (10–52 s) test clips, so every cue is shifted
back ~106.25 s to land the first cue at ~1 s — otherwise nothing displays in-clip.
Reproduce with `encoding/test-streams/assets/srt-to-vtt.py`:

```bash
python3 encoding/test-streams/assets/srt-to-vtt.py sintel_en.srt sintel_en.vtt
```

> The encoder *can* embed subtitles directly (a `WebVttSidecarFile` sidecar that
> segments the VTT into the HLS manifest as `EXT-X-MEDIA:TYPE=SUBTITLES`). We use
> the client-side `subtitleTracks` path instead: it reliably verifies the player's
> subtitle list / enable / cue-render behaviour without coupling the test to the
> encoder's sidecar-manifest wiring.
