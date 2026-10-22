#!/usr/bin/env python3
"""Promote a signed CI archive to an immutable release and publish retained bytes."""

import argparse
from html.parser import HTMLParser
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from product_version import require_version
from release_contract import (
    CI_PATH, MAX_ARCHIVE, PAGES_PATH, PRODUCER_PATH, REPOSITORY, REQUIRED_JOBS,
    artifact_identity, asset_file_identity, asset_identity, asset_names, check, check_checksums, checksums,
    effective_jobs, file_digest, identifier, input_identifier, json_bytes, json_load,
    producer_origin, provenance, qualification_jobs, release_identity, release_metadata,
    repository_identity, request_identity, require_current_request, safe_extract,
    sha256, source_sha, timestamp, verified_attestation, workflow_identity, workflow_run,
)

JSON_LIMIT = 8 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class GitHub:
    """Use fixed GitHub API hosts; never forward authorization to asset redirects."""

    def __init__(self):
        self.token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        check(bool(self.token), 'A workflow GitHub token is required.')
        self.opener = build_opener(NoRedirect())

    def request(self, endpoint, *, method='GET', data=None, binary=False, output=None):
        check((endpoint == f'/repos/{REPOSITORY}' or endpoint.startswith(f'/repos/{REPOSITORY}/')) and '\n' not in endpoint,
              'Only canonical repository API endpoints are accepted.')
        host = 'uploads.github.com' if method == 'UPLOAD' else 'api.github.com'
        headers = {'Authorization': 'Bearer ' + self.token, 'X-GitHub-Api-Version': '2022-11-28',
                   'Accept': 'application/octet-stream' if binary else 'application/vnd.github+json',
                   'User-Agent': 'player-lab-release'}
        if method == 'UPLOAD':
            method = 'POST'
            headers['Content-Type'] = 'application/octet-stream'
            headers['Content-Length'] = str(os.fstat(data.fileno()).st_size)
        elif data is not None:
            data = json_bytes(data)
            headers['Content-Type'] = 'application/json'
        url = 'https://' + host + endpoint
        request = Request(url, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=60)
        except HTTPError as error:
            if error.code == 404:
                return None
            if binary and error.code in (301, 302, 303, 307, 308):
                url = error.headers.get('Location', '')
                error.close()
                response = self.redirected(url)
            else:
                raise ValueError('GitHub API request failed with HTTP ' + str(error.code) + '.') from None
        limit = MAX_ARCHIVE if binary else JSON_LIMIT
        with response:
            if output is None:
                body = response.read(limit + 1)
                check(len(body) <= limit, 'A GitHub API response exceeds its limit.')
                return body if binary else (json_load(body) if body else {})
            try:
                with output.open('xb') as target:
                    total = 0
                    for chunk in iter(lambda: response.read(1024 * 1024), b''):
                        total += len(chunk)
                        check(total <= limit, 'A GitHub download exceeds its limit.')
                        target.write(chunk)
            except BaseException:
                output.unlink(missing_ok=True)
                raise
        return output

    def redirected(self, url):
        for _ in range(4):
            address = urlsplit(url)
            check(address.scheme == 'https' and bool(address.hostname) and address.username is None
                  and address.password is None, 'A binary download redirect must use HTTPS.')
            try:
                return self.opener.open(Request(url, headers={'User-Agent': 'player-lab-release'}), timeout=60)
            except HTTPError as error:
                if error.code not in (301, 302, 303, 307, 308):
                    raise ValueError('GitHub asset download failed.') from None
                url = error.headers.get('Location', '')
                error.close()
        raise ValueError('Too many asset download redirects.')

    def get(self, suffix):
        return self.request(f'/repos/{REPOSITORY}' + ('/' + suffix if suffix else ''))

    def pages(self, suffix, key=None):
        result = []
        for page in range(1, 21):
            separator = '&' if '?' in suffix else '?'
            document = self.get(suffix + separator + urlencode({'per_page': 100, 'page': page}))
            check(document is not None, 'A required GitHub record is unavailable.')
            items = document[key] if key else document
            check(type(items) is list and len(items) <= 100, 'A GitHub list response is invalid.')
            if key == 'workflow_runs':
                check(type(document.get('total_count')) is int and document['total_count'] < 1000,
                      'The filtered workflow history may be truncated; publication ordering is not verifiable.')
            result.extend(items)
            if len(items) < 100:
                return result
        raise ValueError('GitHub pagination exceeds the release verification limit.')

    def change(self, suffix, data, method='POST'):
        result = self.request(f'/repos/{REPOSITORY}/' + suffix, method=method, data=data)
        check(result is not None, 'A required GitHub write endpoint is unavailable.')
        return result

    def download(self, suffix, output):
        check(self.request(f'/repos/{REPOSITORY}/' + suffix, binary=True, output=output) is not None,
              'The requested GitHub archive or asset is unavailable.')


