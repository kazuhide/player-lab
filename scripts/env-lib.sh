# Shared dotenv-style loader for the repo's shell tooling. Sourced, not executed.
# Requires bash (indirect ${!name} expansion).
#
# Precedence (the repo-wide rule, see docs/SETUP.md):
#   environment > repo-root .env > config/encoding.conf > script default
#
# load_env_defaults applies files as DEFAULTS: a variable already present in the
# environment is never overwritten, so one-off overrides like
# `SOURCE_HOST=... provision.sh` keep working. Values are taken literally (no
# shell expansion — a hostile-looking value can't execute code), except that ONE
# surrounding quote pair is stripped, matching what dotenv/Vite and the old
# `set -a; . ./.env` both did for KEY="value" lines.
load_env_defaults() { # <file>...
  local f line name value
  for f in "$@"; do
    [ -f "$f" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      # Tolerate leading whitespace (the python loader strips it too).
      line="${line#"${line%%[![:space:]]*}"}"
      case "$line" in
        [A-Za-z_]*=*) ;; # KEY=VALUE
        *) continue ;;   # comments, blanks, anything else
      esac
      name="${line%%=*}"
      # Only KEY=... with a well-formed name; skip e.g. "KEY WITH SPACE=".
      [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      value="${line#*=}"
      case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
      esac
      if [ -z "${!name+x}" ]; then
        export "$name=$value"
      fi
    done <"$f"
  done
}
