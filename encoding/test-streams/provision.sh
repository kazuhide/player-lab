#!/usr/bin/env bash
# Provision a test stream from templates/<scenario>.yaml via the Bitmovin
# Encoding Templates API. VOD scenarios are one-shot encodes — the output
# persists on the showcase S3 bucket (PUBLIC_READ) and is reused by the E2E suite,
# so there's no ongoing cost.
#
# Config (see docs/SETUP.md):
#   - secrets (BITMOVIN_API_KEY, BITMOVIN_OUTPUT_*)  → repo-root .env
#   - per-scenario test sources + output name        → config/encoding.conf
# Resource ids are resolved from the account at run time (never committed); the
# S3 output is created on first use from BITMOVIN_OUTPUT_* if missing.
#
# Usage:
#   encoding/test-streams/provision.sh vod-baseline        # sources from the catalog
#   DRY_RUN=1 encoding/test-streams/provision.sh vod-hevc  # validate only, no cost
#   SOURCE_HOST=... INPUT_PATH=... provision.sh vod-x      # one-off env override
set -euo pipefail

SCENARIO="${1:?usage: provision.sh <scenario>  (a templates/<scenario>.yaml)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TEMPLATE="$HERE/templates/$SCENARIO.yaml"
[ -f "$TEMPLATE" ] || { echo "no template: $TEMPLATE" >&2; exit 1; }

# shellcheck source=../lib.sh
. "$ROOT/encoding/lib.sh"
encoding_load_config "$ROOT"

# Sources: environment > catalog (config/encoding.conf) > default host.
SOURCE_HOST="${SOURCE_HOST:-$(encoding_catalog "$SCENARIO" HOST)}"
SOURCE_HOST="${SOURCE_HOST:-${SOURCE_DEFAULT_HOST:-test-videos.co.uk}}"
INPUT_PATH="${INPUT_PATH:-$(encoding_catalog "$SCENARIO" PATH)}"
: "${INPUT_PATH:?no source for \"$SCENARIO\" — add SOURCE_$(encoding_scenario_key "$SCENARIO")_PATH to config/encoding.conf or pass INPUT_PATH=}"

# DRY_RUN must not touch the account: lookups only, never creation ("validate
# only, no cost" is a contract, not a suggestion).
NO_CREATE=""
[ -n "${DRY_RUN:-}" ] && NO_CREATE="--no-create"

OUTPUT_ID="${OUTPUT_ID:-$(encoding_resolve_output_id $NO_CREATE)}"
INPUT_ID="${INPUT_ID:-$(encoding_resolve_input_id "$SOURCE_HOST" $NO_CREATE)}"

# Optional 2nd HTTPS input (e.g. multi-audio's distinct 2nd audio source), from
# the catalog or the AUDIO2_HOST/INPUT_PATH2 env overrides. Templates that don't
# use ${INPUT_ID2} are unaffected.
AUDIO2_HOST="${AUDIO2_HOST:-$(encoding_catalog "$SCENARIO" AUDIO2_HOST)}"
INPUT_PATH2="${INPUT_PATH2:-$(encoding_catalog "$SCENARIO" AUDIO2_PATH)}"
if [ -n "${AUDIO2_HOST:-}" ]; then
  : "${INPUT_PATH2:?set INPUT_PATH2 (or SOURCE_…_AUDIO2_PATH) when a 2nd audio host is set}"
  INPUT_ID2="${INPUT_ID2:-$(encoding_resolve_input_id "$AUDIO2_HOST" $NO_CREATE)}"
fi

RENDER="$(mktemp -t "test-streams-$SCENARIO.XXXXXX")"
trap 'rm -f "$RENDER"' EXIT
INPUT_ID="$INPUT_ID" INPUT_PATH="$INPUT_PATH" OUTPUT_ID="$OUTPUT_ID" \
  INPUT_ID2="${INPUT_ID2:-}" INPUT_PATH2="${INPUT_PATH2:-}" \
  envsubst '${INPUT_ID} ${INPUT_PATH} ${OUTPUT_ID} ${INPUT_ID2} ${INPUT_PATH2}' < "$TEMPLATE" > "$RENDER"

echo "validating $SCENARIO (source=$SOURCE_HOST$INPUT_PATH input=$INPUT_ID output=$OUTPUT_ID)"
bitmovin encoding templates validate "$RENDER"

if [ -n "${DRY_RUN:-}" ]; then echo "DRY_RUN — not starting the encode."; exit 0; fi

ENC=$(bitmovin encoding templates start "$RENDER" 2>&1 | encoding_uuid)
: "${ENC:?failed to start encoding}"
echo "encoding started: $ENC"

# `|| true`: an unmatched status (or transient CLI error) must poll again, not
# errexit the script mid-encode. `tr`: normalize case for `case`. A budget of
# consecutive unreadable statuses (~10 min) stops the watch from spinning forever.
unknown=0
while :; do
  st=$(bitmovin encoding jobs status "$ENC" 2>&1 \
    | grep -ioE 'FINISHED|TRANSFER_ERROR|ERROR|CANCELED|RUNNING|QUEUED|CREATED|STARTING|TRANSFERRING' \
    | head -1 | tr '[:lower:]' '[:upper:]' || true)
  echo "$(date +%T) ${st:-?}"
  case "$st" in
    FINISHED) break ;;
    ERROR|CANCELED|TRANSFER_ERROR) echo "encode ${st}: see: bitmovin encoding jobs status $ENC" >&2; exit 1 ;;
    "") unknown=$((unknown + 1))
        if [ "$unknown" -ge 40 ]; then
          echo "no readable status after $unknown polls — stopping the watch (the encode may still run: bitmovin encoding jobs status $ENC)" >&2
          exit 1
        fi ;;
    *) unknown=0 ;;
  esac
  sleep 15
done

BASE="https://${BITMOVIN_OUTPUT_BUCKET}.s3.${BITMOVIN_OUTPUT_REGION}.amazonaws.com/test-streams/$SCENARIO"
echo "FINISHED. Public manifests:"
echo "  HLS:  $BASE/master.m3u8"
echo "  DASH: $BASE/manifest.mpd"
