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

python3 scripts/check-api-coverage.py
pnpm --filter @showcase/web build:pages

python3 - "$notice_dir" <<'PY'
from pathlib import Path
import json
import re
import shutil
import sys

target = Path(sys.argv[1]) / 'notices'
target.mkdir()

def sdk_path(sdk, name):
    root = sdk.resolve(strict=True)
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('SDK distribution material must stay inside its package.')
    return path

def sdk_bytes(sdk, name):
    with sdk_path(sdk, name).open('rb') as reader:
        data = reader.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024 or not data.strip() or b'\0' in data:
        raise ValueError('SDK distribution material must be bounded, nonempty text.')
    data.decode('utf-8')
    return data

def metadata(sdk):
    value = json.loads(sdk_bytes(sdk, 'package.json'))
    if not isinstance(value.get('version'), str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?', value['version']):
        raise ValueError('The SDK package version is invalid.')
    return value

def distribution_banner(sdk, name, marker):
    with sdk_path(sdk, name).open('rb') as reader:
        prefix = reader.read(8192)
    end = prefix.find(b'*/')
    if not prefix.startswith(b'/*') or end < 0 or marker not in prefix[:1000]:
        raise ValueError('The SDK distribution notice could not be identified.')
    return prefix[:end + 2].decode('utf-8')

def legal_inventory(sdk, expected):
    names = {'LICENSE', 'LICENSE.TXT', 'LICENSE.MD', 'NOTICE', 'NOTICE.TXT', 'THIRD_PARTY_NOTICES'}
    actual = {path.relative_to(sdk).as_posix() for path in sdk.rglob('*')
              if path.is_file() and path.name.upper() in names}
    if actual != expected:
        raise ValueError('The SDK legal-file inventory changed; review the shipped material before distribution.')

sdk = Path('apps/web/node_modules/bitmovin-player')
version = metadata(sdk)
banner = distribution_banner(sdk, version['main'], b'Bitmovin Proprietary Software')
shutil.copyfile('LICENSE', target / 'PROJECT-LICENSE.txt')
(target / 'BITMOVIN-PLAYER-UI-LICENSE.txt').write_bytes(
    sdk_bytes(Path('packages/ui-shared/node_modules/bitmovin-player-ui'), 'LICENSE'))
(target / 'BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt').write_bytes(sdk_bytes(sdk, 'THIRD_PARTY_NOTICES'))
(target / 'BITMOVIN-PLAYER-NOTICE.txt').write_text(
    f'Bitmovin Player Web SDK {version["version"]}\n\n{banner}\n\n'
    'The project MIT license does not apply to this SDK.\n'
    'Use requires the applicable Bitmovin license and terms.\n'
    'https://legal.bitmovin.com/legal/terms\n', encoding='utf-8')

webx = Path('apps/web/node_modules/@bitmovin/player-web-x')
webx_version = metadata(webx)['version']
legal_inventory(webx, set())
webx_banner = distribution_banner(webx, 'bundles/playerx-hls.js', b'proprietary property of Bitmovin')
if f'Version {webx_version}' not in webx_banner:
    raise ValueError('The native Web X banner does not match its package version.')
(target / 'BITMOVIN-PLAYER-WEB-X-NOTICE.txt').write_text(
    f'Bitmovin Player Web X SDK {webx_version}\n\n{webx_banner}\n\n'
    'The project MIT license does not apply to this SDK.\n'
    'Use requires the applicable Bitmovin license agreement.\n'
    'https://legal.bitmovin.com/legal/terms\n\n'
    'This public npm package supplies no standalone license or third-party notice files.\n', encoding='utf-8')

hls = Path('apps/web/node_modules/hls.js')
shaka = Path('apps/web/node_modules/shaka-player')
for package in [hls, shaka]:
    if metadata(package).get('license') != 'Apache-2.0':
        raise ValueError('The comparison SDK license declaration changed; review its distribution material.')
legal_inventory(hls, {'LICENSE'})
shaka_files = {'third_party/language-mapping-list/LICENSE', 'third_party/cml-cmcd/LICENSE', 'third_party/cml-cmcd/NOTICE'}
legal_inventory(shaka, {'LICENSE'} | shaka_files)
(target / 'HLS-JS-LICENSE.txt').write_bytes(sdk_bytes(hls, 'LICENSE'))
(target / 'SHAKA-PLAYER-LICENSE.txt').write_bytes(sdk_bytes(shaka, 'LICENSE'))
third_party = [f'Shaka Player {metadata(shaka)["version"]}: bundled third-party licenses and notices\n\n'.encode()]
for name in sorted(shaka_files):
    third_party.extend([f'{name}\n\n'.encode(), sdk_bytes(shaka, name), b'\n\n'])
(target / 'SHAKA-PLAYER-THIRD-PARTY-NOTICES.txt').write_bytes(b''.join(third_party))
PY

python3 scripts/build-user-guide.py --content-dir docs/guide --output-dir "$notice_dir/guide"

python3 - "$notice_dir" <<'PY'
from pathlib import Path
import shutil
import sys
shutil.copytree('site', Path(sys.argv[1]) / 'site', symlinks=True)
PY
python3 scripts/product_version.py stamp --directory "$notice_dir/site"
python3 scripts/product_version.py stamp --directory "$notice_dir/guide"

python3 scripts/package-pages.py \
  --site-dir "$notice_dir/site" --web-dir apps/web/dist --notices-dir "$notice_dir/notices" \
  --guide-dir "$notice_dir/guide" \
  --media-dir "$1" --output-dir "$2" --manifest "$3"
