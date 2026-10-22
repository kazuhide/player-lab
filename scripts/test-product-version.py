#!/usr/bin/env python3
"""Check the single product version, derived manifests, and public build labels."""
import copy
import json
from pathlib import Path
import plistlib
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BaselineTests(unittest.TestCase):
    def test_product_baseline_matches_the_existing_application_version(self):
        package = json.loads((ROOT / 'package.json').read_text())
        application = json.loads((ROOT / 'apps/web/package.json').read_text())
        self.assertEqual(package['version'], application['version'])


class ProductVersionTests(unittest.TestCase):
    def setUp(self):
        import product_version
        self.product = product_version
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.write_json('package.json', {'version': '0.1.0'})
        for name, keys in self.product.JSON_TARGETS.items():
            document = {'sdkVersion': '8.281.0', 'buildNumber': 17}
            target = document
            for key in keys[:-1]:
                target[key] = {}
                target = target[key]
            target[keys[-1]] = '0.1.0'
            self.write_json(name, document)
        self.write('apps/ios/project.yml', 'settings:\n  base:\n    MARKETING_VERSION: "0.1.0"\n    CURRENT_PROJECT_VERSION: "17"\n')
        self.write('apps/android/app/build.gradle.kts', 'android {\n    defaultConfig {\n        versionCode = 17\n        versionName = "0.1.0"\n    }\n}\n')
        self.write('apps/vega/manifest.toml', 'schema-version = 1\n[package]\nversion = "0.1.0"\n')
        self.write('apps/ios/Showcase/Info.plist', plistlib.dumps({
            'CFBundleShortVersionString': '$(MARKETING_VERSION)',
            'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)',
        }).decode())

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def write_json(self, name, value):
        self.write(name, json.dumps(value, indent=2) + '\n')

    def test_checks_all_application_versions_without_changing_files(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(self.product.sync_versions(self.root, write=False), [])
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    def test_root_version_is_the_only_edit_needed_to_sync_derived_values(self):
        self.write_json('package.json', {'version': '0.2.0'})
        with self.assertRaisesRegex(ValueError, 'version differs'):
            self.product.sync_versions(self.root, write=False)
        changed = self.product.sync_versions(self.root, write=True)
        self.assertEqual(set(changed), set(self.product.JSON_TARGETS) | set(self.product.TEXT_TARGETS))
        self.assertEqual(self.product.sync_versions(self.root, write=False), [])
        for name in self.product.JSON_TARGETS:
            data = json.loads((self.root / name).read_text())
            self.assertEqual(data['sdkVersion'], '8.281.0')
            self.assertEqual(data['buildNumber'], 17)
        self.assertIn('versionCode = 17', (self.root / 'apps/android/app/build.gradle.kts').read_text())
        self.assertIn('CURRENT_PROJECT_VERSION: "17"', (self.root / 'apps/ios/project.yml').read_text())

    def test_rejects_a_missing_manifest_contract_before_writing_any_file(self):
        self.write_json('package.json', {'version': '0.2.0'})
        self.write('apps/android/app/build.gradle.kts', 'versionCode = 17\n')
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError, 'version declaration'):
            self.product.sync_versions(self.root, write=True)
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    def test_rejects_noncanonical_or_prerelease_product_versions(self):
        for value in [True, 1, '01.2.3', '1.2', '1.2.3-rc.1', '1.2.3\n', '<script>']:
            with self.subTest(value=value):
                self.write_json('package.json', {'version': value})
                with self.assertRaises(ValueError):
                    self.product.product_version(self.root)

    def test_apple_bundle_cannot_bypass_the_synchronized_marketing_version(self):
        self.write('apps/ios/Showcase/Info.plist', plistlib.dumps({
            'CFBundleShortVersionString': '1.0.0',
        }).decode())
        with self.assertRaisesRegex(ValueError, 'MARKETING_VERSION'):
            self.product.sync_versions(self.root, write=False)

    def test_ci_metadata_binds_version_source_run_and_public_key_presence(self):
        env = {'GITHUB_SHA': 'a' * 40, 'GITHUB_REPOSITORY': 'example/player-lab',
               'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
               'PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY': 'public-player-fixture',
               'PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY': 'public-analytics-fixture'}
        result = self.product.ci_metadata(self.root, env)
        self.assertEqual(result, {'schemaVersion': 1, 'productVersion': '0.1.0',
            'sha': 'a' * 40, 'repository': 'example/player-lab', 'ciRunId': 123,
            'ciRunAttempt': 2, 'workflowPath': '.github/workflows/ci.yml',
            'base': '/player-lab/web/', 'publicPlayerKeyConfigured': True,
            'publicAnalyticsKeyConfigured': True})
        self.assertNotIn('fixture', json.dumps(result))
        for key in ['PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY', 'PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY']:
            blank = copy.deepcopy(env)
            blank[key] = '  '
            self.assertFalse(self.product.ci_metadata(self.root, blank)[
                'publicPlayerKeyConfigured' if 'PLAYER_LICENSE' in key else 'publicAnalyticsKeyConfigured'])

    def test_ci_metadata_rejects_invalid_identity_instead_of_recording_it(self):
        valid = {'GITHUB_SHA': 'a' * 40, 'GITHUB_REPOSITORY': 'example/player-lab',
                 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2'}
        for key, value in [('GITHUB_SHA', 'main'), ('GITHUB_RUN_ID', '0'),
                           ('GITHUB_RUN_ATTEMPT', '1.5'), ('GITHUB_REPOSITORY', '../elsewhere')]:
            env = {**valid, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.product.ci_metadata(self.root, env)

    def test_build_label_keeps_product_version_and_exact_source_separate(self):
        result = self.product.build_label('0.1.0', 'a' * 40)
        self.assertIn('data-product-version="0.1.0"', result)
        self.assertIn('data-source-revision="' + 'a' * 40 + '"', result)
        self.assertIn('v0.1.0', result)
        self.assertIn('https://github.com/kazuhide/player-lab/commit/' + 'a' * 40, result)
        self.assertIn('aaaaaaa', result)
        self.assertIn('source archive', self.product.build_label('0.1.0', None))
        for version, sha in [('0.1.0', '<script>'), ('<script>', 'a' * 40)]:
            with self.assertRaises(ValueError):
                self.product.build_label(version, sha)

    def test_stamping_replaces_one_explicit_marker_and_rejects_repeated_stamping(self):
        source = '<footer><!-- PLAYER_LAB_BUILD --></footer>'
        result = self.product.stamp_html(source, '0.1.0', 'a' * 40)
        self.assertIn('data-product-version="0.1.0"', result)
        self.assertIn('<footer>', result)
        self.assertNotIn('PLAYER_LAB_BUILD', result)
        for value in [result, source + source]:
            with self.assertRaisesRegex(ValueError, 'one build marker'):
                self.product.stamp_html(value, '0.1.0', 'a' * 40)


if __name__ == '__main__':
    unittest.main()
