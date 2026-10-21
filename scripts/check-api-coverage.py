#!/usr/bin/env python3
"""Check versioned public API evidence against app sources and installed SDKs."""
import argparse
from pathlib import Path
import subprocess

from coverage_report import CoverageError, _Repo, _load, check_summary, resolve_versions, validate
from coverage_gaps import validate_gaps
from android_variants import check_android_variant


FACTS = ('id', 'category', 'scope', 'deprecated', 'officialReference')


def require(condition, message):
    if not condition:
        raise CoverageError(message)


def compare_symbols(application, expected):
    rows = {row['id']: row for row in application['rows']}
    require(len(rows) == len(application['rows']), 'Duplicate native API row.')
    require(set(rows) == {row['id'] for row in expected},
            'Native SDK inventory differs: ' + application['id'])
    for symbol in expected:
        row = rows[symbol['id']]
        require(all(row[key] == symbol[key] for key in FACTS),
                'Native SDK member facts differ: ' + symbol['id'])
        for proof in symbol.get('evidence', []):
            require(proof in row['evidence'], 'Native SDK provenance differs: ' + symbol['id'])


def check_native(data, directory):
    applications = {app['id']: app for app in data['applications']}
    versions = {sdk['id']: sdk['version'] for sdk in data['sdks']}
    apple = _load(directory / 'apple/sdk-symbols.json')
    manifest = _load(directory.parents[1] / 'scripts/api-coverage/apple/docc-manifest.json')
    require(manifest['version'] == versions['apple'], 'Apple SDK snapshot version differs.')
    require(len({row['id'] for row in apple}) == len(apple), 'Duplicate Apple SDK symbol.')
    for app_id, platform in (('ios', 'iOS'), ('tvos', 'tvOS')):
        require(applications[app_id]['sdkId'] == 'apple',
                'Native application SDK binding differs: ' + app_id)
        require(applications[app_id]['platform'] == platform,
                'Native application platform differs: ' + app_id)
        expected = [row for row in apple if platform in row['platforms']]
        compare_symbols(applications[app_id], expected)
    for row in apple:
        for proof in row['evidence']:
            checksum = manifest['files'].get(proof['file'])
            require(proof['package'] == manifest['package'] and proof['version'] == versions['apple']
                    and isinstance(checksum, dict) and checksum.get('sha256') == proof['sha256'],
                    'Apple SDK manifest provenance differs.')
    android = _load(directory / 'android/sdk-symbols.json')
    sources = _load(directory / 'android/sources.json')
    require(android['sdkId'] == 'android' and android['version'] == sources['version'] == versions['android'],
            'Android SDK snapshot version differs.')
    require(len({row['id'] for row in android['rows']}) == len(android['rows']), 'Duplicate Android SDK symbol.')
    require(all(row['officialReference'].startswith(sources['officialDokkaBase']) for row in android['rows']),
            'Android member reference differs from its versioned SDK source.')
    require(applications['android']['sdkId'] == 'android',
            'Native application SDK binding differs: android')
    require(applications['android']['platform'] == 'Android',
            'Native application platform differs: android')
    compare_symbols(applications['android'], android['rows'])


def check(repo, directory):
    data = _load(directory / 'coverage.json')
    bindings = _load(directory / 'bindings.json')
    inventory = _load(directory / 'inventory.json')
    versions = resolve_versions(repo, data['sourceRevision'], bindings)
    validate(data, repo, versions=versions, inventory_ids=inventory)
    check_native(data, directory)
    check_android_variant(data, directory, _Repo(repo, data["sourceRevision"]).read("apps/android/app/build.gradle.kts").decode())
    check_summary(data, _load(directory / 'summary.json'))
    validate_gaps(_load(directory / 'gaps.json'), data)
    subprocess.run(['node', str(repo / 'scripts/api-coverage/extract-installed.cjs'),
                    '--repo', str(repo), '--check', str(directory / 'coverage.json')], check=True)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--data-dir', type=Path)
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        directory = (args.data_dir or repo / 'docs/api-coverage').resolve()
        data = check(repo, directory)
    except (CoverageError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'API coverage check failed: ' + str(error) + '\n')
    print('PASS: versions, native snapshots, installed declarations, app evidence and summary; '
          + str(len(data['applications'])) + ' applications, '
          + str(sum(len(app['rows']) for app in data['applications'])) + ' API rows.')


if __name__ == '__main__':
    main()
