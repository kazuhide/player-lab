#!/usr/bin/env python3
"""Read the product version and check or generate its application metadata."""
import argparse
import html
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
SHA = re.compile(r'[0-9a-f]{40}')
REPOSITORY = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*')
BUILD_MARKER = '<!-- PLAYER_LAB_BUILD -->'
JSON_TARGETS = {
    'apps/web/package.json': ('version',),
    'apps/react-native/package.json': ('version',),
    'apps/react-native/expo/package.json': ('version',),
    'apps/react-native/expo/app.json': ('expo', 'version'),
    'apps/vega/package.json': ('version',),
}
TEXT_TARGETS = {
    'apps/ios/project.yml': re.compile(r'^    MARKETING_VERSION: "([^"]+)"$', re.MULTILINE),
    'apps/android/app/build.gradle.kts': re.compile(r'^        versionName = "([^"]+)"$', re.MULTILINE),
    'apps/vega/manifest.toml': re.compile(r'^version = "([^"]+)"$', re.MULTILINE),
}


def require_version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError('The product version must be a canonical MAJOR.MINOR.PATCH version.')
    return value


def product_version(repo=ROOT):
    return require_version(json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version'])


def source_sha(repo=ROOT, env=None, *, allow_unknown=False):
    env = os.environ if env is None else env
    value = env.get('GITHUB_SHA')
    if value is not None:
        if not SHA.fullmatch(value):
            raise ValueError('GITHUB_SHA must be an exact lowercase commit SHA.')
        return value
    result = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--verify', 'HEAD^{commit}'],
                            capture_output=True, text=True)
    value = result.stdout.strip()
    if result.returncode == 0 and SHA.fullmatch(value):
        return value
    if allow_unknown:
        return None
    raise ValueError('An exact source SHA is required. Use a Git checkout or set GITHUB_SHA.')


def sync_versions(repo=ROOT, *, write=False):
    version, updates = product_version(repo), {}
    apple = plistlib.loads((repo / 'apps/ios/Showcase/Info.plist').read_bytes())
    if apple.get('CFBundleShortVersionString') != '$(MARKETING_VERSION)':
        raise ValueError('The Apple bundle version must use MARKETING_VERSION.')
    for name, keys in JSON_TARGETS.items():
        path = repo / name
        document = json.loads(path.read_text(encoding='utf-8'))
        target = document
        for key in keys[:-1]:
            target = target[key]
        if keys[-1] not in target:
            raise ValueError('An application version declaration is missing: ' + name)
        if target[keys[-1]] != version:
            target[keys[-1]] = version
            updates[name] = json.dumps(document, ensure_ascii=False, indent=2) + '\n'
    for name, pattern in TEXT_TARGETS.items():
        text = (repo / name).read_text(encoding='utf-8')
        matches = list(pattern.finditer(text))
        if len(matches) != 1:
            raise ValueError('An application version declaration is missing or ambiguous: ' + name)
        match = matches[0]
        if match.group(1) != version:
            updates[name] = text[:match.start(1)] + version + text[match.end(1):]
    if updates and not write:
        raise ValueError('Application version differs from root package.json: ' + ', '.join(sorted(updates)))
    for name, text in updates.items():
        (repo / name).write_text(text, encoding='utf-8')
    return sorted(updates)


def positive_integer(value, label):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]*', value):
        raise ValueError(label + ' must be a positive integer.')
    return int(value)


def ci_metadata(repo=ROOT, env=None):
    env = os.environ if env is None else env
    repository = env.get('GITHUB_REPOSITORY', '')
    if not REPOSITORY.fullmatch(repository):
        raise ValueError('GITHUB_REPOSITORY must identify this workflow repository.')
    return {
        'schemaVersion': 1,
        'productVersion': product_version(repo),
        'sha': source_sha(repo, env),
        'repository': repository,
        'ciRunId': positive_integer(env.get('GITHUB_RUN_ID'), 'GITHUB_RUN_ID'),
        'ciRunAttempt': positive_integer(env.get('GITHUB_RUN_ATTEMPT'), 'GITHUB_RUN_ATTEMPT'),
        'workflowPath': '.github/workflows/ci.yml',
        'base': '/player-lab/web/',
        'publicPlayerKeyConfigured': bool(env.get('PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY', '').strip()),
        'publicAnalyticsKeyConfigured': bool(env.get('PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY', '').strip()),
    }


def build_label(version, sha):
    require_version(version)
    if sha is not None and (not isinstance(sha, str) or not SHA.fullmatch(sha)):
        raise ValueError('The build label requires an exact source SHA.')
    source = ('<a href="https://github.com/kazuhide/player-lab/commit/' + sha + '"><code>'
              + sha[:7] + '</code></a>') if sha else 'source archive'
    revision = html.escape(sha or '', quote=True)
    return ('<p class="product-build" data-product-version="' + html.escape(version, quote=True)
            + '" data-source-revision="' + revision + '">Player Lab v' + html.escape(version)
            + ' · ' + source + '</p>')


def stamp_html(text, version, sha):
    if text.count(BUILD_MARKER) != 1:
        raise ValueError('Each HTML page must contain exactly one build marker.')
    return text.replace(BUILD_MARKER, build_label(version, sha))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check')
    commands.add_parser('sync')
    metadata = commands.add_parser('metadata')
    metadata.add_argument('--allow-unknown-sha', action='store_true')
    ci = commands.add_parser('ci-metadata')
    ci.add_argument('--output', type=Path, required=True)
    stamp = commands.add_parser('stamp')
    stamp.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        if args.command in {'check', 'sync'}:
            changed = sync_versions(repo, write=args.command == 'sync')
            print('Product version ' + product_version(repo) + ': '
                  + (str(len(changed)) + ' derived values synchronized.' if changed else 'all application values match.'))
        elif args.command == 'metadata':
            version = product_version(repo)
            sha = source_sha(repo, allow_unknown=args.allow_unknown_sha)
            print(json.dumps({'productVersion': version, 'sha': sha, 'labelHtml': build_label(version, sha)}))
        elif args.command == 'ci-metadata':
            with args.output.open('x', encoding='utf-8') as writer:
                json.dump(ci_metadata(repo), writer, indent=2, sort_keys=True)
                writer.write('\n')
            print('Wrote product version and CI identity without license key values.')
        elif args.command == 'stamp':
            directory = args.directory.resolve(strict=True)
            files = sorted(directory.rglob('*.html'))
            if not files or any(path.is_symlink() or not path.is_file() for path in files):
                raise ValueError('Build stamping requires regular HTML pages.')
            version, sha = product_version(repo), source_sha(repo)
            updates = [(path, stamp_html(path.read_text(encoding='utf-8'), version, sha)) for path in files]
            for path, text in updates:
                path.write_text(text, encoding='utf-8')
            print('Stamped ' + str(len(files)) + ' HTML pages with the product version and source SHA.')
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, 'Product version check failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
