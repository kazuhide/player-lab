#!/usr/bin/env python3
"""Exercise channel selection, failure handling and candidate API comparisons."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from sdk_updates import SOURCES, UpdateError, api_delta, inspect_releases, latest_version, managed_update_prs


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_sdk_update', ROOT / 'scripts/prepare-sdk-update.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def coverage():
    return {'sdks': [{'id': key, 'channel': channel, 'version': '8.138.0-beta.28' if key == 'vega' else '1.2.3'}
                     for key, (channel, _) in SOURCES.items()]}


def metadata(url):
    key = next(key for key, (_, expected) in SOURCES.items() if url == expected)
    if key == 'apple':
        return b'[{"name":"v1.2.3"},{"name":"1.10.0"},{"name":"2.0.0-rc.1"}]'
    if key == 'android':
        return b'<metadata><versioning><versions><version>1.2.3</version><version>1.10.0</version><version>2.0.0-rc.1</version></versions></versioning></metadata>'
    if key == 'vega':
        return b'{"dependencies":{"bitmovin-player":"8.138.0-beta.29"}}'
    return b'{"version":"1.10.0"}'


class ReleaseTests(unittest.TestCase):
    def test_only_same_repository_main_update_prs_suppress_a_new_draft(self):
        own = {'headRefName': 'automation/player-sdk-update-123', 'isCrossRepository': False, 'baseRefName': 'main'}
        fork = {**own, 'isCrossRepository': True}
        other_base = {**own, 'baseRefName': 'release'}
        unrelated = {**own, 'headRefName': 'feature/unrelated'}
        self.assertEqual(managed_update_prs([fork, other_base, unrelated]), [])
        self.assertEqual(managed_update_prs([fork, own, other_base]), [own])

    def test_numeric_versions_and_supported_vega_channel(self):
        report = inspect_releases(coverage(), 'a' * 40, metadata)
        self.assertEqual(len(report['sdks']), 6)
        self.assertTrue(report['updateAvailable'])
        self.assertEqual({row['latestVersion'] for row in report['sdks']}, {'1.10.0', '8.138.0-beta.29'})
        self.assertTrue(all(len(row['metadataSha256']) == 64 for row in report['sdks']))

    def test_network_failure_is_not_no_update(self):
        def fail(_url):
            raise OSError('Fixture transport failure')
        with self.assertRaises(OSError):
            inspect_releases(coverage(), 'a' * 40, fail)

    def test_older_metadata_and_mismatched_channels_are_rejected(self):
        data = coverage()
        data['sdks'][0]['version'] = '9.0.0'
        with self.assertRaises(UpdateError):
            inspect_releases(data, 'a' * 40, metadata)
        data = coverage()
        data['sdks'][-1]['channel'] = 'stable'
        with self.assertRaises(UpdateError):
            inspect_releases(data, 'a' * 40, metadata)

    def test_invalid_release_metadata_is_rejected(self):
        for key, body in [('web', b'{}'), ('web', b'{"version":"2.0.0-beta.1"}'),
                          ('vega', b'{"dependencies":{"bitmovin-player":"8.281.0"}}'),
                          ('apple', b'[]'), ('android', b'<html>not metadata</html>')]:
            with self.subTest(key=key, body=body), self.assertRaises(UpdateError):
                latest_version(key, body)

    def test_duplicate_release_channels_are_rejected(self):
        data = coverage()
        data['sdks'].append(copy.deepcopy(data['sdks'][0]))
        with self.assertRaises(UpdateError):
            inspect_releases(data, 'a' * 40, metadata)

    def test_api_diff_distinguishes_members_types_and_provenance_only_changes(self):
        before = [{'id': 'web', 'version': '1.0.0', 'diagnostics': [], 'rows': [
            {'id': 'Config.value', 'types': ['number'], 'declarations': [{'sha256': 'a' * 64}]},
            {'id': 'Player.removed'}, {'id': 'Player.unchanged', 'declarations': [{'sha256': 'b' * 64}]},
        ]}]
        after = [{'id': 'web', 'version': '1.1.0', 'diagnostics': [], 'rows': [
            {'id': 'Config.value', 'types': ['string']}, {'id': 'Player.added'},
            {'id': 'Player.unchanged', 'declarations': [{'sha256': 'c' * 64}]},
        ]}]
        delta = api_delta(before, after)[0]
        self.assertEqual(delta['added'], ['Player.added'])
        self.assertEqual(delta['removed'], ['Player.removed'])
        self.assertEqual(delta['changed'], ['Config.value'])
        bad = copy.deepcopy(after)
        bad[0]['diagnostics'] = [{'code': 123}]
        with self.assertRaises(UpdateError):
            api_delta(before, bad)

    def test_duplicate_api_ids_are_rejected(self):
        inventory = [{'id': 'web', 'version': '1.0.0', 'rows': [{'id': 'x'}, {'id': 'x'}]}]
        with self.assertRaises(UpdateError):
            api_delta(inventory, inventory)

    def test_event_callback_types_and_enum_values_are_contract_changes(self):
        before = [{'id': 'web', 'version': '1.0.0', 'rows': [
            {'id': 'Event.callback', 'type': '(value: number) => void'},
            {'id': 'Event.name', 'value': 'before'},
        ]}]
        after = copy.deepcopy(before)
        after[0]['rows'][0]['type'] = '(value: string) => void'
        after[0]['rows'][1]['value'] = 'after'
        self.assertEqual(api_delta(before, after)[0]['changed'], ['Event.callback', 'Event.name'])

    def test_candidate_edits_leave_coverage_and_native_commit_ids_untouched(self):
        report = inspect_releases(coverage(), 'a' * 40, metadata)
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            for sdk, entries in prepare.JSON_PINS.items():
                for file, section, package in entries:
                    path = repo / file
                    path.parent.mkdir(parents=True, exist_ok=True)
                    data = json.loads(path.read_text()) if path.exists() else {}
                    data.setdefault(section, {})[package] = '8.138.0-beta.28' if sdk == 'vega' else '1.2.3'
                    path.write_text(json.dumps(data))
            path = repo / 'apps/android/app/build.gradle.kts'
            path.parent.mkdir(parents=True)
            path.write_text('implementation("com.bitmovin.player:player:1.2.3")')
            path = repo / 'apps/ios/project.yml'
            path.parent.mkdir(parents=True)
            path.write_text('exactVersion: "1.2.3"')
            files = prepare.candidate_files(repo, report)
            self.assertEqual(json.loads(files['apps/web/package.json'])['dependencies']['bitmovin-player'], '1.10.0')
            self.assertIn('8.138.0-beta.29', files['apps/vega/package.json'])
            self.assertFalse(any('coverage' in file or file.endswith('Package.resolved') for file in files))
            self.assertIn('1.2.3', (repo / 'apps/web/package.json').read_text())
            bad = copy.deepcopy(report)
            bad['sdks'][0]['source'] = 'https://example.invalid/'
            with self.assertRaises(UpdateError):
                prepare.candidate_files(repo, bad)


if __name__ == '__main__':
    unittest.main()
