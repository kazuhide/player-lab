#!/usr/bin/env bash
# Start the Player Lab live test channel (template.yaml) with the repo's config
# convention: secrets from the repo-root .env, the S3 output resolved by NAME
# (BITMOVIN_OUTPUT_NAME in config/encoding.conf; created from BITMOVIN_OUTPUT_*
# on first use). No ids are ever hand-pasted into the template.
#
#   encoding/live-dvr/start.sh              # validate + start (bills while RUNNING!)
#   DRY_RUN=1 encoding/live-dvr/start.sh    # validate only, creates nothing
#
# The channel carries autoShutdownConfiguration (stream timeout 10 min, bytes-read
# timeout 30 s), so an unattended encoder stops itself; stop it explicitly with:
#   bitmovin encoding jobs stop <encoding-id>
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck source=../lib.sh
. "$ROOT/encoding/lib.sh"
encoding_load_config "$ROOT"

# DRY_RUN may read account listings and validate a template, but never creates
# resources or starts an encoding.
NO_CREATE=""
[ -n "${DRY_RUN:-}" ] && NO_CREATE="--no-create"

OUTPUT_ID="${OUTPUT_ID:-$(encoding_resolve_output_id $NO_CREATE)}"

RENDER="$(mktemp -t live-dvr.XXXXXX)"
trap 'rm -f "$RENDER"' EXIT
OUTPUT_ID="$OUTPUT_ID" envsubst '${OUTPUT_ID}' < "$HERE/template.yaml" > "$RENDER"

echo "validating live-dvr (output=$OUTPUT_ID)"
bitmovin encoding templates validate "$RENDER"

if [ -n "${DRY_RUN:-}" ]; then echo "DRY_RUN — not starting the live encoder."; exit 0; fi

ENC=$(bitmovin encoding templates start "$RENDER" 2>&1 | encoding_uuid)
: "${ENC:?failed to start the live encoding}"
echo "live encoding started: $ENC (bills while RUNNING)"

# Wait until the encoder is up, then print the ingest details.
# `|| true`: an unmatched status (or transient CLI error) must poll again, not
# errexit the script while an encoder bills. `tr`: normalize case for `case`.
# A budget of consecutive unreadable statuses (~10 min) stops the watch from
# spinning forever — with a loud reminder that the encoder may still be billing.
unknown=0
while :; do
  st=$(bitmovin encoding jobs status "$ENC" 2>&1 \
    | grep -ioE 'RUNNING|TRANSFER_ERROR|ERROR|FINISHED|CANCELED|QUEUED|CREATED|STARTING' \
    | head -1 | tr '[:lower:]' '[:upper:]' || true)
  echo "$(date +%T) ${st:-?}"
  case "$st" in
    RUNNING) break ;;
    ERROR|TRANSFER_ERROR) echo "live encoder failed ($st) — see: bitmovin encoding jobs status $ENC" >&2; exit 1 ;;
    FINISHED|CANCELED) echo "encoder reached $st before RUNNING — see: bitmovin encoding jobs status $ENC" >&2; exit 1 ;;
    "") unknown=$((unknown + 1))
        if [ "$unknown" -ge 40 ]; then
          echo "no readable status after $unknown polls — stopping the watch. THE ENCODER MAY STILL BE RUNNING AND BILLING:" >&2
          echo "  check: bitmovin encoding jobs status $ENC   stop: bitmovin encoding jobs stop $ENC" >&2
          exit 1
        fi ;;
    *) unknown=0 ;;
  esac
  sleep 15
done

echo
echo "RUNNING. Ingest details (encoder IP; stream key is fixed: dvrshowcase):"
bitmovin encoding jobs live "$ENC" || true
echo
echo "Push a bounded test pattern (see encoding/README.md for the full command):"
echo "  ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=1000 \\"
echo "         -c:v libx264 -preset veryfast -tune zerolatency -b:v 3M -g 60 -c:a aac -b:a 128k \\"
echo "         -t 420 -f flv \"rtmp://<encoderIp>/live/dvrshowcase\""
echo
echo "Manifests (once the window fills):"
echo "  HLS:  https://${BITMOVIN_OUTPUT_BUCKET:-<bucket>}.s3.${BITMOVIN_OUTPUT_REGION:-<region>}.amazonaws.com/live/player-lab/main.m3u8"
echo "  DASH: https://${BITMOVIN_OUTPUT_BUCKET:-<bucket>}.s3.${BITMOVIN_OUTPUT_REGION:-<region>}.amazonaws.com/live/player-lab/main.mpd"
echo
echo "Stop billing:  bitmovin encoding jobs stop $ENC"
