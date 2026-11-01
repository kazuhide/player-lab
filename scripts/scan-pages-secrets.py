#!/usr/bin/env python3
"""Scan a Pages release while distinguishing its explicit public client licenses."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

PUBLIC_LICENSES = (
    ('PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY', '(?:main|comparisonRunner)'),
    ('PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY', 'main'),
)


def literal_regex(value):
    # Go's regexp.QuoteMeta characters; configuration values are never regex syntax.
    return '^' + ''.join('\\' + char if char in '\\.+*?()|[]{}^$' else char for char in value) + '$'


def scan(artifact, gitleaks):
    version = subprocess.run([gitleaks, 'version'], check=True, capture_output=True, text=True, timeout=30)
    if version.stdout.strip() != '8.30.1':
        raise ValueError('Unexpected scanner version.')
    artifact = artifact.resolve(strict=True)
    if not artifact.is_dir():
        raise ValueError('The artifact must be a directory.')
    config = Path(__file__).with_name('gitleaks-pages.toml').read_text(encoding='utf-8')
    for name, entry in PUBLIC_LICENSES:
        value = os.environ.get(name, '')
        if value:
            config += '\n[[allowlists]]\n' + '\n'.join([
                'description = "Explicit public client license"',
                'targetRules = ["generic-api-key"]',
                'condition = "AND"',
                "paths = ['''(?:^|/)web/assets/" + entry + "-[A-Za-z0-9_-]{8,}\\.js$''']",
                'regexTarget = "secret"',
                'regexes = [' + json.dumps(literal_regex(value)) + ']',
            ]) + '\n'
    with tempfile.TemporaryDirectory(prefix='pages-secret-scan-') as temporary:
        work = Path(temporary)
        if work.resolve().is_relative_to(artifact):
            raise ValueError('Scanner settings must be outside the artifact.')
        settings = work / 'scanner.toml'
        descriptor = os.open(settings, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as writer:
            writer.write(config)
        report = work / 'report.json'
        result = subprocess.run([
            gitleaks, 'dir', str(artifact), '--config', str(settings), '--no-banner',
            '--redact=100', '--report-format', 'json', '--report-path', str(report),
        ], capture_output=True, timeout=120)
        if result.returncode not in (0, 1):
            raise ValueError('The scanner did not complete.')
        findings = json.loads(report.read_text(encoding='utf-8'))
        if not isinstance(findings, list) or (bool(findings) != bool(result.returncode)):
            raise ValueError('The scanner returned an invalid result.')
        if findings:
            print(f'Pages artifact secret scan failed ({len(findings)} findings; values withheld).')
            return 1
    print('Pages artifact secret scan passed.')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-dir', required=True, type=Path)
    parser.add_argument('--gitleaks', default='gitleaks')
    args = parser.parse_args()
    try:
        return scan(args.artifact_dir, args.gitleaks)
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Pages artifact secret scan could not complete; values withheld.')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
