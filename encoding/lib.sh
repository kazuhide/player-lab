# Shared helpers for the encoding scripts (test-streams/provision.sh,
# live-dvr/start.sh). Sourced, not executed; requires bash.
#
# Credentials/config convention (docs/SETUP.md):
#   - secrets + account specifics → repo-root .env            (untracked)
#   - non-secret encoding config  → config/encoding.conf      (committed)
#   - storage is resolved by NAME at run time; resource ids are never committed.

# encoding_load_config <repo-root>
# Loads .env + config/encoding.conf as defaults (environment wins) and checks
# the prerequisites every encoding script needs.
encoding_load_config() {
  local root="$1"
  # shellcheck source=scripts/env-lib.sh
  . "$root/scripts/env-lib.sh"
  load_env_defaults "$root/.env" "$root/config/encoding.conf"
  command -v bitmovin >/dev/null 2>&1 || {
    echo "bitmovin CLI not found — install with: npm install -g @bitmovin/cli" >&2
    return 1
  }
  command -v jq >/dev/null 2>&1 || {
    echo "jq not found (used to page the CLI listings) — brew install jq / apt install jq" >&2
    return 1
  }
  : "${BITMOVIN_API_KEY:?BITMOVIN_API_KEY not set (see .env.example / docs/SETUP.md)}"
  # Same default as the python script; config/encoding.conf normally sets it.
  BITMOVIN_OUTPUT_NAME="${BITMOVIN_OUTPUT_NAME:-dvr-showcase-output}"
  # Org-scoped accounts: the python script and the web proxy send
  # BITMOVIN_TENANT_ORG_ID as X-Tenant-Org-Id themselves, but the bitmovin CLI
  # selects its organization via its own `bitmovin config` — surface that gap
  # loudly instead of silently targeting the wrong org.
  if [ -n "${BITMOVIN_TENANT_ORG_ID:-}" ]; then
    echo "note: BITMOVIN_TENANT_ORG_ID is set, but the bitmovin CLI picks its organization" >&2
    echo "      from 'bitmovin config' — make sure the CLI is configured for that same org." >&2
  fi
}

# Extracts the first UUID from stdin. The `|| true` neutralizes ONLY grep's
# no-match exit (so `${VAR:-$(... | encoding_uuid)}` survives `set -o pipefail`
# when a lookup legitimately finds nothing); a failing `bitmovin` CLI still
# surfaces through the resolvers' own empty-result error messages below.
encoding_uuid() {
  grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true
}

# encoding_resolve_output_id
# Echoes the id of the S3 output named $BITMOVIN_OUTPUT_NAME. If it doesn't
# exist yet, creates it from BITMOVIN_OUTPUT_* (.env) — the only step that ever
# touches the raw S3 credentials ("bootstrap once, reference by name").
#
# The lookup pages through the FULL listing (encoding_list_find) — Bitmovin
# does not enforce unique names, and this account keeps the showcase output
# well past the CLI's 25-item first page, so a single-page scan would have
# created a duplicate. `OUTPUT_ID=... provision.sh` / `start.sh` still
# bypasses the lookup entirely. (The raw S3 secret is passed as CLI arguments
# when creating — briefly visible in `ps` on a shared machine — because the
# CLI takes credentials only as flags; it happens once per account.)
# A syntactically valid placeholder id for --no-create dry runs (schema
# validation accepts it; nothing is ever started with it).
ENCODING_PLACEHOLDER_ID="00000000-0000-0000-0000-000000000000"

# Abort a listing walk past this offset — a runaway loop guard, far above any
# real account size we page through.
ENCODING_LIST_MAX_OFFSET=20000

# encoding_list_find <jq-id-selector> -- <bitmovin list cmd...>
# Pages through the full listing (--limit 100/--offset — the CLI's first page
# is only 25, and this account really does keep the showcase output past it),
# fetching each page EXACTLY ONCE and evaluating both the item count and the
# selector on that captured JSON (local jq) — a re-fetch could fail or race a
# listing change and read as "not found", creating a duplicate downstream.
# Echoes the first matching UUID ('' when the listing is exhausted without a
# match); returns 1 on any CLI failure or unparseable page.
encoding_list_find() {
  local selector="$1"; shift
  [ "${1:-}" = "--" ] && shift
  local off=0 page id n
  while :; do
    # stdout only: the CLI writes its error bodies to stdout, while stderr may
    # carry unrelated noise (oclif update notices) that would corrupt the JSON.
    if ! page=$("$@" --json --limit 100 --offset "$off" 2>/dev/null); then
      printf 'lookup failed — bitmovin CLI error (offset %s):\n%.300s\n' "$off" "$page" >&2
      return 1
    fi
    # Require an ARRAY: an error body is a JSON object whose key count would
    # otherwise read as a short page — i.e. "not found" — and reach creation.
    if ! n=$(printf '%s' "$page" | jq -er 'if type=="array" then length else error("not an array") end' 2>/dev/null); then
      printf 'lookup failed — listing page is not a JSON array (offset %s):\n%.300s\n' "$off" "$page" >&2
      return 1
    fi
    # The selector is ours and static — a jq program error is a bug, not a miss.
    if ! id=$(printf '%s' "$page" | jq -r "$selector" 2>/dev/null); then
      printf 'lookup failed — jq selector error (offset %s)\n' "$off" >&2
      return 1
    fi
    id=$(printf '%s' "$id" | encoding_uuid)
    if [ -n "$id" ]; then printf '%s\n' "$id"; return 0; fi
    [ "$n" -lt 100 ] && break
    off=$((off + 100))
    if [ "$off" -gt "$ENCODING_LIST_MAX_OFFSET" ]; then
      printf 'lookup aborted — walked past offset %s without a match (runaway guard)\n' "$ENCODING_LIST_MAX_OFFSET" >&2
      return 1
    fi
    echo "…still scanning the listing (offset $off)" >&2
  done
  printf '\n'
}

