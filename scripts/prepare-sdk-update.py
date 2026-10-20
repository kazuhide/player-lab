#!/usr/bin/env python3
"""Prepare exact dependency pins for a reviewed, draft SDK update pull request."""
import argparse
import json
from pathlib import Path
import re
import subprocess

from sdk_updates import SOURCES, UpdateError, release_markdown, version_key


JSON_PINS = {
    'web': [('apps/web/package.json', 'dependencies', 'bitmovin-player'),
            ('packages/ui-shared/package.json', 'devDependencies', 'bitmovin-player'),
            ('tests/e2e/package.json', 'devDependencies', 'bitmovin-player')],
    'web-ui': [('packages/ui-shared/package.json', 'dependencies', 'bitmovin-player-ui')],
    'react-native': [('apps/react-native/package.json', 'dependencies', 'bitmovin-player-react-native'),
                     ('apps/react-native/expo/package.json', 'dependencies', 'bitmovin-player-react-native')],
    'vega': [('apps/vega/package.json', 'dependencies', 'bitmovin-player')],
}


def candidate_files(repo, report):
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
            text = (repo / file).read_text()
            pattern = r'(?<=com\.bitmovin\.player:player:)' + re.escape(old) + r'(?=")'
            text, count = re.subn(pattern, new, text)
            if count != 1:
                raise UpdateError('Expected one exact Android Player dependency.')
            files[file] = text
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