def command(args, *, cwd=ROOT, timeout=120):
    result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=timeout)
    check(result.returncode == 0, 'A source or cryptographic verification command failed.')
    check(len(result.stdout) <= 20 * 1024 * 1024, 'Verification output exceeds its limit.')
    return result.stdout


def source_file(sha, name, *, root=ROOT):
    return command(['git', 'show', sha + ':' + name], cwd=root)


def source_identity(sha, version, *, root=ROOT):
    check(json_load(source_file(sha, 'package.json', root=root)).get('version') == version,
          'The selected source product version differs.')
    notes = source_file(sha, f'docs/releases/{version}.md', root=root)
    check(0 < len(notes) <= 65536 and b'\r' not in notes and notes.endswith(b'\n')
          and notes.startswith(('# Player Lab ' + version + '\n').encode()),
          'Curated versioned release notes are required in the selected source.')
    return notes.decode('utf-8')


def verify_main_ancestry(api, sha, *, root=ROOT):
    branch = api.get('branches/main')
    check(branch is not None, 'The canonical main branch is unavailable.')
    main = source_sha(branch['commit']['sha'])
    comparison = api.get('compare/' + sha + '...' + main)
    check(comparison is not None and comparison.get('status') in ('ahead', 'identical')
          and comparison.get('merge_base_commit', {}).get('sha') == sha,
          'The release target must be in the canonical main history.')
    command(['git', 'merge-base', '--is-ancestor', sha, 'HEAD'], cwd=root)


