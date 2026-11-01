#!/usr/bin/env python3
"""Exercise release boundaries with real ZIPs and a mocked GitHub/gh boundary."""

from copy import deepcopy
import os
from pathlib import Path
from io import BytesIO
import runpy
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

from guide_routes import GUIDE_ASSETS, GUIDE_FILES
import release_contract as contract
import release_pipeline as pipeline
from product_version import build_label

ROOT = Path(__file__).resolve().parents[1]
REPO = contract.REPOSITORY
# This fixture factory only needs root/write; keep the media contract in one place.
make_media = runpy.run_path(str(ROOT / 'scripts/test-pages-package.py'))['PagesPackageTests'].make_media


def invoke(*args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True).stdout


class Fixture:
    """No fixture signature is cryptographic proof; only gh's process boundary is mocked."""

    def __init__(self, root, *, with_media=False, track_media_helper=True):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.with_media = with_media
        self.source = root / 'source'
        self.source.mkdir()
        self.version = '0.1.0'
        self.notes = '# Player Lab 0.1.0\n\nA development baseline with documented setup requirements.\n'
        self.write(self.source, 'package.json', b'{"version":"0.1.0"}\n')
        self.write(self.source, 'docs/releases/0.1.0.md', self.notes.encode())
        for name in ('package-pages.py', 'guide_routes.py'):
            self.write(self.source, 'scripts/' + name, (ROOT / 'scripts' / name).read_bytes())
        helper = 'encoding/test-streams/local.py'
        if with_media and track_media_helper:
            self.write(self.source, helper, (ROOT / helper).read_bytes())
        invoke('git', 'init', '-q', cwd=self.source)
        invoke('git', '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid',
               'add', '.', cwd=self.source)
        invoke('git', '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid',
               'commit', '-qm', 'Public release fixture', cwd=self.source)
        self.sha = invoke('git', 'rev-parse', 'HEAD', cwd=self.source).decode().strip()
        if with_media and not track_media_helper:
            # Build an artifact with a helper absent from its claimed source commit.
            self.write(self.source, helper, (ROOT / helper).read_bytes())
        self.run = self.workflow_run(100, 10, contract.CI_PATH, 'CI', '2026-10-22T00:00:00Z', event='push')
        self.run.update(status='completed', conclusion='success')
        self.jobs = [dict(id=1000 + index, name=name, run_id=100, run_attempt=1, head_sha=self.sha,
                          status='completed', conclusion='success', started_at='2026-10-22T00:01:00Z',
                          completed_at='2026-10-22T00:10:00Z') for index, name in enumerate(contract.REQUIRED_JOBS)]
        self.jobs[3].update(started_at='2026-10-22T00:11:00Z', completed_at='2026-10-22T00:15:00Z')
        self.producer = self.workflow_run(200, 11, contract.PRODUCER_PATH,
            f'Release v0.1.0 at {self.sha} from CI 100', '2026-10-22T00:20:00Z')
        self.pages_run = self.workflow_run(300, 12, contract.PAGES_PATH,
            'Pages release 500 from manual', '2026-10-22T00:30:00Z')
        self.archive = self.package()
        self.artifact = {'id': 900, 'name': 'pages-release', 'expired': False,
                         'size_in_bytes': self.archive.stat().st_size, 'digest': 'sha256:' + contract.file_digest(self.archive),
                         'created_at': '2026-10-22T00:07:00Z',
                         'workflow_run': {'id': 100, 'head_sha': self.sha, 'repository_id': 42, 'head_repository_id': 42}}
        self.api = FakeGitHub(self)

    def write(self, root, name, data):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def workflow_run(self, run_id, workflow_id, path, title, created, *, event='workflow_dispatch'):
        return {'id': run_id, 'workflow_id': workflow_id, 'path': path, 'head_branch': 'main',
                'head_repository': {'id': 42, 'full_name': REPO}, 'head_sha': self.sha,
                'event': event, 'run_attempt': 1, 'created_at': created, 'display_title': title,
                'status': 'in_progress', 'conclusion': None}

    def package(self, *, public_player=True, public_analytics=True):
        label = build_label(self.version, self.sha).encode()
        for name in {'index.html', 'ja/index.html', 'styles.css', 'assets/player-preview.jpg', 'assets/favicon.svg'} | GUIDE_ASSETS:
            self.write(self.root / 'landing', name, label if name.endswith('.html') else b'public asset')
        for name in GUIDE_FILES:
            self.write(self.root / 'guide', name, label if name.endswith('.html') else b'[]')
        self.write(self.root / 'web', 'index.html', label)
        self.write(self.root / 'web', 'guide.html', label)
        self.write(self.root / 'web', 'assets/main-12345678.js', b'console.log("public");')
        self.write(self.root / 'web', 'assets/main-12345678.css', b'body { color: black; }')
        for name in ('PROJECT-LICENSE.txt', 'BITMOVIN-PLAYER-UI-LICENSE.txt', 'BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt',
                     'BITMOVIN-PLAYER-WEB-X-NOTICE.txt', 'HLS-JS-LICENSE.txt',
                     'SHAKA-PLAYER-LICENSE.txt', 'SHAKA-PLAYER-THIRD-PARTY-NOTICES.txt'):
            self.write(self.root / 'notices', name, b'public license notice')
        extracted = self.root / 'ci-archive'
        extracted.mkdir()
        media = ['--media-dir', str(make_media(self))] if self.with_media else []
        invoke('python3', str(self.source / 'scripts/package-pages.py'), '--site-dir', str(self.root / 'landing'),
               '--guide-dir', str(self.root / 'guide'), '--web-dir', str(self.root / 'web'),
               '--notices-dir', str(self.root / 'notices'), '--output-dir', str(extracted / 'site'),
               '--manifest', str(extracted / 'manifest.json'), *media, cwd=self.source)
        metadata = {'schemaVersion': 1, 'productVersion': self.version, 'sha': self.sha, 'repository': REPO,
                    'ciRunId': 100, 'ciRunAttempt': 1, 'workflowPath': contract.CI_PATH, 'base': '/player-lab/web/',
                    'publicPlayerKeyConfigured': public_player, 'publicAnalyticsKeyConfigured': public_analytics}
        (extracted / 'release.json').write_bytes(contract.json_bytes(metadata))
        archive = self.root / 'original.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as writer:
            for path in sorted(extracted.rglob('*')):
                if path.is_file():
                    writer.write(path, path.relative_to(extracted).as_posix())
        return archive

    def signature(self, artifact=None):
        artifact = artifact or {'id': 900, 'sha256': contract.file_digest(self.archive)}
        origin = 'https://github.com/' + REPO
        signer = origin + '/' + contract.CI_PATH + '@refs/heads/main'
        return [{'attestation': {'bundle': {'dsseEnvelope': {'payloadType': 'application/vnd.in-toto+json', 'payload': 'fixture'}}},
                 'verificationResult': {'statement': {'predicateType': 'https://slsa.dev/provenance/v1',
                     'subject': [{'name': REPO + '/pages-release/' + str(artifact['id']), 'digest': {'sha256': artifact['sha256']}}]},
                     'signature': {'certificate': {'issuer': 'https://token.actions.githubusercontent.com',
                         'subjectAlternativeName': signer, 'buildSignerURI': signer, 'buildSignerDigest': self.sha,
                         'runnerEnvironment': 'github-hosted', 'sourceRepositoryURI': origin,
                         'sourceRepositoryDigest': self.sha, 'sourceRepositoryRef': 'refs/heads/main',
                         'sourceRepositoryIdentifier': '42', 'buildConfigURI': signer, 'buildConfigDigest': self.sha,
                         'buildTrigger': 'push', 'runInvocationURI': origin + '/actions/runs/100/attempts/1'}}}}]

    def context(self, path=contract.PRODUCER_PATH, *, run=None):
        run = run or (self.producer if path == contract.PRODUCER_PATH else self.pages_run)
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': REPO, 'GITHUB_REF': 'refs/heads/main',
                                   'GITHUB_RUN_ID': str(run['id']), 'GITHUB_SHA': self.sha}):
            return pipeline.Context(self.api, path, root=self.source)

    def work(self, name):
        result = self.root / name
        result.mkdir()
        return result