encoding_resolve_output_id() { # [--no-create]
  local no_create="${1:-}" id out
  id=$(encoding_list_find ".[]|select(.name==\"$BITMOVIN_OUTPUT_NAME\").id" -- \
    bitmovin encoding outputs list --type s3) || return 1
  if [ -z "$id" ] && [ "$no_create" = "--no-create" ]; then
    echo "output \"$BITMOVIN_OUTPUT_NAME\" not found — a real run would create it (dry run: placeholder id)" >&2
    printf '%s\n' "$ENCODING_PLACEHOLDER_ID"
    return 0
  fi
  if [ -z "$id" ]; then
    : "${BITMOVIN_OUTPUT_BUCKET:?output \"$BITMOVIN_OUTPUT_NAME\" not found and BITMOVIN_OUTPUT_BUCKET unset — cannot create it (see .env.example)}"
    : "${BITMOVIN_OUTPUT_REGION:?BITMOVIN_OUTPUT_REGION not set}"
    : "${BITMOVIN_OUTPUT_ACCESS_KEY:?BITMOVIN_OUTPUT_ACCESS_KEY not set}"
    : "${BITMOVIN_OUTPUT_SECRET_KEY:?BITMOVIN_OUTPUT_SECRET_KEY not set}"
    echo "output \"$BITMOVIN_OUTPUT_NAME\" not found in the full output listing — creating it (bucket $BITMOVIN_OUTPUT_BUCKET)." >&2
    echo "if it exists already, stop and pass OUTPUT_ID=<uuid> instead." >&2
    if ! out=$(bitmovin encoding outputs create s3 --name "$BITMOVIN_OUTPUT_NAME" \
      --bucket "$BITMOVIN_OUTPUT_BUCKET" --region "$BITMOVIN_OUTPUT_REGION" \
      --access-key "$BITMOVIN_OUTPUT_ACCESS_KEY" --secret-key "$BITMOVIN_OUTPUT_SECRET_KEY" 2>&1); then
      printf 'output creation failed — bitmovin CLI error:\n%s\n' "$out" >&2
      return 1
    fi
    id=$(printf '%s\n' "$out" | encoding_uuid)
  fi
  [ -n "$id" ] || { echo "could not resolve/create the S3 output \"$BITMOVIN_OUTPUT_NAME\" — is the bitmovin CLI authenticated (BITMOVIN_API_KEY)?" >&2; return 1; }
  printf '%s\n' "$id"
}

# encoding_resolve_input_id <host> [--no-create]
# Echoes the id of the HTTPS input for <host>, creating it when missing.
encoding_resolve_input_id() {
  local host="$1" no_create="${2:-}" id out
  # --type https: the resolver CREATES an https input, so only https inputs may
  # satisfy the lookup (a plain-http input for the same host must not match).
  id=$(encoding_list_find ".[]|select(.host==\"$host\").id" -- \
    bitmovin encoding inputs list --type https) || return 1
  if [ -z "$id" ] && [ "$no_create" = "--no-create" ]; then
    echo "HTTPS input for $host not found — a real run would create it (dry run: placeholder id)" >&2
    printf '%s\n' "$ENCODING_PLACEHOLDER_ID"
    return 0
  fi
  if [ -z "$id" ]; then
    echo "creating HTTPS input for $host" >&2
    if ! out=$(bitmovin encoding inputs create https --host "$host" --name "test-streams $host" 2>&1); then
      printf 'input creation failed — bitmovin CLI error:\n%s\n' "$out" >&2
      return 1
    fi
    id=$(printf '%s\n' "$out" | encoding_uuid)
  fi
  [ -n "$id" ] || { echo "could not resolve/create the HTTPS input for $host" >&2; return 1; }
  printf '%s\n' "$id"
}

# encoding_scenario_key <scenario>   e.g. vod-baseline → VOD_BASELINE
encoding_scenario_key() {
  printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_'
}

# encoding_catalog <scenario> <suffix>
# Echoes the catalog value SOURCE_<KEY>_<suffix> ('' when absent).
encoding_catalog() {
  local var="SOURCE_$(encoding_scenario_key "$1")_$2"
  printf '%s\n' "${!var:-}"
}