class Context:
    def __init__(self, api, path, *, root=ROOT):
        self.api, self.root = api, root
        check(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY
              and os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Release workflows must run on canonical main.')
        self.repository_id = repository_identity(api.get('') or {})
        self.run_id = input_identifier(os.environ.get('GITHUB_RUN_ID', ''))
        workflow = api.get('actions/workflows/' + path.rsplit('/', 1)[1])
        workflow_id = workflow_identity(workflow or {}, path)
        self.run = workflow_run(api.get(f'actions/runs/{self.run_id}') or {},
                                workflow_id=workflow_id, path=path, repository_id=self.repository_id)
        check(self.run['head_sha'] == os.environ.get('GITHUB_SHA')
              and command(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip() == self.run['head_sha'],
              'The executing workflow checkout must match its exact main source.')

    def ci(self, run_id, sha):
        workflow_id = workflow_identity(self.api.get('actions/workflows/ci.yml') or {}, CI_PATH)
        run = workflow_run(self.api.get(f'actions/runs/{run_id}') or {}, workflow_id=workflow_id,
                           path=CI_PATH, repository_id=self.repository_id, sha=sha,
                           events=('push', 'workflow_dispatch'))
        jobs = self.api.pages(f'actions/runs/{run_id}/jobs?filter=all', 'jobs')
        return run, effective_jobs(jobs, run), jobs

    def origin(self, producer_id, document):
        if producer_id is None:
            return timestamp(self.run['created_at']), self.run_id
        workflow_id = workflow_identity(self.api.get('actions/workflows/release.yml') or {}, PRODUCER_PATH)
        run = workflow_run(self.api.get(f'actions/runs/{producer_id}') or {}, workflow_id=workflow_id,
                           path=PRODUCER_PATH, repository_id=self.repository_id)
        return producer_origin(run, document)


def verify_signature(archive, *, artifact, context, run, web_attempt, web_jobs=(), bundle=None):
    args = ['gh', 'attestation', 'verify', str(archive), '--repo', REPOSITORY,
            '--signer-workflow', REPOSITORY + '/' + CI_PATH, '--source-ref', 'refs/heads/main',
            '--source-digest', run['head_sha'], '--deny-self-hosted-runners', '--format', 'json']
    if bundle is not None:
        args += ['--bundle', str(bundle)]
    results = json_load(command(args, cwd=context.root))
    digest, size = file_digest(archive), archive.stat().st_size
    if artifact is not None:
        check(size == artifact['size'] and digest == artifact['sha256'],
              'The retained archive differs from the original CI ZIP.')
        if web_attempt is not None:
            signature = verified_attestation(results, version_sha=run['head_sha'], repository_id=context.repository_id,
                                            run=run, web_attempt=web_attempt, artifact=artifact)
            return artifact, signature, web_attempt
    # An interrupted draft may retain the ZIP before its provenance was uploaded.
    # Recover its generation from the verified certificate, never from the latest attempt.
    check(type(results) is list and 0 < len(results) <= 100, 'No verified CI attestations were returned.')
    allowed = ({web_attempt} if web_attempt is not None else {
        job['run_attempt'] for job in web_jobs if job['name'] == 'web'
        and job.get('status') == 'completed' and job.get('conclusion') == 'success'})
    invocation = re.escape(f'https://github.com/{REPOSITORY}/actions/runs/{run["id"]}/attempts/')
    matches = {}
    for result in results:
        verification = result.get('verificationResult', {})
        certificate = (verification.get('signature') or {}).get('certificate') or {}
        generation = re.fullmatch(invocation + r'([1-9][0-9]*)', certificate.get('runInvocationURI', ''))
        if generation is None or int(generation[1]) not in allowed:
            continue
        attempt = int(generation[1])
        for subject in (verification.get('statement') or {}).get('subject', []):
            match = re.fullmatch(re.escape(REPOSITORY) + r'/pages-release/([1-9][0-9]*)', subject.get('name', ''))
            if match is None or subject.get('digest') != {'sha256': digest}:
                continue
            candidate = {'id': int(match[1]), 'name': 'pages-release', 'sha256': digest, 'size': size}
            if artifact is not None and candidate != artifact:
                continue
            try:
                signature = verified_attestation(results, version_sha=run['head_sha'],
                    repository_id=context.repository_id, run=run, web_attempt=attempt, artifact=candidate)
                matches[(candidate['id'], attempt)] = (candidate, signature, attempt)
            except ValueError:
                continue
    check(len(matches) == 1, 'The signed original CI artifact identity is missing or ambiguous.')
    return next(iter(matches.values()))


class BuildLabels(HTMLParser):
    def __init__(self):
        super().__init__()
        self.labels = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if 'product-build' in attributes.get('class', '').split():
            self.labels.append((attributes.get('data-product-version'), attributes.get('data-source-revision')))


def verify_package(directory, *, version, sha, run, web_attempt, root=ROOT):
    check(all(0 < (directory / name).stat().st_size <= JSON_LIMIT for name in ('release.json', 'manifest.json')),
          'The retained package metadata exceeds its size limit.')
    release_metadata(json_load((directory / 'release.json').read_bytes()), version=version, sha=sha,
                     run_id=run['id'], web_attempt=web_attempt)
    validation = directory.parent / 'source-validator'
    validation.mkdir()
    for name in ('package-pages.py', 'guide_routes.py'):
        (validation / name).write_bytes(source_file(sha, 'scripts/' + name, root=root))
    command([sys.executable, str(validation / 'package-pages.py'), '--verify-dir', str(directory / 'site'),
             '--manifest', str(directory / 'manifest.json')], cwd=root)
    pages = list((directory / 'site').rglob('*.html'))
    check(bool(pages), 'The release must contain public HTML pages.')
    for page in pages:
        parser = BuildLabels()
        parser.feed(page.read_text(encoding='utf-8'))
        check(parser.labels == [(version, sha)], 'A public page has the wrong product version or source label.')


def asset_catalog(api, release_id, allowed):
    assets, names = api.pages(f'releases/{release_id}/assets'), set()
    result = {}
    for asset in assets:
        name = asset.get('name')
        check(name in allowed and name not in names, 'The release has duplicate or unexpected assets.')
        names.add(name)
        identifier(asset.get('id'))
        check(asset.get('state') == 'uploaded' and type(asset.get('size')) is int
              and 0 < asset['size'] <= (MAX_ARCHIVE if name.endswith('.zip') else JSON_LIMIT),
              'A release asset is incomplete or too large.')
        check(re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest', '')),
              'Every retained release asset must have an API digest.')
        result[name] = asset
    return result


def download_asset(api, asset, path):
    api.download(f'releases/assets/{asset["id"]}', path)
    check(path.stat().st_size == asset['size'] and 'sha256:' + file_digest(path) == asset['digest'],
          'The downloaded release asset differs from GitHub metadata.')
    return path


def tag_identity(api, version, sha, *, create=False):
    tag = api.get('git/ref/tags/v' + version)
    if tag is None and create:
        api.change('git/refs', {'ref': 'refs/tags/v' + version, 'sha': sha})
        tag = api.get('git/ref/tags/v' + version)
    check(tag is not None and tag.get('ref') == 'refs/tags/v' + version
          and tag.get('object', {}).get('type') == 'commit' and tag['object'].get('sha') == sha,
          'The version tag must resolve directly to the selected source commit.')


def require_latest_release(api, version, *, allow_older=False):
    if allow_older:
        return
    versions = [tuple(map(int, version.split('.')))]
    for release in api.pages('releases'):
        if release.get('draft') is False and release.get('prerelease') is False:
            match = re.fullmatch(r'v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))', release.get('tag_name', ''))
            if match:
                check(release.get('immutable') is True, 'A formal release is not immutable.')
                versions.append(tuple(map(int, match[1].split('.'))))
    check(tuple(map(int, version.split('.'))) == max(versions),
          'An older release requires an explicit manual recovery request.')


def accepted_generations(context, since):
    api = context.api
    workflow_id = workflow_identity(api.get('actions/workflows/pages.yml') or {}, PAGES_PATH)
    query = urlencode({'branch': 'main', 'event': 'workflow_dispatch', 'created': '>=' + since.isoformat().replace('+00:00', 'Z')})
    runs = api.pages('actions/workflows/pages.yml/runs?' + query, 'workflow_runs')
    generations = []
    for run in runs:
        if run['id'] == context.run_id:
            continue
        workflow_run(run, workflow_id=workflow_id, path=PAGES_PATH, repository_id=context.repository_id)
        jobs = api.pages(f'actions/runs/{run["id"]}/jobs?filter=all', 'jobs')
        package_jobs = [job for job in jobs if job.get('name') == 'package']
        for job in package_jobs:
            check(job.get('run_id') == run['id'] and job.get('head_sha') == run['head_sha']
                  and identifier(job.get('run_attempt')) <= run['run_attempt'],
                  'An accepted package gate has an invalid workflow identity.')
        attempts = [job['run_attempt'] for job in package_jobs]
        check(len(attempts) == len(set(attempts)), 'The accepted package gate is ambiguous.')
        # A completed validation establishes a fence that failed retries cannot erase.
        if not any(job.get('status') == 'completed' and job.get('conclusion') == 'success' for job in package_jobs):
            continue
        release_id, producer_id = request_identity(run)
        release = api.get(f'releases/{release_id}')
        check(release is not None and release.get('immutable') is True and release.get('draft') is False
              and release.get('prerelease') is False, 'An accepted Pages request lost its immutable release.')
        if producer_id is None:
            generations.append((timestamp(run['created_at']), identifier(run['id'])))
            continue
        version = require_version(release['tag_name'][1:])
        names = asset_names(version)
        assets = asset_catalog(api, release_id, set(names.values()))
        check(names['provenance'] in assets, 'An accepted release lost its provenance.')
        asset = assets[names['provenance']]
        data = api.request(f'/repos/{REPOSITORY}/releases/assets/{asset["id"]}', binary=True)
        asset_identity(asset, names['provenance'], data)
        document = json_load(data)
        check(document.get('productVersion') == version and document.get('sha') == release['target_commitish'],
              'The accepted request release identity differs.')
        generations.append(context.origin(producer_id, document))
    return generations


def generation_guard(context, generation):
    require_current_request(generation, accepted_generations(context, generation[0]))


def verify_original(api, artifact, *, run, web_job, repository_id):
    original = api.get(f'actions/artifacts/{artifact["id"]}')
    if original is not None:
        artifact_identity(original, run=run, web_job=web_job, repository_id=repository_id,
                          expected_id=artifact['id'], expected_digest=artifact['sha256'], expected_size=artifact['size'])


def verify_retained(context, release, work, *, allow_older):
    api = context.api
    version = require_version(release['tag_name'][1:])
    sha = source_sha(release.get('target_commitish'))
    verify_main_ancestry(api, sha, root=context.root)
    notes = source_identity(sha, version, root=context.root)
    release_identity(release, version=version, sha=sha, notes=notes)
    tag_identity(api, version, sha)
    require_latest_release(api, version, allow_older=allow_older)
    names = asset_names(version)
    assets = asset_catalog(api, release['id'], set(names.values()))
    check(set(assets) == set(names.values()), 'Every verification asset must be retained in the release.')
    files = {name: download_asset(api, asset, work / name) for name, asset in assets.items()}
    check_checksums(files[names['checksums']].read_bytes(), [names[key] for key in ('archive', 'provenance', 'attestation')],
                    {name: file_digest(path) for name, path in files.items()})
    document = json_load(files[names['provenance']].read_bytes())
    ci_id = identifier(document.get('ciRunId'))
    run, jobs, all_jobs = context.ci(ci_id, sha)
    artifact, web_job = provenance(document, repository_id=context.repository_id, version=version, sha=sha,
                                   run=run, jobs=jobs, all_jobs=all_jobs)
    verify_signature(files[names['archive']], artifact=artifact, context=context, run=run,
                     web_attempt=web_job['run_attempt'], bundle=files[names['attestation']])
    verify_original(api, artifact, run=run, web_job=web_job, repository_id=context.repository_id)
    directory = safe_extract(files[names['archive']], work / 'extracted')
    check(file_digest(directory / 'manifest.json') == document['manifestSha256']
          and file_digest(directory / 'release.json') == document['releaseMetadataSha256']
          and sha256(notes.encode()) == document['notesSha256'], 'The retained metadata or curated notes digest differs.')
    verify_package(directory, version=version, sha=sha, run=run,
                   web_attempt=web_job['run_attempt'], root=context.root)
    return document, directory, assets


def prepare_pages(context, release_id, producer_id, allow_older, work):
    check(request_identity(context.run) == (release_id, producer_id), 'The Pages inputs differ from its request identity.')
    check(not allow_older or producer_id is None, 'Only an explicit manual request can restore an older release.')
    release = context.api.get(f'releases/{release_id}')
    check(release is not None, 'The selected release is unavailable.')
    document, directory, assets = verify_retained(context, release, work, allow_older=allow_older)
    generation = context.origin(producer_id, document)
    generation_guard(context, generation)
    state = {'schemaVersion': 1, 'releaseId': release_id, 'producerRunId': producer_id,
             'pagesRunId': context.run_id, 'pagesHeadSha': context.run['head_sha'],
             'allowOlderRelease': allow_older, 'provenance': document,
             'assets': {name: {key: asset[key] for key in ('id', 'name', 'size', 'digest', 'state')}
                        for name, asset in assets.items()}}
    (work / 'verified-release.json').write_bytes(json_bytes(state))
    return directory / 'site', work / 'verified-release.json'


def recheck_pages(context, state):
    check(type(state) is dict and set(state) == {'schemaVersion', 'releaseId', 'producerRunId', 'pagesRunId',
          'pagesHeadSha', 'allowOlderRelease', 'provenance', 'assets'} and state['schemaVersion'] == 1
          and type(state['schemaVersion']) is int
          and state['pagesRunId'] == context.run_id and state['pagesHeadSha'] == context.run['head_sha'],
          'The deployment state must belong to this exact Pages run.')
    release_id = identifier(state['releaseId'])
    check(request_identity(context.run) == (release_id, state['producerRunId']), 'The deployment request identity differs.')
    check(type(state['allowOlderRelease']) is bool and (not state['allowOlderRelease'] or state['producerRunId'] is None),
          'An older release requires an explicit manual recovery.')
    document = state['provenance']
    version, sha = require_version(document['productVersion']), source_sha(document['sha'])
    verify_main_ancestry(context.api, sha, root=context.root)
    notes = source_identity(sha, version, root=context.root)
    release = context.api.get(f'releases/{release_id}')
    check(release is not None, 'The selected release is unavailable before deployment.')
    release_identity(release, version=version, sha=sha, notes=notes)
    tag_identity(context.api, version, sha)
    run, jobs, all_jobs = context.ci(identifier(document['ciRunId']), sha)
    provenance(document, repository_id=context.repository_id, version=version, sha=sha,
               run=run, jobs=jobs, all_jobs=all_jobs)
    assets = asset_catalog(context.api, release_id, set(asset_names(version).values()))
    compact = {name: {key: asset[key] for key in ('id', 'name', 'size', 'digest', 'state')} for name, asset in assets.items()}
    check(compact == state['assets'] and sha256(notes.encode()) == document['notesSha256'],
          'The immutable assets or mutable release notes changed after validation.')
    require_latest_release(context.api, version, allow_older=state['allowOlderRelease'])
    generation_guard(context, context.origin(state['producerRunId'], document))


def publish(context, version, sha, ci_id, work):
    api = context.api
    verify_main_ancestry(api, sha, root=context.root)
    notes = source_identity(sha, version, root=context.root)
    run, jobs, all_jobs = context.ci(ci_id, sha)
    generation = producer_origin(context.run, {'productVersion': version, 'sha': sha, 'ciRunId': ci_id})
    require_latest_release(api, version)
    names = asset_names(version)
    matching = [release for release in api.pages('releases') if release.get('tag_name') == 'v' + version]
    check(len(matching) <= 1, 'Multiple releases use the selected version tag.')
    release = matching[0] if matching else None
    assets = {}
    if release is not None:
        check(type(release.get('draft')) is bool, 'The release state is invalid.')
        release_identity(release, version=version, sha=sha, notes=notes, published=not release['draft'])
        tag_identity(api, version, sha)
        assets = asset_catalog(api, release['id'], set(names.values()))
    files = {}
    for name, asset in assets.items():
        files[name] = download_asset(api, asset, work / name)
    archive = work / names['archive']
    artifact = None
    document = None
    web_job = jobs['web']
    if names['provenance'] in files:
        document = json_load(files[names['provenance']].read_bytes())
        artifact, web_job = provenance(document, repository_id=context.repository_id, version=version, sha=sha,
                                       run=run, jobs=jobs, all_jobs=all_jobs)
    restore_generation = archive.exists() and document is None
    if not archive.exists():
        candidates = []
        for candidate in api.pages(f'actions/runs/{ci_id}/artifacts', 'artifacts'):
            if candidate.get('name') != 'pages-release' or candidate.get('expired') is not False:
                continue
            try:
                identity = artifact_identity(candidate, run=run, web_job=web_job, repository_id=context.repository_id)
                candidates.append(identity)
            except ValueError:
                continue
        check(len(candidates) == 1, 'Exactly one nonexpired archive from the effective web job is required.')
        check(artifact is None or candidates[0] == artifact, 'The resumed provenance selects another CI artifact.')
        artifact = candidates[0]
        api.download(f'actions/artifacts/{artifact["id"]}/zip', archive)
        files[names['archive']] = archive
    artifact, bundle, signed_attempt = verify_signature(archive, artifact=artifact, context=context, run=run,
                web_attempt=None if restore_generation else web_job['run_attempt'], web_jobs=all_jobs,
                bundle=files.get(names['attestation']))
    if restore_generation:
        original = [job for job in all_jobs if job['name'] == 'web' and job['run_attempt'] == signed_attempt
                    and job.get('status') == 'completed' and job.get('conclusion') == 'success']
        check(len(original) == 1, 'The signed archive generation has no unique successful web job.')
        web_job = original[0]
    verify_original(api, artifact, run=run, web_job=web_job, repository_id=context.repository_id)
    if names['attestation'] not in files:
        files[names['attestation']] = work / names['attestation']
        files[names['attestation']].write_bytes(json_bytes(bundle))
        verify_signature(archive, artifact=artifact, context=context, run=run,
                         web_attempt=web_job['run_attempt'], bundle=files[names['attestation']])
    directory = safe_extract(archive, work / 'extracted')
    verify_package(directory, version=version, sha=sha, run=run,
                   web_attempt=web_job['run_attempt'], root=context.root)
    if document is None:
        qualified = qualification_jobs(web_job, jobs, all_jobs)
        document = {'schemaVersion': 1, 'repository': REPOSITORY, 'repositoryId': context.repository_id,
            'productVersion': version, 'sha': sha, 'ciRunId': ci_id, 'ciWorkflowId': run['workflow_id'],
            'ciWorkflowPath': CI_PATH, 'ciWebRunAttempt': web_job['run_attempt'],
            'qualificationJobs': {name: {'id': qualified[name]['id'], 'attempt': qualified[name]['run_attempt']}
                                  for name in REQUIRED_JOBS}, 'artifact': artifact,
            'manifestSha256': file_digest(directory / 'manifest.json'),
            'releaseMetadataSha256': file_digest(directory / 'release.json'), 'notesSha256': sha256(notes.encode())}
        files[names['provenance']] = work / names['provenance']
        files[names['provenance']].write_bytes(json_bytes(document))
    check(document['manifestSha256'] == file_digest(directory / 'manifest.json')
          and document['releaseMetadataSha256'] == file_digest(directory / 'release.json')
          and document['notesSha256'] == sha256(notes.encode()), 'The resumed metadata or notes differ.')
    provenance(document, repository_id=context.repository_id, version=version, sha=sha,
               run=run, jobs=jobs, all_jobs=all_jobs)
    expected_checksums = checksums({name: files[name] for name in names.values() if name != names['checksums']})
    if names['checksums'] in files:
        check(files[names['checksums']].read_bytes() == expected_checksums, 'The resumed checksum file differs.')
    else:
        files[names['checksums']] = work / names['checksums']
        files[names['checksums']].write_bytes(expected_checksums)
    generation_guard(context, generation)
    tag_identity(api, version, sha, create=True)
    if release is None:
        release = api.change('releases', {'tag_name': 'v' + version, 'target_commitish': sha,
            'name': 'Player Lab v' + version, 'body': notes, 'draft': True, 'prerelease': False})
        release_identity(release, version=version, sha=sha, notes=notes, published=False)
    if release['draft']:
        for name, path in files.items():
            if name in assets:
                asset_file_identity(assets[name], name, path)
                continue
            with path.open('rb') as body:
                result = api.request(f'/repos/{REPOSITORY}/releases/{release["id"]}/assets?' + urlencode({'name': name}),
                                     method='UPLOAD', data=body)
            check(result is not None, 'A release asset upload failed.')
            asset_file_identity(result, name, path)
        final_assets = asset_catalog(api, release['id'], set(names.values()))
        check(set(final_assets) == set(names.values()), 'Every verification asset must be uploaded before publication.')
        for name, path in files.items():
            asset_file_identity(final_assets[name], name, path)
        generation_guard(context, generation)
        api.change(f'releases/{release["id"]}', {'draft': False, 'make_latest': 'true'}, method='PATCH')
    else:
        check(set(assets) == set(names.values()), 'A published release must already contain every verification asset.')
    published = api.get(f'releases/{release["id"]}')
    release_identity(published or {}, version=version, sha=sha, notes=notes)
    tag_identity(api, version, sha)
    final_assets = asset_catalog(api, release['id'], set(names.values()))
    check(set(final_assets) == set(names.values()), 'The published release lost a verification asset.')
    for name, path in files.items():
        asset_file_identity(final_assets[name], name, path)
    require_latest_release(api, version)
    generation_guard(context, generation)
    api.change('actions/workflows/pages.yml/dispatches', {'ref': 'main', 'inputs': {
        'release_id': str(release['id']), 'producer_run_id': str(context.run_id), 'allow_older_release': 'false'}})
    return release['id']


def outputs(values):
    destination = os.environ.get('GITHUB_OUTPUT')
    check(bool(destination), 'GitHub step output is required.')
    with open(destination, 'a', encoding='utf-8') as target:
        for name, value in values.items():
            text = str(value)
            check('\n' not in text and '\r' not in text, 'A workflow output is invalid.')
            target.write(name + '=' + text + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    producer = commands.add_parser('publish')
    producer.add_argument('--version', required=True)
    producer.add_argument('--sha', required=True)
    producer.add_argument('--ci-run-id', required=True)
    producer.add_argument('--work-dir', type=Path, required=True)
    consumer = commands.add_parser('prepare-pages')
    consumer.add_argument('--release-id', required=True)
    consumer.add_argument('--producer-run-id', default='')
    consumer.add_argument('--allow-older-release', choices=('true', 'false'), required=True)
    consumer.add_argument('--work-dir', type=Path, required=True)
    final = commands.add_parser('recheck-pages')
    final.add_argument('--state-file', type=Path, required=True)
    args = parser.parse_args()
    try:
        api = GitHub()
        context = Context(api, PRODUCER_PATH if args.command == 'publish' else PAGES_PATH)
        if args.command == 'recheck-pages':
            check(args.state_file.is_file() and not args.state_file.is_symlink()
                  and args.state_file.stat().st_size <= JSON_LIMIT, 'The deployment state is missing or too large.')
            recheck_pages(context, json_load(args.state_file.read_bytes()))
            print('Rechecked immutable release identity, successful CI and publication request ordering.')
        else:
            work = args.work_dir.absolute()
            check(not work.exists() and not work.is_symlink(), 'Release work requires a new directory.')
            work.mkdir(parents=True)
            if args.command == 'publish':
                release_id = publish(context, require_version(args.version), source_sha(args.sha),
                                     input_identifier(args.ci_run_id), work)
                print('Published or verified immutable release ' + str(release_id) + ' and requested Pages publication.')
            else:
                site, state = prepare_pages(context, input_identifier(args.release_id),
                    input_identifier(args.producer_run_id) if args.producer_run_id else None,
                    args.allow_older_release == 'true', work)
                outputs({'site': site, 'state': state})
                print('Verified the retained release archive, signed CI origin and publication request.')
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError) as error:
        # Do not print external command output, tokens or artifact contents on failure.
        parser.exit(1, 'Release verification failed: ' + (str(error) if isinstance(error, ValueError) else 'A required record or verification command is unavailable.') + '\n')


if __name__ == '__main__':
    main()
