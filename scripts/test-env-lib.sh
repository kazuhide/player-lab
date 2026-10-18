#!/usr/bin/env bash
# Self-test for the config machinery: scripts/env-lib.sh loader semantics and
# scripts/sync-env.sh generation/merge behavior. Runs in `pnpm verify`; needs no
# credentials, no network — everything happens in a temp dir with fixtures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# ── env-lib: precedence, quoting, hygiene ───────────────────────────────────
cat > "$TMP/a.env" <<'EOF'
PLAIN=plain value
DQ="double quoted"
SQ='single quoted'
INNER=say "hi"
EMPTYQ=""
  INDENTED=indented ok
# COMMENT=skipped
BAD KEY=skipped
NOEXPAND=$(reject) `reject` $HOME
OVERRIDE=from-file
EOF
cat > "$TMP/b.conf" <<'EOF'
PLAIN=conf must lose to a.env
CONFONLY=conf value
EOF

(
  # subshell: keep the test's exports out of the outer run
  . "$ROOT/scripts/env-lib.sh"
  export OVERRIDE=from-env
  load_env_defaults "$TMP/a.env" "$TMP/b.conf"
  [ "$PLAIN" = "plain value" ]        || fail "PLAIN: [$PLAIN]"
  [ "$DQ" = "double quoted" ]         || fail "double quotes not stripped: [$DQ]"
  [ "$SQ" = "single quoted" ]         || fail "single quotes not stripped: [$SQ]"
  [ "$INNER" = 'say "hi"' ]           || fail "inner quotes must survive: [$INNER]"
  [ "$EMPTYQ" = "" ]                  || fail "EMPTYQ: [$EMPTYQ]"
  [ "$INDENTED" = "indented ok" ]     || fail "indented line skipped: [${INDENTED:-}]"
  [ -z "${COMMENT+x}" ]               || fail "comment leaked"
  [ -z "${BAD+x}" ]                   || fail "malformed key leaked"
  [ "$NOEXPAND" = '$(reject) `reject` $HOME' ] || fail "value was shell-expanded: [$NOEXPAND]"
  [ "$OVERRIDE" = "from-env" ]        || fail "environment must beat the file: [$OVERRIDE]"
  [ "$CONFONLY" = "conf value" ]      || fail "CONFONLY: [$CONFONLY]"
  # set-but-empty counts as set: the file must not fill it in
  export EMPTYSET=
  printf 'EMPTYSET=filled\n' > "$TMP/c.env"
  load_env_defaults "$TMP/c.env"
  [ "$EMPTYSET" = "" ]                || fail "set-but-empty was overridden: [$EMPTYSET]"
)
echo "ok  env-lib: precedence + quote-strip + literal values + hygiene"

# ── sync-env: generation, merge, idempotency (isolated fake repo) ───────────
FAKE="$TMP/repo"
mkdir -p "$FAKE/scripts" "$FAKE/apps/ios" "$FAKE/apps/android" "$FAKE/apps/react-native"
cp "$ROOT/scripts/env-lib.sh" "$ROOT/scripts/sync-env.sh" "$FAKE/scripts/"
printf 'BITMOVIN_PLAYER_LICENSE_KEY="quoted-player-key"\nBITMOVIN_ANALYTICS_LICENSE_KEY=analytics-key\n' > "$TMP/fixture.env"
# pre-existing local.properties whose sdk.dir must survive the merge
printf 'sdk.dir=/opt/android-sdk\nbitmovinLicenseKey=stale\n' > "$FAKE/apps/android/local.properties"

run_sync() { (cd "$FAKE" && ENV_FILE="$TMP/fixture.env" bash scripts/sync-env.sh >/dev/null); }
run_sync && run_sync   # twice: idempotency

grep -q '^BITMOVIN_PLAYER_LICENSE_KEY = quoted-player-key$' "$FAKE/apps/ios/Local.xcconfig" \
  || fail "ios xcconfig wrong (quotes must be stripped)"
LP="$FAKE/apps/android/local.properties"
[ "$(grep -c '^bitmovinLicenseKey=' "$LP")" = 1 ]            || fail "local.properties: duplicated key"
grep -q '^bitmovinLicenseKey=quoted-player-key$' "$LP"        || fail "local.properties: stale key survived"
grep -q '^sdk.dir=/opt/android-sdk$' "$LP"                    || fail "local.properties: sdk.dir lost"
grep -q '^EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY=analytics-key$' "$FAKE/apps/react-native/.env" \
  || fail "rn .env wrong"
echo "ok  sync-env: generation + merge keeps sdk.dir + idempotent"

echo "env-lib/sync-env self-test passed"
