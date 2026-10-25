#!/usr/bin/env python3
"""Prepare exact dependency pins for a reviewed, draft SDK update pull request."""
import argparse
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import quote
import xml.etree.ElementTree as ET

from sdk_updates import SOURCES, UpdateError, fetch_public, release_markdown, version_key


JSON_PINS = {
    'web': [('apps/web/package.json', 'dependencies', 'bitmovin-player'),
            ('packages/ui-shared/package.json', 'devDependencies', 'bitmovin-player'),
            ('tests/e2e/package.json', 'devDependencies', 'bitmovin-player')],
    'web-ui': [('packages/ui-shared/package.json', 'dependencies', 'bitmovin-player-ui')],
    'react-native': [('apps/react-native/package.json', 'dependencies', 'bitmovin-player-react-native'),
                     ('apps/react-native/expo/package.json', 'dependencies', 'bitmovin-player-react-native')],
    'vega': [('apps/vega/package.json', 'dependencies', 'bitmovin-player')],
}
ANDROID_ARTIFACTS = ('player', 'player-media-session')
ANDROID_MAVEN = 'https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/'


def android_candidate(text, old, new, fetch):
    """Keep the published standard or relocated-IMA variant paired across modules."""
    pins = {artifact: [] for artifact in ANDROID_ARTIFACTS}
    # Examine string literals, skipping comments and multiline code examples.
    tokens = re.compile(r'//[^\n]*|/\*.*?(?:\*/|\Z)|""".*?"""|"(?:\\.|[^"\\])*"', re.DOTALL)
    for token in tokens.finditer(text):
        literal = token.group()
        if literal.startswith('/*') and (not literal.endswith('*/') or '/*' in literal[2:]):
            raise UpdateError('Unterminated or nested Android Gradle comments require manual review.')
        if literal.startswith('"""') and 'com.bitmovin.player' in literal:
            prefix = tokens.sub(' ', text[:token.start()])
            example = (re.search(r'\bval\s+\w+\s*=\s*$', prefix)
                       and re.match(r'\s*implementation\s*\(', literal[3:-3]))
            if not example:
                raise UpdateError('Raw-string Android managed dependencies require manual review.')
        if literal.startswith('"') and not literal.startswith('"""'):
            try:
                value = json.loads(literal)
            except ValueError:
                value = ''  # Other Kotlin strings can contain escapes outside JSON.
            if (value == 'com.bitmovin.player'
                    or (value.startswith('com.bitmovin.player:') and value != literal[1:-1])):
                raise UpdateError('Nonliteral Android managed dependencies require manual review.')
        pin = re.fullmatch(r'"com\.bitmovin\.player:(player|player-media-session):([^"\r\n]+)"', literal)
        if not pin:
            if re.match(r'"com\.bitmovin\.player:(?:player(?:-media-session)?(?::|")|")', literal):
                raise UpdateError('Ambiguous Android managed dependency requires manual review.')
            continue
        start = text.rfind('\n', 0, token.start()) + 1
        end = text.find('\n', token.end())
        end = len(text) if end == -1 else end
        if (not re.fullmatch(r'[ \t]*implementation[ \t]*\([ \t]*', text[start:token.start()])
                or not re.fullmatch(r'[ \t]*\)[ \t]*(?://[^\r\n]*)?\r?', text[token.end():end])):
            raise UpdateError('Expected a direct Android implementation dependency.')
        pins[pin[1]].append((token.start() + pin.start(2), token.start() + pin.end(2), pin[2]))
    if any(len(pins[artifact]) != 1 for artifact in ANDROID_ARTIFACTS):
        raise UpdateError('Expected one Android Player and one MediaSession dependency.')
    current = pins['player'][0][2]
    if current != pins['player-media-session'][0][2] or current not in (old, old + '+jason'):
        raise UpdateError('Android Player and MediaSession must match the reported version and supported qualifier.')
    target = new + ('+jason' if current.endswith('+jason') else '')
    encoded = quote(target, safe='')
    namespace = '{http://maven.apache.org/POM/4.0.0}'
    for artifact in ANDROID_ARTIFACTS:
        url = f'{ANDROID_MAVEN}{artifact}/{encoded}/{artifact}-{encoded}.pom'
        try:
            pom = ET.fromstring(fetch(url))
        except ET.ParseError as error:
            raise UpdateError('Invalid Android artifact publication: ' + artifact) from error
        expected = {'groupId': 'com.bitmovin.player', 'artifactId': artifact, 'version': target, 'packaging': 'aar'}
        fields = {key: pom.findall(namespace + key) for key in expected}
        if pom.tag != namespace + 'project' or any(
                len(fields[key]) != 1 or len(fields[key][0]) != 0 or fields[key][0].text != value
                for key, value in expected.items()):
            raise UpdateError('Android artifact publication differs from the proposed dependency: ' + artifact)
    for start, end, _ in sorted((pin for values in pins.values() for pin in values), reverse=True):
        text = text[:start] + target + text[end:]
    return text


