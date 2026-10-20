#!/usr/bin/env python3
"""Check official SDK channels or compare two extracted declaration inventories."""
import argparse
import json
from pathlib import Path
import subprocess

from sdk_updates import UpdateError, api_delta, inspect_releases, release_markdown


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--markdown', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--candidate', type=Path)
    args = parser.parse_args()
    try:
        if bool(args.baseline) != bool(args.candidate):
            raise UpdateError('Supply both baseline and candidate inventories.')
        if args.baseline and args.markdown:
            raise UpdateError('Markdown requires a release-channel report.')
        if args.baseline:
            data = api_delta(json.loads(args.baseline.read_text()), json.loads(args.candidate.read_text()))
        else:
            revision = subprocess.check_output(['git', '-C', str(args.repo), 'rev-parse', 'HEAD'], text=True).strip()
            coverage = json.loads((args.repo / 'docs/api-coverage/coverage.json').read_text())
            data = inspect_releases(coverage, revision)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        if args.markdown:
            args.markdown.write_text(release_markdown(data), encoding='utf-8')
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'SDK update check failed: ' + str(error) + '\n')
    if isinstance(data, dict):
        for row in data['sdks']:
            print(row['id'] + ': ' + row['currentVersion'] + ' -> ' + row['latestVersion'])
    else:
        print('Compared public declaration inventories for ' + str(len(data)) + ' SDKs.')


if __name__ == '__main__':
    main()
