#!/usr/bin/env python3
"""Check the artifact scanner's SDK exception without weakening key detection."""

import argparse
import os
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
    scanner = Path(__file__).with_name('scan-pages-secrets.py').resolve()
    public_player = 'PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY'
    public_analytics = 'PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY'
    # Each synthetic value has balanced entropy, without depending on random frequency.
    def token():
        return ''.join(''.join(secrets.SystemRandom().sample('0123456789abcdef', 16)) for _ in range(3))

    player, analytics, unrelated = token(), token(), token()
    public = {public_player: player, public_analytics: analytics}
    licenses = f'const licenseKey="{player}";const analyticsKey="{analytics}";'
    with tempfile.TemporaryDirectory(prefix='pages-scanner-') as temporary:
        root = Path(temporary) / 'artifact'
        asset = root / 'web/assets/main-abcdefgh.js'
        asset.parent.mkdir(parents=True)
        declaration = 'r.' + 'getEncryptionKey=' + 'r.' + 'getAllEncryptionKeys=void 0;'
        scan_tmp = Path(temporary) / 'scan-tmp'
        scan_tmp.mkdir()
        cases = 0

        def scan(text, expected, values=None, outside=None, *, entry='main-abcdefgh.js'):
            nonlocal cases, asset
            asset.unlink(missing_ok=True)
            asset = root / 'web/assets' / entry
            asset.write_text(text, encoding='utf-8')
            extra = root / 'other.js'
            if outside is None:
                extra.unlink(missing_ok=True)
            else:
                extra.write_text(outside, encoding='utf-8')
            env = dict(os.environ)
            env.pop(public_player, None)
            env.pop(public_analytics, None)
            env.update(values or {})
            env['TMPDIR'] = str(scan_tmp)
            result = subprocess.run(
                ['python3', str(scanner), '--artifact-dir', str(root), '--gitleaks', args.gitleaks],
                env=env, capture_output=True, text=True,
            )
            if (result.returncode != expected or list(scan_tmp.iterdir())
                    or any(value in result.stdout + result.stderr for value in [player, analytics, unrelated])):
                raise SystemExit(f'Pages secret-scanner case {cases + 1} failed (exit {result.returncode}); no matched values shown.')
            cases += 1

        scan(declaration, 0)
        # A real-looking synthetic key on the same line must still fail.
        scan(declaration + f'const api_key="{unrelated}";', 1)
        # The declaration must not suppress an assigned string in its own slot.
        scan(f'r.getEncryptionKey="{unrelated}";', 1)
        scan(licenses, 1)
        scan(licenses, 0, public)
        scan(licenses + f'const api_key="{unrelated}";', 1, public)
        scan(licenses, 1, public, f'const licenseKey="{player}";')
        changed = player[:-1] + ('a' if player[-1] != 'a' else 'b')
        scan(f'const licenseKey="{changed}";', 1, public)
        scan(licenses, 1, {public_player: player})
        scan(licenses, 1, {'BITMOVIN_PLAYER_LICENSE_KEY': player,
                         'VITE_BITMOVIN_ANALYTICS_LICENSE_KEY': analytics})
        scan(f'const api_key="{unrelated}";', 1, {public_player: '.*'})
        dotted = 'k9f4.' + player
        scan(f'const licenseKey="{dotted}";', 1)
        scan(f'const licenseKey="{dotted}";', 0, {public_player: dotted})
        scan(f'const licenseKey="k9f4X{player}";', 1, {public_player: dotted})
        # A public-value exception for generic-api-key cannot silence another detector.
        pat = 'gh' + 'p_' + token()[:36]
        scan(f'const licenseKey="{pat}";', 1, {public_player: pat})
        runner = 'comparisonRunner-abcdefgh.js'
        scan(f'const licenseKey="{player}";', 1, entry=runner)
        scan(f'const licenseKey="{player}";', 0, public, entry=runner)
        scan(f'const licenseKey="{player}";const api_key="{unrelated}";', 1, public, entry=runner)
        scan(f'const analyticsKey="{analytics}";', 1, public, entry=runner)
        scan(f'const licenseKey="{changed}";', 1, public, entry=runner)
        for entry in ['webx-abcdefgh.js', 'comparisonRunnerX-abcdefgh.js',
                      'comparisonRunner-abcdefg.js', 'comparisonRunner-abcdefgh.js.map']:
            scan(f'const licenseKey="{player}";', 1, public, entry=entry)
        scan(f'const licenseKey="{pat}";', 1, {public_player: pat}, entry=runner)
    print(f'Pages secret-scanner checks passed ({cases} cases; no values shown).')


if __name__ == '__main__':
    main()
