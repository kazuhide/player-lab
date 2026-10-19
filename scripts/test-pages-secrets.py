#!/usr/bin/env python3
"""Check the artifact scanner's SDK exception without weakening key detection."""

import argparse
from pathlib import Path
import secrets
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gitleaks', default='gitleaks')
    args = parser.parse_args()
    version = subprocess.run([args.gitleaks, 'version'], check=True, capture_output=True, text=True)
    if version.stdout.strip() != '8.30.1':
        raise SystemExit('Gitleaks 8.30.1 is required.')
    config = Path(__file__).with_name('gitleaks-pages.toml').resolve()
    with tempfile.TemporaryDirectory(prefix='pages-scanner-') as temporary:
        root = Path(temporary)
        asset = root / 'web/assets/main-abcdefgh.js'
        asset.parent.mkdir(parents=True)
        declaration = 'r.' + 'getEncryptionKey=' + 'r.' + 'getAllEncryptionKeys=void 0;'

        def scan(text, expected):
            asset.write_text(text, encoding='utf-8')
            result = subprocess.run(
                [args.gitleaks, 'dir', str(root), '--config', str(config), '--no-banner', '--redact=100'],
                capture_output=True,
            )
            if result.returncode != expected:
                raise SystemExit('Pages secret-scanner regression failed; no matched values shown.')

        scan(declaration, 0)
        # A real-looking synthetic key on the same line must still fail.
        scan(declaration + 'const api_key="' + secrets.token_hex(24) + '";', 1)
        # The declaration must not suppress an assigned string in its own slot.
        scan('r.getEncryptionKey="' + secrets.token_hex(24) + '";', 1)
    print('Pages secret-scanner checks passed (SDK declaration and two injected-key cases).')


if __name__ == '__main__':
    main()
