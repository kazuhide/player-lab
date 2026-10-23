# Encoding — Live DVR test channel

`live-dvr/template.yaml` is the Bitmovin Encoding Template for the live channel
the showcase plays against: a single RTMP ingest, CMAF (fMP4) serving DASH + HLS,
with a **300-second DVR window** for rewinding live playback. The encoder runs
in Tokyo (`cloudRegion: AWS_AP_NORTHEAST_1`).

Rewind settings (under `live.start` in the template):

| Setting | Value | Effect |
| --- | --- | --- |
| `timeshift` | `300` | the player should report `getMaxTimeShift() ≈ -300` |
| `liveEdgeOffset` | `90` | DASH live edge held 90s back from the live point |

At a 4s segment length, a 300s window is 75 segments per rendition — well under
the 54,000 manifest-element limit.

## Prerequisites

- Bitmovin CLI 0.7.0, `jq`, `envsubst`, and a repo-root `.env` with
  `BITMOVIN_API_KEY` + the `BITMOVIN_OUTPUT_*` values (see `.env.example` /
  [the setup instructions](../docs/SETUP.md#4-encoders-test-streams)). The scripts
  load `.env` themselves — no manual `export`. First-use S3 output creation also
  needs the pinned Python SDK from `encoding/requirements.txt`.
- Storage follows the repo rule — **bootstrap once, reference by name**: the S3
  output resource (`BITMOVIN_OUTPUT_NAME` in `config/encoding.conf`, default
  `player-lab-output`) is resolved by name at run time and created
  automatically from `BITMOVIN_OUTPUT_*` the first time a script needs it.
  Multiple exact-name matches stop the run; use a unique name or set `OUTPUT_ID`
  to choose an existing output. S3 credentials are read from the environment
  without passing them as process arguments or enabling SDK request logging.
  Objects are written `PUBLIC_READ` so the player can fetch them (the bucket must
  permit public objects, or be fronted by a CDN / served via signed URLs).

## Run

1. **Validate** — schema + cross-field checks, creates nothing, no cost:
   ```bash
   DRY_RUN=1 encoding/live-dvr/start.sh
   ```
2. **Start** — ⚠️ allocates a live encoder that **bills while it runs**. The
   script resolves the output by name, substitutes it into the template,
   validates, starts, waits for `RUNNING`, and prints the ingest details:
   ```bash
   encoding/live-dvr/start.sh
   ```
3. The stream key is `dvrshowcase`, fixed in the template; re-print the encoder
   IP any time with:
   ```bash
   bitmovin encoding jobs live <encoding-id>
   ```
4. **Push a live source** to the ingest. A test pattern via ffmpeg, bounded with
   `-t` so it self-terminates after the window fills:
   ```bash
   ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 \
          -f lavfi -i sine=frequency=1000 \
          -c:v libx264 -preset veryfast -tune zerolatency -b:v 3M -g 60 \
          -c:a aac -b:a 128k -t 420 \
          -f flv "rtmp://<encoderIp>/live/dvrshowcase"
   ```
5. **Verify** — fetch your output manifest and confirm the DVR window. For DASH,
   check that `timeShiftBufferDepth` represents **300 seconds** (for example,
   `PT5M`). Once enough media has arrived, check that the player reports
   `getMaxTimeShift() ≈ -300` against your running stream.

## Automatic stop conditions

The template sets these `autoShutdownConfiguration` conditions:

- `streamTimeoutMinutes: 10` — stops if no stream arrives within 10 min of start.
- `bytesReadTimeoutSeconds: 30` — stops 30s after ingest bytes stop.

The ffmpeg example also bounds the input with `-t`. Stop the encoder explicitly
after verifying; ending the push is not a replacement for checking encoder status.

## Ingest endpoint

The template uses **dynamic ingest points** (`redundantRtmp.ingestPoints`), so the
push goes to the **encoder IP** from `jobs live`:

```
rtmp://<encoderIp>/live/dvrshowcase
```

The template sets `applicationName: live` and `streamKey: dvrshowcase`. Use the
encoder IP returned for your run; these instructions do not configure a static
ingest endpoint.

## Stop the encoder

```bash
bitmovin encoding jobs stop <encoding-id>
```

## Notes

- The ingest stream key (`dvrshowcase`) is a fixed RTMP stream name in the
  template, not a secret.
- **Wall-clock labels:** DASH uses `availabilityStartTime`. HLS needs
  `EXT-X-PROGRAM-DATE-TIME` to map playback time to a calendar time. Inspect your
  emitted playlist before relying on absolute-time labels.