def candidate_files(repo, report, fetch=fetch_public):
    """Return proposed edits, without writing or changing coverage classifications."""
    if report.get('schemaVersion') != 1:
        raise UpdateError('Unsupported update report schema.')
    rows = {row['id']: row for row in report['sdks']}
    if set(rows) != set(SOURCES) or len(rows) != len(report['sdks']):
        raise UpdateError('Update report SDK inventory differs.')
    files = {}
    for sdk_id, row in rows.items():
        channel, url = SOURCES[sdk_id]
        if row['channel'] != channel or row['source'] != url or not re.fullmatch(r'[0-9a-f]{64}', row['metadataSha256']):
            raise UpdateError('Unrecognized release channel provenance: ' + sdk_id)
        old, new = row['currentVersion'], row['latestVersion']
        if version_key(new, sdk_id) < version_key(old, sdk_id):
            raise UpdateError('SDK downgrades are not prepared automatically.')
        changed = old != new
        if row['updateAvailable'] is not changed:
            raise UpdateError('Update flag differs from the reported versions.')
        if not changed:
            continue
        for file, section, package in JSON_PINS.get(sdk_id, []):
            data = json.loads(files.get(file, (repo / file).read_text()))
            if data[section][package] != old:
                raise UpdateError('Current dependency differs from the report: ' + file)
            data[section][package] = new
            files[file] = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
        if sdk_id == 'android':
            file = 'apps/android/app/build.gradle.kts'
            files[file] = android_candidate((repo / file).read_text(), old, new, fetch)
        elif sdk_id == 'apple':
            file = 'apps/ios/project.yml'
            text, count = re.subn(r'(?<=exactVersion: ")' + re.escape(old) + r'(?=")', new, (repo / file).read_text())
            if count != 1:
                raise UpdateError('Expected one exact Apple Player dependency.')
            # Swift package revisions and transitive pins must be resolved with Xcode;
            # do not invent new commit IDs or reuse old IDs under a new version.
            files[file] = text
    if report['updateAvailable'] is not bool(files):
        raise UpdateError('Overall update flag differs from the proposed edits.')
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--body', required=True, type=Path)
    parser.add_argument('--write', action='store_true', help='Apply the proposed dependency edits; otherwise print paths only.')
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        report = json.loads(args.report.read_text())
        head = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
        if report['sourceRevision'] != head:
            raise UpdateError('Release report belongs to a different source revision.')
        if subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain'], text=True).strip():
            raise UpdateError('Prepare an SDK update in a clean checkout.')
        files = candidate_files(repo, report)
        args.body.parent.mkdir(parents=True, exist_ok=True)
        args.body.write_text(release_markdown(report), encoding='utf-8')
        if args.write:
            for file, text in files.items():
                (repo / file).write_text(text, encoding='utf-8')
        print(('Prepared' if args.write else 'Proposed') + ' dependency edits: ' + str(len(files)))
        for file in sorted(files):
            print(file)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'SDK update preparation failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
