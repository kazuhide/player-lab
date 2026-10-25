#!/usr/bin/env python3
"""Exercise channel selection, failure handling and candidate API comparisons."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import unquote

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


def android_publication(url):
    artifact, encoded, filename = url.removeprefix(prepare.ANDROID_MAVEN).split('/')
    if not url.startswith(prepare.ANDROID_MAVEN) or artifact not in prepare.ANDROID_ARTIFACTS or filename != f'{artifact}-{encoded}.pom':
        raise AssertionError('Unexpected Android publication URL: ' + url)
    return (f'<project xmlns="http://maven.apache.org/POM/4.0.0"><groupId>com.bitmovin.player</groupId>'
            f'<artifactId>{artifact}</artifactId><version>{unquote(encoded)}</version><packaging>aar</packaging></project>').encode()


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

    def test_candidate_updates_the_qualified_android_player_and_media_session_pair(self):
        report = inspect_releases(coverage(), 'a' * 40, metadata)
        for row in report['sdks']:
            if row['id'] != 'android':
                row['latestVersion'] = row['currentVersion']
                row['updateAvailable'] = False
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            path = repo / 'apps/android/app/build.gradle.kts'
            path.parent.mkdir(parents=True)
            path.write_text('dependencies {\n'
                            '    implementation("com.bitmovin.player:player:1.2.3+jason")\n'
                            '    implementation("com.bitmovin.player:player-media-session:1.2.3+jason")\n'
                            '}\n')
            urls = []
            def fetch(url):
                urls.append(url)
                return android_publication(url)
            files = prepare.candidate_files(repo, report, fetch)
            self.assertIn('com.bitmovin.player:player:1.10.0+jason', files[str(path.relative_to(repo))])
            self.assertIn('com.bitmovin.player:player-media-session:1.10.0+jason', files[str(path.relative_to(repo))])
            self.assertEqual(urls, [f'{prepare.ANDROID_MAVEN}{artifact}/1.10.0%2Bjason/{artifact}-1.10.0%2Bjason.pom'
                                    for artifact in prepare.ANDROID_ARTIFACTS])
            self.assertIn('1.2.3+jason', path.read_text())

    def test_android_updates_only_dependency_versions_in_the_existing_variant(self):
        prefix = ('// implementation("com.bitmovin.player:player:1.2.3")\n'
                  '/*\nimplementation("com.bitmovin.player:player-media-session:1.2.3")\n*/\n'
                  'val example = """\nimplementation("com.bitmovin.player:player:1.2.3")\n"""\n'
                  'implementation("unrelated:player:1.2.3")\n')
        def dependencies(version):
            return (f'    implementation("com.bitmovin.player:player:{version}") // Player\n'
                    f'    implementation("com.bitmovin.player:player-media-session:{version}")\n')
        for qualifier in ('', '+jason'):
            with self.subTest(qualifier=qualifier):
                before = prefix + dependencies('1.2.3' + qualifier)
                expected = prefix + dependencies('1.10.0' + qualifier)
                self.assertEqual(prepare.android_candidate(before, '1.2.3', '1.10.0', android_publication), expected)

    def test_android_rejects_missing_duplicate_mismatched_and_unknown_variant_pins(self):
        player = 'implementation("com.bitmovin.player:player:1.2.3+jason")\n'
        session = 'implementation("com.bitmovin.player:player-media-session:1.2.3+jason")\n'
        invalid = ['', player, session, player * 2 + session, player + session * 2,
                   player + session.replace('1.2.3', '1.2.4'), player + session.replace('+jason', ''),
                   (player + session).replace('+jason', '+unknown'),
                   (player + session).replace('1.2.3', '1.2.4'),
                   (player + session).replace('implementation(', 'val pin = ('),
                   '/* nested /* comment */\n' + player + session + '*/\n',
                   '/* unterminated\n' + player + session]
        def no_fetch(_url):
            self.fail('Invalid Android pins must fail before fetching publications.')
        for text in invalid:
            with self.subTest(text=text), self.assertRaises(UpdateError):
                prepare.android_candidate(text, '1.2.3', '1.10.0', no_fetch)

    def test_android_rejects_ambiguous_managed_dependency_prefixes_even_with_a_valid_pair(self):
        pair = ('implementation("com.bitmovin.player:player:1.2.3+jason")\n'
                'implementation("com.bitmovin.player:player-media-session:1.2.3+jason")\n')
        for expression in ('"com.bitmovin.player:player:" + otherVersion',
                           '"com.bitmovin.player:player-media-session:" + otherVersion',
                           '"com.bitmovin.player:player" + ":" + otherVersion',
                           '"com.bitmovin.player:" + artifact + ":" + otherVersion'):
            def no_fetch(_url):
                self.fail('Ambiguous managed dependencies must fail before fetching publications.')
            with self.subTest(expression=expression), self.assertRaises(UpdateError):
                prepare.android_candidate(pair + 'implementation(' + expression + ')\n',
                                          '1.2.3', '1.10.0', no_fetch)

    def test_android_rejects_an_unpublished_or_different_target_for_either_module(self):
        before = ('implementation("com.bitmovin.player:player:1.2.3+jason")\n'
                  'implementation("com.bitmovin.player:player-media-session:1.2.3+jason")\n')
        for missing in prepare.ANDROID_ARTIFACTS:
            def fetch(url):
                if url.startswith(prepare.ANDROID_MAVEN + missing + '/'):
                    raise OSError('Fixture artifact is unpublished')
                return android_publication(url)
            with self.subTest(missing=missing), self.assertRaises(OSError):
                prepare.android_candidate(before, '1.2.3', '1.10.0', fetch)
        for body in (b'not XML', b'<html>not a POM</html>',
                     android_publication(f'{prepare.ANDROID_MAVEN}player/1.10.0/player-1.10.0.pom')):
            with self.subTest(body=body), self.assertRaises(UpdateError):
                prepare.android_candidate(before, '1.2.3', '1.10.0', lambda _url: body)

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
            path.write_text('implementation("com.bitmovin.player:player:1.2.3")\n'
                            'implementation("com.bitmovin.player:player-media-session:1.2.3")\n')
            path = repo / 'apps/ios/project.yml'
            path.parent.mkdir(parents=True)
            path.write_text('exactVersion: "1.2.3"')
            files = prepare.candidate_files(repo, report, android_publication)
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