class FakeGitHub:
    def __init__(self, fixture):
        self.f = fixture
        self.releases, self.assets, self.asset_data, self.tags = {}, {}, {}, {}
        self.mutations, self.downloads, self.dispatches = [], [], []
        self.pages_runs, self.page_jobs, self.extra_runs = [], {}, {}
        self.artifact_missing = False

    def get(self, path):
        if path == '':
            return {'id': 42, 'full_name': REPO, 'private': False}
        if path.startswith('actions/workflows/'):
            filename = path.split('/')[-1]
            return {'id': {'ci.yml': 10, 'release.yml': 11, 'pages.yml': 12}[filename],
                    'path': '.github/workflows/' + filename, 'state': 'active'}
        if path.startswith('actions/runs/'):
            run_id = int(path.split('/')[-1])
            return deepcopy({100: self.f.run, 200: self.f.producer, 300: self.f.pages_run, **self.extra_runs}.get(run_id))
        if path == 'branches/main':
            return {'commit': {'sha': self.f.sha}}
        if path.startswith('compare/'):
            return {'status': 'identical', 'merge_base_commit': {'sha': self.f.sha}}
        if path.startswith('actions/artifacts/'):
            return None if self.artifact_missing else deepcopy(self.f.artifact)
        if path.startswith('git/ref/tags/'):
            return deepcopy(self.tags.get(path.split('/')[-1]))
        if path.startswith('releases/'):
            return deepcopy(self.releases.get(int(path.split('/')[-1])))
        raise AssertionError('Unexpected API read: ' + path)

    def pages(self, path, key=None):
        if path.startswith('actions/runs/100/jobs'):
            return deepcopy(self.f.jobs)
        if path.startswith('actions/runs/100/artifacts'):
            return [] if self.artifact_missing else [deepcopy(self.f.artifact)]
        if path.startswith('actions/workflows/pages.yml/runs'):
            return deepcopy(self.pages_runs)
        if path.startswith('actions/runs/') and '/jobs?' in path:
            return deepcopy(self.page_jobs.get(int(path.split('/')[2]), []))
        if path == 'releases':
            return deepcopy(list(self.releases.values()))
        if path.startswith('releases/') and path.endswith('/assets'):
            return deepcopy(list(self.assets.get(int(path.split('/')[1]), {}).values()))
        raise AssertionError('Unexpected API list: ' + path)

    def change(self, path, document, method='POST'):
        self.mutations.append((path, deepcopy(document), method))
        if path == 'git/refs':
            tag = document['ref'].split('/')[-1]
            self.tags[tag] = {'ref': document['ref'], 'object': {'type': 'commit', 'sha': document['sha']}}
            return deepcopy(self.tags[tag])
        if path == 'releases':
            release = {'id': 500, **deepcopy(document), 'immutable': False}
            self.releases[500] = release
            return deepcopy(release)
        if path.startswith('releases/'):
            release = self.releases[int(path.split('/')[-1])]
            release.update(document)
            release.update(immutable=True, published_at='2026-10-22T00:25:00Z')
            return deepcopy(release)
        if path == 'actions/workflows/pages.yml/dispatches':
            self.dispatches.append(deepcopy(document))
            return {}
        raise AssertionError('Unexpected API mutation: ' + path)

    def request(self, path, *, method='GET', data=None, **kwargs):
        suffix = path.split('/player-lab/', 1)[1]
        if method == 'UPLOAD':
            from urllib.parse import parse_qs, urlsplit
            data = data.read()
            release_id = int(suffix.split('/')[1])
            name = parse_qs(urlsplit(suffix).query)['name'][0]
            asset = {'id': 2000 + len(self.asset_data), 'name': name, 'state': 'uploaded',
                     'size': len(data), 'digest': 'sha256:' + contract.sha256(data)}
            self.assets.setdefault(release_id, {})[name] = asset
            self.asset_data[asset['id']] = data
            self.mutations.append(('upload', name, release_id))
            return deepcopy(asset)
        if suffix.startswith('releases/assets/'):
            return self.asset_data[int(suffix.split('/')[-1])]
        raise AssertionError('Unexpected raw API call: ' + path)

    def download(self, suffix, output):
        self.downloads.append(suffix)
        if suffix == 'actions/artifacts/900/zip':
            output.write_bytes(self.f.archive.read_bytes())
        elif suffix.startswith('releases/assets/'):
            output.write_bytes(self.asset_data[int(suffix.split('/')[-1])])
        else:
            raise AssertionError('Unexpected binary download: ' + suffix)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.f = Fixture(Path(self.temporary.name))
        original = pipeline.command
        self.signature_calls = []
        def command(args, **kwargs):
            if args[:3] == ['gh', 'attestation', 'verify']:
                self.signature_calls.append(list(args))
                return contract.json_bytes(self.f.signature())
            return original(args, **kwargs)
        self.commands = patch.object(pipeline, 'command', side_effect=command)
        self.commands.start()
        self.addCleanup(self.commands.stop)

    def publish(self, name='promote'):
        return pipeline.publish(self.f.context(), '0.1.0', self.f.sha, 100, self.f.work(name))

    def prepare(self, name='prepare', *, producer=None, allow_older=False):
        self.f.pages_run['display_title'] = 'Pages release 500 from ' + (str(producer) if producer else 'manual')
        return pipeline.prepare_pages(self.f.context(contract.PAGES_PATH), 500, producer,
                                      allow_older, self.f.work(name))

    def test_promotes_original_bytes_then_consumer_and_final_gate_verify_them(self):
        self.assertEqual(self.publish(), 500)
        names = contract.asset_names('0.1.0')
        archive_asset = self.f.api.assets[500][names['archive']]
        self.assertEqual(self.f.api.asset_data[archive_asset['id']], self.f.archive.read_bytes())
        writes = self.f.api.mutations
        publish_index = next(i for i, item in enumerate(writes) if item[2] == 'PATCH')
        self.assertEqual(sum(item[0] == 'upload' for item in writes[:publish_index]), 4)
        self.assertEqual(self.f.api.dispatches, [{'ref': 'main', 'inputs': {
            'release_id': '500', 'producer_run_id': '200', 'allow_older_release': 'false'}}])
        site, state = self.prepare(producer=200)
        self.assertTrue((site / 'index.html').is_file())
        pipeline.recheck_pages(self.f.context(contract.PAGES_PATH), contract.json_load(state.read_bytes()))
        self.assertTrue(any('--bundle' in args for args in self.signature_calls))
        self.assertTrue(all('--deny-self-hosted-runners' in args for args in self.signature_calls))

    def test_media_release_uses_selected_source_helper_through_all_publication_gates(self):
        self.f = Fixture(self.f.root / 'media-release', with_media=True)
        helper = 'encoding/test-streams/local.py'
        expected = invoke('git', 'show', self.f.sha + ':' + helper, cwd=self.f.source)
        poisoned = b"raise AssertionError('The working-tree helper must not be executed.')\n"
        self.f.write(self.f.source, helper, poisoned)
        self.assertEqual(self.publish('promote-media'), 500)
        names = contract.asset_names(self.f.version)
        archive = self.f.api.assets[500][names['archive']]
        self.assertEqual(self.f.api.asset_data[archive['id']], self.f.archive.read_bytes())
        self.assertEqual((self.f.root / 'promote-media/source-validator' / helper).read_bytes(), expected)
        site, state = self.prepare('prepare-media', producer=200)
        self.assertEqual((self.f.root / 'prepare-media/source-validator' / helper).read_bytes(), expected)
        for name in ['master.m3u8', 'comparison-360p.m3u8', 'comparison-180p.m3u8']:
            self.assertEqual((site / 'web/media/vod-baseline' / name).read_bytes(),
                             (self.f.root / 'media/vod-baseline' / name).read_bytes())
        pipeline.recheck_pages(self.f.context(contract.PAGES_PATH), contract.json_load(state.read_bytes()))
        self.assertEqual((self.f.source / helper).read_bytes(), poisoned)
        self.assertTrue(any('--bundle' in args for args in self.signature_calls))

    def test_missing_selected_media_helper_cannot_use_a_working_tree_copy(self):
        self.f = Fixture(self.f.root / 'missing-helper', with_media=True, track_media_helper=False)
        helper = 'encoding/test-streams/local.py'
        self.assertTrue((self.f.source / helper).is_file())
        self.assertEqual(invoke('git', 'ls-tree', self.f.sha, '--', helper, cwd=self.f.source), b'')
        with self.assertRaisesRegex(ValueError, 'verification command failed'):
            self.publish('missing-helper-promotion')
        self.assertEqual(self.f.api.mutations, [])
        self.assertEqual(self.f.api.dispatches, [])

    def test_source_without_an_unused_media_helper_remains_verifiable(self):
        helper = 'encoding/test-streams/local.py'
        self.assertEqual(invoke('git', 'ls-tree', self.f.sha, '--', helper, cwd=self.f.source), b'')
        self.f.write(self.f.source, helper, b"raise AssertionError('An unrelated current helper must be ignored.')\n")
        self.assertEqual(self.publish('helper-free-promotion'), 500)
        site, state = self.prepare('helper-free-pages')
        self.assertTrue((site / 'index.html').is_file())
        pipeline.recheck_pages(self.f.context(contract.PAGES_PATH), contract.json_load(state.read_bytes()))
        self.assertFalse((self.f.root / 'helper-free-pages/source-validator' / helper).exists())

    def test_published_resume_after_original_artifact_metadata_expires_does_not_upload(self):
        self.publish()
        self.f.api.artifact_missing = True
        before = len(self.f.api.mutations)
        self.publish('resume')
        self.assertEqual([entry[0] for entry in self.f.api.mutations[before:]], ['actions/workflows/pages.yml/dispatches'])
        self.assertEqual(self.f.api.downloads.count('actions/artifacts/900/zip'), 1)
        self.prepare()

    def test_matching_partial_draft_resumes_missing_assets_without_replacing_existing_bytes(self):
        self.publish()
        self.f.api.releases[500].update(draft=True, immutable=False)
        names = contract.asset_names('0.1.0')
        retained = self.f.api.assets[500][names['archive']]['id']
        for key in ('provenance', 'attestation', 'checksums'):
            self.f.api.assets[500].pop(names[key])
        self.f.api.artifact_missing = True
        before = len(self.f.api.mutations)
        self.publish('draft-resume')
        self.assertEqual(self.f.api.assets[500][names['archive']]['id'], retained)
        self.assertEqual(sum(entry[0] == 'upload' for entry in self.f.api.mutations[before:]), 3)

    def test_partial_draft_restores_original_signed_generation_after_ci_web_rerun(self):
        original = self.f.api.request
        def interrupt_after_archive(path, **kwargs):
            if kwargs.get('method') == 'UPLOAD' and len(self.f.api.assets.get(500, {})) == 1:
                raise ValueError('Interrupted after archive upload.')
            return original(path, **kwargs)
        with patch.object(self.f.api, 'request', side_effect=interrupt_after_archive):
            with self.assertRaisesRegex(ValueError, 'Interrupted after archive upload'):
                self.publish()
        names = contract.asset_names('0.1.0')
        self.assertTrue(self.f.api.releases[500]['draft'])
        self.assertEqual(set(self.f.api.assets[500]), {names['archive']})
        archive_id = self.f.api.assets[500][names['archive']]['id']
        web = next(job for job in self.f.jobs if job['name'] == 'web')
        webkit = next(job for job in self.f.jobs if job['name'] == 'webkit')
        self.f.jobs.extend([
            {**web, 'id': 3001, 'run_attempt': 2, 'started_at': '2026-10-22T00:50:00Z', 'completed_at': '2026-10-22T01:00:00Z'},
            {**webkit, 'id': 3002, 'run_attempt': 2, 'started_at': '2026-10-22T01:01:00Z', 'completed_at': '2026-10-22T01:05:00Z'},
        ])
        self.f.run['run_attempt'] = 2
        self.f.api.artifact_missing = True
        self.assertEqual(self.publish('partial-after-rerun'), 500)
        self.assertEqual(self.f.api.assets[500][names['archive']]['id'], archive_id)
        proof_asset = self.f.api.assets[500][names['provenance']]
        proof = contract.json_load(self.f.api.asset_data[proof_asset['id']])
        self.assertEqual(proof['ciWebRunAttempt'], 1)
        self.assertEqual(proof['qualificationJobs']['web'], {'id': web['id'], 'attempt': 1})
        self.assertEqual(proof['qualificationJobs']['webkit'], {'id': webkit['id'], 'attempt': 1})
        self.assertEqual(self.f.api.downloads.count('actions/artifacts/900/zip'), 1)
        self.prepare('recovered-pages')

    def test_mismatched_existing_release_or_asset_is_never_overwritten(self):
        self.publish()
        self.f.api.releases[500]['body'] += 'Changed release notes.'
        before = len(self.f.api.mutations)
        with self.assertRaisesRegex(ValueError, 'curated notes'):
            self.publish('different-notes')
        self.assertEqual(len(self.f.api.mutations), before)
        self.f.api.releases[500]['body'] = self.f.notes
        name = contract.asset_names('0.1.0')['archive']
        asset = self.f.api.assets[500][name]
        self.f.api.asset_data[asset['id']] = b'changed bytes'
        with self.assertRaisesRegex(ValueError, 'downloaded release asset'):
            self.publish('different-bytes')
        self.assertEqual(len(self.f.api.mutations), before)

    def test_unsigned_self_consistent_retained_release_is_rejected_at_cryptographic_boundary(self):
        self.publish()
        original = pipeline.command
        def refuse(args, **kwargs):
            if args[:3] == ['gh', 'attestation', 'verify']:
                raise ValueError('Signature verification failed.')
            return original(args, **kwargs)
        with patch.object(pipeline, 'command', side_effect=refuse):
            with self.assertRaisesRegex(ValueError, 'Signature verification'):
                self.prepare()

    def test_consumer_does_not_trust_provenance_without_canonical_ci_records(self):
        self.publish()
        self.f.run['path'] = '.github/workflows/another.yml'
        with self.assertRaisesRegex(ValueError, 'canonical workflow'):
            self.prepare()

    def test_source_outside_main_history_is_rejected_before_signing_or_mutation(self):
        original = self.f.api.get
        def get(path):
            if path.startswith('compare/'):
                return {'status': 'diverged', 'merge_base_commit': {'sha': '0' * 40}}
            return original(path)
        with patch.object(self.f.api, 'get', side_effect=get):
            with self.assertRaisesRegex(ValueError, 'main history'):
                self.publish()
        self.assertEqual(self.signature_calls, [])
        self.assertEqual(self.f.api.mutations, [])

    def test_both_public_flags_are_required_even_for_otherwise_valid_signed_archive(self):
        for flag in ('publicPlayerKeyConfigured', 'publicAnalyticsKeyConfigured'):
            with self.subTest(flag=flag):
                extracted = self.f.root / 'ci-archive'
                metadata = contract.json_load((extracted / 'release.json').read_bytes())
                good = deepcopy(metadata)
                metadata[flag] = False
                (extracted / 'release.json').write_bytes(contract.json_bytes(metadata))
                archive = self.f.root / (flag + '.zip')
                with zipfile.ZipFile(archive, 'w') as writer:
                    for path in extracted.rglob('*'):
                        if path.is_file():
                            writer.write(path, path.relative_to(extracted).as_posix())
                self.f.archive = archive
                self.f.artifact.update(size_in_bytes=archive.stat().st_size, digest='sha256:' + contract.file_digest(archive))
                with self.assertRaisesRegex(ValueError, 'both public license'):
                    self.publish(flag)
                self.assertEqual(self.f.api.mutations, [])
                (extracted / 'release.json').write_bytes(contract.json_bytes(good))

    def test_consumer_independently_rejects_signed_keyless_ci_even_with_matching_asset_checksums(self):
        self.publish()
        names = contract.asset_names('0.1.0')
        archive = self.f.root / 'signed-keyless-fixture.zip'
        release_metadata = None
        with zipfile.ZipFile(self.f.archive) as reader, zipfile.ZipFile(archive, 'w') as writer:
            for entry in reader.infolist():
                data = reader.read(entry)
                if entry.filename == 'release.json':
                    document = contract.json_load(data)
                    document['publicAnalyticsKeyConfigured'] = False
                    data = release_metadata = contract.json_bytes(document)
                writer.writestr(entry, data)
        self.f.archive = archive
        self.f.artifact.update(size_in_bytes=archive.stat().st_size, digest='sha256:' + contract.file_digest(archive))
        def replace(name, data):
            asset = self.f.api.assets[500][name]
            self.f.api.asset_data[asset['id']] = data
            asset.update(size=len(data), digest='sha256:' + contract.sha256(data))
        replace(names['archive'], archive.read_bytes())
        asset = self.f.api.assets[500][names['provenance']]
        document = contract.json_load(self.f.api.asset_data[asset['id']])
        document['artifact'].update(size=archive.stat().st_size, sha256=contract.file_digest(archive))
        document['releaseMetadataSha256'] = contract.sha256(release_metadata)
        replace(names['provenance'], contract.json_bytes(document))
        digests = {name: item['digest'][7:] for name, item in self.f.api.assets[500].items()}
        replace(names['checksums'], ''.join(digests[name] + '  ' + name + '\n' for name in sorted(
            [names[key] for key in ('archive', 'provenance', 'attestation')])).encode())
        with self.assertRaisesRegex(ValueError, 'both public license'):
            self.prepare()

    def test_final_gate_rejects_changed_notes_or_assets_and_different_current_request(self):
        self.publish()
        _, path = self.prepare()
        state = contract.json_load(path.read_bytes())
        self.f.api.releases[500]['body'] += 'changed'
        with self.assertRaisesRegex(ValueError, 'curated notes'):
            pipeline.recheck_pages(self.f.context(contract.PAGES_PATH), state)
        self.f.api.releases[500]['body'] = self.f.notes
        self.f.api.assets[500]['SHA256SUMS']['id'] += 1
        with self.assertRaisesRegex(ValueError, 'immutable assets'):
            pipeline.recheck_pages(self.f.context(contract.PAGES_PATH), state)
        state['pagesRunId'] = 301
        with self.assertRaisesRegex(ValueError, 'exact Pages run'):
            pipeline.recheck_pages(self.f.context(contract.PAGES_PATH), state)

    def test_failed_only_webkit_rerun_keeps_successful_attempt_one_archive(self):
        previous = next(job for job in self.f.jobs if job['name'] == 'webkit')
        previous['conclusion'] = 'failure'
        new = {**previous, 'id': 3000, 'run_attempt': 2, 'conclusion': 'success'}
        self.f.jobs.append(new)
        self.f.run['run_attempt'] = 2
        self.publish()
        self.prepare()

    def test_current_web_attempt_cannot_borrow_older_signed_archive(self):
        old = next(job for job in self.f.jobs if job['name'] == 'web')
        self.f.jobs.append({**old, 'id': 3001, 'run_attempt': 2,
                            'started_at': '2026-10-22T00:11:00Z', 'completed_at': '2026-10-22T00:15:00Z'})
        self.f.run['run_attempt'] = 2
        with self.assertRaisesRegex(ValueError, 'Exactly one nonexpired'):
            self.publish()
        self.assertEqual(self.f.api.mutations, [])

    def test_published_archive_keeps_original_signed_successful_web_attempt_after_later_successful_rerun(self):
        self.publish()
        old = next(job for job in self.f.jobs if job['name'] == 'web')
        self.f.jobs.append({**old, 'id': 3001, 'run_attempt': 2,
                            'started_at': '2026-10-22T00:11:00Z', 'completed_at': '2026-10-22T00:15:00Z'})
        self.f.run['run_attempt'] = 2
        self.prepare()
        before = len(self.f.api.mutations)
        self.publish('retained-generation')
        self.assertEqual([entry[0] for entry in self.f.api.mutations[before:]], ['actions/workflows/pages.yml/dispatches'])
        self.f.jobs[-1]['conclusion'] = 'failure'
        with self.assertRaisesRegex(ValueError, 'Every effective CI job'):
            self.prepare('known-later-failure')

    def test_recorded_webkit_cannot_be_swapped_to_a_later_different_archive_generation(self):
        self.publish()
        names = contract.asset_names('0.1.0')
        recorded = self.f.api.assets[500][names['provenance']]
        document = contract.json_load(self.f.api.asset_data[recorded['id']])
        web = next(job for job in self.f.jobs if job['name'] == 'web')
        webkit = next(job for job in self.f.jobs if job['name'] == 'webkit')
        self.f.jobs.extend([{**web, 'id': 3001, 'run_attempt': 2}, {**webkit, 'id': 3002, 'run_attempt': 2}])
        self.f.run['run_attempt'] = 2
        jobs = contract.effective_jobs(self.f.jobs, self.f.run)
        document['qualificationJobs']['webkit'] = {'id': 3002, 'attempt': 2}
        with self.assertRaisesRegex(ValueError, 'WebKit gate must qualify this archive generation'):
            contract.provenance(document, repository_id=42, version='0.1.0', sha=self.f.sha,
                                run=self.f.run, jobs=jobs, all_jobs=self.f.jobs)
        document['qualificationJobs']['webkit'] = {'id': webkit['id'], 'attempt': 1}
        document['qualificationJobs']['web'] = {'id': 3001, 'attempt': 2}
        document['ciWebRunAttempt'] = 2
        with self.assertRaisesRegex(ValueError, 'WebKit gate must qualify this archive generation'):
            contract.provenance(document, repository_id=42, version='0.1.0', sha=self.f.sha,
                                run=self.f.run, jobs=jobs, all_jobs=self.f.jobs)

    def test_newer_manual_recovery_supersedes_old_producer_even_when_old_dispatch_is_later(self):
        self.publish()
        manual = deepcopy(self.f.pages_run)
        self.f.api.pages_runs = [manual]
        self.f.api.page_jobs[300] = [{'name': 'package', 'status': 'completed', 'conclusion': 'success',
                                      'run_id': 300, 'head_sha': self.f.sha, 'run_attempt': 1}]
        delayed = self.f.workflow_run(400, 12, contract.PAGES_PATH, 'Pages release 500 from 200', '2026-10-22T00:40:00Z')
        self.f.api.extra_runs[400] = delayed
        with self.assertRaisesRegex(ValueError, 'supersedes'):
            pipeline.prepare_pages(self.f.context(contract.PAGES_PATH, run=delayed), 500, 200, False, self.f.work('delayed'))
        before = len(self.f.api.dispatches)
        with self.assertRaisesRegex(ValueError, 'supersedes'):
            self.publish('old-producer')
        self.assertEqual(len(self.f.api.dispatches), before)

    def test_successful_recovery_generation_survives_in_progress_or_failed_package_retry(self):
        self.publish()
        self.f.pages_run['run_attempt'] = 2
        self.f.api.pages_runs = [self.f.pages_run]
        self.f.api.page_jobs[300] = [{'name': 'package', 'status': 'completed', 'conclusion': 'success',
                                      'run_id': 300, 'head_sha': self.f.sha, 'run_attempt': 1}]
        delayed = self.f.workflow_run(400, 12, contract.PAGES_PATH, 'Pages release 500 from 200', '2026-10-22T00:40:00Z')
        self.f.api.extra_runs[400] = delayed
        for status, conclusion in [('in_progress', None), ('completed', 'failure')]:
            with self.subTest(status=status):
                self.f.api.page_jobs[300] = self.f.api.page_jobs[300][:1] + [{
                    'name': 'package', 'status': status, 'conclusion': conclusion,
                    'run_id': 300, 'head_sha': self.f.sha, 'run_attempt': 2}]
                with self.assertRaisesRegex(ValueError, 'supersedes'):
                    self.publish('old-producer-after-' + status)
                with self.assertRaisesRegex(ValueError, 'supersedes'):
                    pipeline.prepare_pages(self.f.context(contract.PAGES_PATH, run=delayed), 500, 200, False,
                                           self.f.work('old-consumer-after-' + status))

    def test_unrelated_newer_producer_id_cannot_launder_request_generation(self):
        self.publish()
        unrelated = deepcopy(self.f.producer)
        unrelated.update(id=201, created_at='2026-10-22T00:50:00Z',
                         display_title=f'Release v0.1.0 at {self.f.sha} from CI 999')
        self.f.api.extra_runs[201] = unrelated
        with self.assertRaisesRegex(ValueError, 'another release or CI run'):
            self.prepare(producer=201)
        unrelated['display_title'] = self.f.producer['display_title']
        unrelated['path'] = '.github/workflows/untrusted.yml'
        with self.assertRaisesRegex(ValueError, 'canonical workflow'):
            self.prepare('wrong-origin-workflow', producer=201)

    def test_failed_newer_package_does_not_permanently_block_earlier_valid_request(self):
        self.publish()
        self.f.api.pages_runs = [self.f.pages_run]
        self.f.api.page_jobs[300] = [{'name': 'package', 'status': 'completed', 'conclusion': 'failure',
                                      'run_id': 300, 'head_sha': self.f.sha, 'run_attempt': 1}]
        self.publish('allowed-old-request')

    def test_old_release_needs_explicit_manual_recovery(self):
        self.publish()
        self.f.api.releases[501] = {**self.f.api.releases[500], 'id': 501, 'tag_name': 'v0.2.0'}
        with self.assertRaisesRegex(ValueError, 'explicit manual recovery'):
            self.prepare()
        self.prepare('allowed-recovery', allow_older=True)
        with self.assertRaisesRegex(ValueError, 'Only an explicit manual'):
            self.prepare('forged-recovery', producer=200, allow_older=True)

    def test_new_request_after_recovery_can_intentionally_publish_again(self):
        self.publish()
        self.f.api.pages_runs = [self.f.pages_run]
        self.f.api.page_jobs[300] = [{'name': 'package', 'status': 'completed', 'conclusion': 'success',
                                      'run_id': 300, 'head_sha': self.f.sha, 'run_attempt': 1}]
        new_producer = deepcopy(self.f.producer)
        new_producer.update(id=201, created_at='2026-10-22T00:40:00Z')
        self.f.api.extra_runs[201] = new_producer
        context = self.f.context(run=new_producer)
        self.assertEqual(pipeline.publish(context, '0.1.0', self.f.sha, 100, self.f.work('new-request')), 500)
        self.assertEqual(self.f.api.dispatches[-1]['inputs']['producer_run_id'], '201')


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_ci_identity_and_effective_jobs_fail_closed(self):
        f = Fixture(self.root)
        for changes in ({'head_branch': 'other'}, {'event': 'pull_request'}, {'head_sha': '0' * 40},
                        {'workflow_id': 999}, {'head_repository': {'id': 43, 'full_name': REPO}}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                contract.workflow_run({**f.run, **changes}, workflow_id=10, path=contract.CI_PATH,
                                      repository_id=42, sha=f.sha, events=('push', 'workflow_dispatch'))
        for mutation in ('missing', 'failed', 'ambiguous'):
            jobs = deepcopy(f.jobs)
            if mutation == 'missing':
                jobs.pop()
            elif mutation == 'failed':
                jobs[0]['conclusion'] = 'failure'
            else:
                jobs.append(deepcopy(jobs[0]))
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                contract.effective_jobs(jobs, f.run)

    def test_verified_certificate_binds_identity_run_attempt_and_signed_subject(self):
        f = Fixture(self.root)
        artifact = {'id': 900, 'sha256': contract.file_digest(f.archive)}
        signature = f.signature()
        def verify(value):
            return contract.verified_attestation(value, version_sha=f.sha, repository_id=42,
                                                run=f.run, web_attempt=1, artifact=artifact)
        self.assertIn('dsseEnvelope', verify(signature))
        for key, value in {'sourceRepositoryIdentifier': '43', 'sourceRepositoryDigest': '0' * 40,
                           'sourceRepositoryRef': 'refs/pull/1/merge', 'runnerEnvironment': 'self-hosted',
                           'runInvocationURI': f'https://github.com/{REPO}/actions/runs/100/attempts/2',
                           'buildConfigURI': 'https://github.com/another/repo/workflow'}.items():
            broken = deepcopy(signature)
            broken[0]['verificationResult']['signature']['certificate'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify(broken)
        broken = deepcopy(signature)
        broken[0]['verificationResult']['statement']['subject'][0]['name'] = REPO + '/pages-release/901'
        with self.assertRaises(ValueError):
            verify(broken)

    def archive(self, extra=None):
        path = self.root / ('archive-' + str(len(list(self.root.glob('*.zip')))) + '.zip')
        with warnings.catch_warnings(), zipfile.ZipFile(path, 'w') as writer:
            warnings.simplefilter('ignore', UserWarning)
            for name, data in [('manifest.json', b'{}'), ('release.json', b'{}'), ('site/index.html', b'public')]:
                writer.writestr(name, data)
            if extra:
                writer.writestr(*extra)
        return path

    def test_safe_archive_rejects_paths_links_duplicates_and_file_directory_collisions(self):
        link = zipfile.ZipInfo('site/link')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for index, extra in enumerate([('.', b'bad'), ('../outside', b'bad'), ('/absolute', b'bad'), ('site/../outside', b'bad'),
                                      ('site\\outside', b'bad'), ('site//outside', b'bad'), ('site//', b''),
                                      ('manifest.json', b'duplicate'), ('unexpected', b'bad'),
                                      ('site', b'file-directory collision'), (link, b'/etc/passwd')]):
            with self.subTest(extra=str(extra[0])), self.assertRaises(ValueError):
                contract.safe_extract(self.archive(extra), self.root / ('extracted-' + str(index)))
            self.assertFalse((self.root / 'outside').exists())

    def test_safe_archive_enforces_size_entry_limits_and_new_output(self):
        path = self.archive()
        for kwargs in ({'max_expanded': 2}, {'max_file': 2}, {'max_entries': 2}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                contract.safe_extract(path, self.root / 'limited', **kwargs)
            self.assertFalse((self.root / 'limited').exists())
        output = contract.safe_extract(path, self.root / 'valid')
        self.assertEqual((output / 'site/index.html').read_bytes(), b'public')
        with self.assertRaises(ValueError):
            contract.safe_extract(path, output)

    def test_boolean_identifiers_duplicate_json_and_nonfinite_numbers_are_rejected(self):
        for value in (True, 0, -1, '1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                contract.identifier(value)
        for data in (b'{"id":1,"id":2}', b'{"id":NaN}'):
            with self.assertRaises(ValueError):
                contract.json_load(data)

    def test_actions_archive_download_negotiates_json_and_streams_without_forwarding_token(self):
        from urllib.error import HTTPError
        token = 'workflow-token-fixture'
        requests = []
        payload = b'PK\x03\x04' + bytes(range(256)) * 4097
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    if request.get_header('Accept') != 'application/vnd.github+json':
                        raise HTTPError(request.full_url, 415, 'unsupported media type', {}, BytesIO(b''))
                    raise HTTPError(request.full_url, 302, 'redirect', {'Location': 'https://archive.example.invalid/signed'}, BytesIO(b''))
                return BytesIO(payload)
        with patch.dict(os.environ, {'GH_TOKEN': token}):
            api = pipeline.GitHub()
        api.opener = Opener()
        target = self.root / 'actions-download.zip'
        api.download('actions/artifacts/900/zip', target)
        self.assertEqual(target.read_bytes(), payload)
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].full_url, 'https://api.github.com/repos/' + REPO + '/actions/artifacts/900/zip')
        self.assertEqual(requests[0].get_header('Accept'), 'application/vnd.github+json')
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer ' + token)
        self.assertIsNone(requests[1].get_header('Authorization'))

    def test_asset_redirect_does_not_receive_the_workflow_token(self):
        from urllib.error import HTTPError
        token = 'workflow-token-fixture'
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    raise HTTPError(request.full_url, 302, 'redirect', {'Location': 'https://asset.example.invalid/signed'}, BytesIO(b''))
                return BytesIO(b'public asset')
        with patch.dict(os.environ, {'GH_TOKEN': token}):
            api = pipeline.GitHub()
        api.opener = Opener()
        result = api.request('/repos/' + REPO + '/releases/assets/1', binary=True)
        self.assertEqual(result, b'public asset')
        self.assertEqual(requests[0].get_header('Accept'), 'application/octet-stream')
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer ' + token)
        self.assertIsNone(requests[1].get_header('Authorization'))
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            api.redirected('http://asset.example.invalid/insecure')
        for suffix, method in [('releases/assets/0', 'GET'), ('releases/assets/-1', 'GET'),
                               ('releases/assets/1/extra', 'GET'), ('releases/assets/1?raw=true', 'GET'),
                               ('releases/assets/1', 'POST')]:
            with self.subTest(suffix=suffix, method=method):
                api.request('/repos/' + REPO + '/' + suffix, binary=True, method=method)
                self.assertEqual(requests[-1].get_header('Accept'), 'application/vnd.github+json')

    def test_filtered_workflow_history_truncation_fails_closed(self):
        api = pipeline.GitHub.__new__(pipeline.GitHub)
        api.get = lambda _: {'total_count': 1000, 'workflow_runs': []}
        with self.assertRaisesRegex(ValueError, 'truncated'):
            api.pages('actions/workflows/pages.yml/runs?event=workflow_dispatch', 'workflow_runs')

    def test_workflows_preserve_six_jobs_and_remove_automatic_main_deployment(self):
        import re
        ci = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertEqual(set(re.findall(r'^  ([a-z]+):\n    (?:needs:.*\n    )?runs-on:', ci, re.MULTILINE)),
                         set(contract.REQUIRED_JOBS))
        pages = (ROOT / '.github/workflows/pages.yml').read_text()
        self.assertNotIn('workflow_run:', pages)
        self.assertNotIn('\n  release:', pages)
        self.assertIn('workflow_dispatch:', pages)
        self.assertIn('recheck-pages', pages)
        self.assertIn('group: github-pages-deployment', pages)
        self.assertIn('queue: max', pages)
        self.assertIn('cancel-in-progress: false', pages)
        self.assertNotIn('pnpm build', pages)
        self.assertIn('subject-name: ${{ github.repository }}/pages-release/${{ steps.pages_artifact.outputs.artifact-id }}', ci)
        self.assertIn("if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'", ci)


if __name__ == '__main__':
    unittest.main()
