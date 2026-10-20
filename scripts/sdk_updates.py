"""Inspect public SDK release channels without changing runtime coverage claims."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import json
import re
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


class UpdateError(ValueError):
    pass


SOURCES = {
    'web': ('stable', 'https://registry.npmjs.org/bitmovin-player/latest'),
    'web-ui': ('stable', 'https://registry.npmjs.org/bitmovin-player-ui/latest'),
    'react-native': ('stable-wrapper', 'https://registry.npmjs.org/bitmovin-player-react-native/latest'),
    'apple': ('stable', 'https://api.github.com/repos/bitmovin/player-ios/tags?per_page=100'),
    'android': ('stable', 'https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/player-core/maven-metadata.xml'),
    'vega': ('vega-supported-beta', 'https://raw.githubusercontent.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/main/package.json'),
}
STABLE = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\Z')
VEGA = re.compile(r'8\.138\.0-beta\.(0|[1-9]\d*)\Z')


def managed_update_prs(rows):
    """Preserve same-repository update drafts targeting the main branch."""
    return [row for row in rows if not row['isCrossRepository'] and row['baseRefName'] == 'main'
            and row['headRefName'].startswith('automation/player-sdk-update-')]


def version_key(value, sdk_id):
    pattern = VEGA if sdk_id == 'vega' else STABLE
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise UpdateError('Invalid version for the selected SDK channel: ' + sdk_id)
    return tuple(map(int, pattern.fullmatch(value).groups()))


def fetch_public(url):
    request = Request(url, headers={'User-Agent': 'player-lab-sdk-updates', 'Accept': 'application/json, application/xml;q=0.9'})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise UpdateError('Public release metadata request failed.')
        body = response.read(2_000_001)
    if not body or len(body) > 2_000_000:
        raise UpdateError('Public release metadata exceeded its size bound or was empty.')
    return body


def latest_version(sdk_id, body):
    try:
        if sdk_id == 'android':
            values = [node.text for node in ET.fromstring(body).findall('./versioning/versions/version')
                      if node.text and STABLE.fullmatch(node.text)]
            value = max(values, key=lambda item: version_key(item, sdk_id))
        elif sdk_id == 'apple':
            values = [tag['name'].removeprefix('v') for tag in json.loads(body)
                      if isinstance(tag, dict) and isinstance(tag.get('name'), str)
                      and STABLE.fullmatch(tag['name'].removeprefix('v'))]
            value = max(values, key=lambda item: version_key(item, sdk_id))
        elif sdk_id == 'vega':
            value = json.loads(body)['dependencies']['bitmovin-player']
        else:
            value = json.loads(body)['version']
        version_key(value, sdk_id)
        return value
    except (ValueError, KeyError, TypeError, AttributeError, ET.ParseError) as error:
        raise UpdateError('Invalid or missing release metadata: ' + sdk_id) from error


def inspect_releases(coverage, revision, fetch=fetch_public):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise UpdateError('A complete source revision is required.')
    sdks = {sdk['id']: sdk for sdk in coverage['sdks']}
    if set(sdks) != set(SOURCES) or len(sdks) != len(coverage['sdks']):
        raise UpdateError('Release channels differ from the coverage SDK inventory.')

    def inspect(sdk_id):
        channel, url = SOURCES[sdk_id]
        sdk = sdks[sdk_id]
        if sdk['channel'] != channel:
            raise UpdateError('SDK channel mismatch: ' + sdk_id)
        current = sdk['version']
        version_key(current, sdk_id)
        body = fetch(url)
        latest = latest_version(sdk_id, body)
        if version_key(latest, sdk_id) < version_key(current, sdk_id):
            raise UpdateError('Release metadata is older than the installed SDK: ' + sdk_id)
        return {'id': sdk_id, 'channel': channel, 'currentVersion': current,
                'latestVersion': latest, 'updateAvailable': latest != current,
                'source': url, 'metadataSha256': sha256(body).hexdigest()}

    # Release endpoints are independent. Bound concurrency independently of CPU count.
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(inspect, SOURCES))
    return {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'sourceRevision': revision, 'sdks': rows,
            'updateAvailable': any(row['updateAvailable'] for row in rows)}


def api_delta(before, after):
    """Compare extracted members; declaration hashes remain in the full artifacts."""
    old = {item['id']: item for item in before}
    new = {item['id']: item for item in after}
    if set(old) != set(new) or len(old) != len(before) or len(new) != len(after):
        raise UpdateError('Candidate and baseline SDK inventories differ.')
    result = []
    for sdk_id in sorted(old):
        for inventory in (old[sdk_id], new[sdk_id]):
            if inventory.get('diagnostics'):
                raise UpdateError('SDK declaration diagnostics must be resolved: ' + sdk_id)
        a = {row['id']: row for row in old[sdk_id]['rows']}
        b = {row['id']: row for row in new[sdk_id]['rows']}
        if len(a) != len(old[sdk_id]['rows']) or len(b) != len(new[sdk_id]['rows']):
            raise UpdateError('Duplicate extracted API member.')
        facts = ('category', 'scope', 'deprecated', 'kinds', 'types', 'type', 'signatures',
                 'readonly', 'writable', 'value', 'optional', 'contracts', 'indices')
        changed = sorted(key for key in a.keys() & b.keys()
                         if any(a[key].get(fact) != b[key].get(fact) for fact in facts))
        result.append({'id': sdk_id, 'beforeVersion': old[sdk_id]['version'],
                       'afterVersion': new[sdk_id]['version'],
                       'added': sorted(b.keys() - a.keys()), 'removed': sorted(a.keys() - b.keys()),
                       'changed': changed})
    return result


def release_markdown(report, delta=None):
    lines = ['Public release-channel metadata was checked against the pinned SDKs.', '',
             '| SDK | Channel | Installed | Available |', '| --- | --- | --- | --- |']
    for row in report['sdks']:
        lines.append(f"| {row['id']} | {row['channel']} | {row['currentVersion']} | [{row['latestVersion']}]({row['source']}) |")
    if delta is not None:
        lines += ['', 'Extracted public declaration changes:', '',
                  '| SDK | Added | Removed | Changed types or contracts |', '| --- | ---: | ---: | ---: |']
        for row in delta:
            lines.append(f"| {row['id']} | {len(row['added'])} | {len(row['removed'])} | {len(row['changed'])} |")
        lines += ['', 'The full baseline, candidate and member-ID difference are attached to the workflow run.']
    lines += ['', 'Vega follows the official Vega sample channel, independently of the Web stable release.',
              'Native wrapper dependencies follow the wrapper\'s public compatibility requirements.', '',
              'Before merging an SDK update:', '',
              '- Resolve workspace and generated-host locks; preserve version-specific dependency patches.',
              '- Regenerate the public SDK inventory and review existing GUI mappings without automatically increasing coverage.',
              '- Run the existing CI and the affected licensed playback, configuration, UI and lifecycle checks.',
              '- Complete both independent code reviews. Keep the update as a draft until these checks pass.', '']
    return '\n'.join(lines)
