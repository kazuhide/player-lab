#!/usr/bin/env bash
# Build the existing Web app without local environment files or account media.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo 'Usage: bash scripts/build-pages.sh MEDIA_DIR OUTPUT_DIR MANIFEST' >&2
  exit 2
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
notice_dir="$(mktemp -d)"
trap 'rm -rf "$notice_dir"' EXIT

pnpm --filter @showcase/web build:pages

python3 - "$notice_dir" <<'PY'
from pathlib import Path
import json
import shutil
import sys

target = Path(sys.argv[1])
sdk = Path('apps/web/node_modules/bitmovin-player')
metadata = json.loads((sdk / 'package.json').read_text(encoding='utf-8'))
entry = (sdk / metadata['main']).read_text(encoding='utf-8')
if not entry.startswith('/*') or 'Bitmovin Proprietary Software' not in entry[:1000]:
    raise SystemExit('The Player SDK distribution notice could not be identified.')
banner = entry[:entry.index('*/') + 2]
shutil.copyfile('LICENSE', target / 'PROJECT-LICENSE.txt')
shutil.copyfile('packages/ui-shared/node_modules/bitmovin-player-ui/LICENSE',
                target / 'BITMOVIN-PLAYER-UI-LICENSE.txt')
shutil.copyfile(sdk / 'THIRD_PARTY_NOTICES', target / 'BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt')
(target / 'BITMOVIN-PLAYER-NOTICE.txt').write_text(
    f'Bitmovin Player Web SDK {metadata["version"]}\n\n{banner}\n\n'
    'The project MIT license does not apply to this SDK.\n'
    'Use requires the applicable Bitmovin license and terms.\n'
    'https://legal.bitmovin.com/legal/terms\n', encoding='utf-8')
PY

python3 scripts/package-pages.py \
  --site-dir site --web-dir apps/web/dist --notices-dir "$notice_dir" \
  --media-dir "$1" --output-dir "$2" --manifest "$3"
