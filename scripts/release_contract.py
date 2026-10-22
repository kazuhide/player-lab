"""Validation rules shared by release publication and Pages recovery."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import PurePosixPath
import re
import shutil
import stat
import zipfile

from product_version import require_version

REPOSITORY = 'kazuhide/player-lab'
CI_PATH = '.github/workflows/ci.yml'
PRODUCER_PATH = '.github/workflows/release.yml'
PAGES_PATH = '.github/workflows/pages.yml'
REQUIRED_JOBS = ('publication', 'build', 'web', 'webkit', 'ios', 'android')
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 1024 * 1024 * 1024
MAX_FILE = 128 * 1024 * 1024
MAX_ENTRIES = 5000
PRODUCER_TITLE = re.compile(r'Release v([0-9]+\.[0-9]+\.[0-9]+) at ([0-9a-f]{40}) from CI ([1-9][0-9]*)')
PAGES_TITLE = re.compile(r'Pages release ([1-9][0-9]*) from (manual|[1-9][0-9]*)')


def check(condition, message):
    if not condition:
        raise ValueError(message)


def identifier(value):
    check(type(value) is int and value > 0, 'A positive numeric identifier is required.')
    return value


def input_identifier(value):
    check(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]*', value), 'An identifier input is invalid.')
    return identifier(int(value))


def source_sha(value):
    check(isinstance(value, str) and SHA.fullmatch(value), 'An exact lowercase source SHA is required.')
    return value


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    value = hashlib.sha256()
    with path.open('rb') as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + '\n').encode()


def json_load(data):
    def pairs(items):
        result = {}
        for key, value in items:
            check(key not in result, 'Duplicate JSON object keys are not allowed.')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON numbers are not allowed.')))


def timestamp(value):
    check(isinstance(value, str) and value.endswith('Z'), 'A UTC workflow timestamp is required.')
    result = datetime.fromisoformat(value[:-1] + '+00:00')
    check(result.tzinfo == timezone.utc, 'A UTC workflow timestamp is required.')
    return result


def repository_identity(document):
    check(document.get('full_name') == REPOSITORY and document.get('private') is False,
          'Releases require the canonical public repository.')
    return identifier(document.get('id'))


def workflow_identity(document, path):
    check(document.get('path') == path and document.get('state') == 'active',
          'The canonical workflow must be active.')
    return identifier(document.get('id'))


def workflow_run(document, *, workflow_id, path, repository_id, sha=None, events=('workflow_dispatch',)):
    identifier(document.get('id'))
    identifier(document.get('run_attempt'))
    check(document.get('workflow_id') == workflow_id and document.get('path') == path,
          'The workflow run does not belong to the canonical workflow.')
    check(document.get('event') in events and document.get('head_branch') == 'main',
          'The workflow run must originate on main.')
    head = document.get('head_repository') or {}
    check(head.get('id') == repository_id and head.get('full_name') == REPOSITORY,
          'The workflow run must originate in this repository.')
    source_sha(document.get('head_sha'))
    check(sha is None or document['head_sha'] == sha, 'The CI source commit differs from the selected source.')
    timestamp(document.get('created_at'))
    return document


def effective_jobs(jobs, run):
    latest, seen = {}, set()
    for job in jobs:
        name, attempt = job.get('name'), identifier(job.get('run_attempt'))
        check(name in REQUIRED_JOBS and job.get('run_id') == run['id']
              and job.get('head_sha') == run['head_sha'] and attempt <= run['run_attempt'],
              'A CI job has an unexpected identity.')
        identifier(job.get('id'))
        check((name, attempt) not in seen, 'Duplicate CI jobs make the effective result ambiguous.')
        seen.add((name, attempt))
        if name not in latest or attempt > latest[name]['run_attempt']:
            latest[name] = job
    check(set(latest) == set(REQUIRED_JOBS), 'All required CI jobs must be present.')
    check(run.get('status') == 'completed' and run.get('conclusion') == 'success',
          'The selected CI run must have completed successfully.')
    check(all(job.get('status') == 'completed' and job.get('conclusion') == 'success'
              for job in latest.values()), 'Every effective CI job must succeed.')
    for job in latest.values():
        check(timestamp(job['started_at']) <= timestamp(job['completed_at']), 'A CI job interval is invalid.')
    return latest


def artifact_identity(document, *, run, web_job, repository_id, expected_id=None,
                      expected_digest=None, expected_size=None):
    artifact_id = identifier(document.get('id'))
    check(expected_id is None or artifact_id == expected_id, 'The original artifact ID differs.')
    check(document.get('name') == 'pages-release', 'The CI artifact name is invalid.')
    owner = document.get('workflow_run') or {}
    check(owner.get('id') == run['id'] and owner.get('head_sha') == run['head_sha']
          and owner.get('repository_id') == repository_id and owner.get('head_repository_id') == repository_id,
          'The CI artifact belongs to a different workflow source.')
    digest = document.get('digest', '')
    check(isinstance(digest, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', digest),
          'The CI artifact must have a SHA-256 digest.')
    check(expected_digest is None or digest == 'sha256:' + expected_digest, 'The original artifact digest differs.')
    size = identifier(document.get('size_in_bytes'))
    check(size <= MAX_ARCHIVE and (expected_size is None or size == expected_size), 'The CI artifact size differs or is too large.')
    check(timestamp(web_job['started_at']) <= timestamp(document['created_at']) <= timestamp(web_job['completed_at']),
          'The artifact was not produced by the effective web job attempt.')
    return {'id': artifact_id, 'name': 'pages-release', 'sha256': digest[7:], 'size': size}


def release_metadata(document, *, version, sha, run_id, web_attempt):
    expected = {
        'schemaVersion': 1, 'productVersion': version, 'sha': sha, 'repository': REPOSITORY,
        'ciRunId': run_id, 'ciRunAttempt': web_attempt, 'workflowPath': CI_PATH,
        'base': '/player-lab/web/', 'publicPlayerKeyConfigured': True,
        'publicAnalyticsKeyConfigured': True,
    }
    check(type(document) is dict and document == expected
          and type(document.get('schemaVersion')) is int
          and type(document.get('ciRunId')) is int and type(document.get('ciRunAttempt')) is int
          and document.get('publicPlayerKeyConfigured') is True and document.get('publicAnalyticsKeyConfigured') is True,
          'The tested version, CI identity and both public license configuration flags must match.')


def verified_attestation(results, *, version_sha, repository_id, run, web_attempt, artifact):
    """Inspect only the certificate and statement returned by gh's cryptographic verifier."""
    check(type(results) is list and 0 < len(results) <= 100, 'No verified CI attestations were returned.')
    origin = f'https://github.com/{REPOSITORY}'
    signer = f'{origin}/{CI_PATH}@refs/heads/main'
    expected_certificate = {
        'issuer': 'https://token.actions.githubusercontent.com',
        'subjectAlternativeName': signer, 'buildSignerURI': signer,
        'buildSignerDigest': version_sha, 'runnerEnvironment': 'github-hosted',
        'sourceRepositoryURI': origin, 'sourceRepositoryDigest': version_sha,
        'sourceRepositoryRef': 'refs/heads/main', 'sourceRepositoryIdentifier': str(repository_id),
        'buildConfigURI': signer, 'buildConfigDigest': version_sha,
        'buildTrigger': run['event'],
        'runInvocationURI': f'{origin}/actions/runs/{run["id"]}/attempts/{web_attempt}',
    }
    expected_subject = [{'name': f'{REPOSITORY}/pages-release/{artifact["id"]}',
                         'digest': {'sha256': artifact['sha256']}}]
    matches = []
    for result in results:
        verification = result.get('verificationResult', {})
        certificate = (verification.get('signature') or {}).get('certificate') or {}
        statement = verification.get('statement') or {}
        if (all(certificate.get(key) == value for key, value in expected_certificate.items())
                and statement.get('subject') == expected_subject
                and statement.get('predicateType') == 'https://slsa.dev/provenance/v1'):
            bundle = (result.get('attestation') or {}).get('bundle')
            check(type(bundle) is dict and 'dsseEnvelope' in bundle, 'A verified signature bundle is missing.')
            matches.append(bundle)
    check(bool(matches), 'No signed CI artifact matches this repository, source, run, attempt and artifact ID.')
    return matches[0]


def asset_names(version):
    require_version(version)
    prefix = 'player-lab-v' + version
    return {'archive': prefix + '-pages.zip', 'provenance': prefix + '-provenance.json',
            'attestation': prefix + '-ci-attestation.json', 'checksums': 'SHA256SUMS'}


def release_identity(document, *, version, sha, notes, published=True):
    identifier(document.get('id'))
    check(document.get('tag_name') == 'v' + version and document.get('target_commitish') == sha
          and document.get('name') == 'Player Lab v' + version and document.get('body') == notes
          and document.get('prerelease') is False,
          'The release version, target, title and curated notes must match.')
    check(document.get('draft') is (not published), 'The release has an unexpected publication state.')
    if published:
        check(document.get('immutable') is True, 'Only immutable published releases can be deployed.')
        timestamp(document.get('published_at'))
    return document


def asset_identity(document, name, data):
    identifier(document.get('id'))
    check(document.get('name') == name and document.get('state') == 'uploaded'
          and document.get('size') == len(data) and document.get('digest') == 'sha256:' + sha256(data),
          'A release asset identity or digest differs.')


def asset_file_identity(document, name, path):
    identifier(document.get('id'))
    check(document.get('name') == name and document.get('state') == 'uploaded'
          and document.get('size') == path.stat().st_size
          and document.get('digest') == 'sha256:' + file_digest(path),
          'A release asset identity or digest differs.')


def checksums(files):
    return ''.join(file_digest(path) + '  ' + name + '\n' for name, path in sorted(files.items())).encode()


def check_checksums(data, names, digests):
    expected = ''.join(digests[name] + '  ' + name + '\n' for name in sorted(names)).encode()
    check(data == expected, 'The release checksum file differs from its retained assets.')


def provenance(document, *, repository_id, version, sha, run, jobs, all_jobs):
    required = {'schemaVersion', 'repository', 'repositoryId', 'productVersion', 'sha', 'ciRunId',
                'ciWorkflowId', 'ciWorkflowPath', 'ciWebRunAttempt', 'qualificationJobs', 'artifact',
                'manifestSha256', 'releaseMetadataSha256', 'notesSha256'}
    check(type(document) is dict and set(document) == required, 'The release provenance schema is invalid.')
    for key in ('repositoryId', 'ciRunId', 'ciWorkflowId', 'ciWebRunAttempt'):
        identifier(document[key])
    check(document['schemaVersion'] == 1 and type(document['schemaVersion']) is int
          and document['repository'] == REPOSITORY and document['repositoryId'] == repository_id
          and document['productVersion'] == version and document['sha'] == sha
          and document['ciRunId'] == run['id'] and document['ciWorkflowId'] == run['workflow_id']
          and document['ciWorkflowPath'] == CI_PATH,
          'The release provenance differs from independently verified CI.')
    artifact = document['artifact']
    check(type(artifact) is dict and set(artifact) == {'id', 'name', 'sha256', 'size'}
          and artifact['name'] == 'pages-release', 'The provenance artifact is invalid.')
    identifier(artifact['id'])
    check(type(artifact['size']) is int and 0 < artifact['size'] <= MAX_ARCHIVE
          and isinstance(artifact['sha256'], str) and DIGEST.fullmatch(artifact['sha256']), 'The provenance archive identity is invalid.')
    for key in ('manifestSha256', 'releaseMetadataSha256', 'notesSha256'):
        check(isinstance(document[key], str) and DIGEST.fullmatch(document[key]), 'A provenance digest is invalid.')
    recorded = document['qualificationJobs']
    check(type(recorded) is dict and set(recorded) == set(REQUIRED_JOBS), 'All CI qualification jobs must be recorded.')
    source_web_job = None
    source_webkit_job = None
    for name, reference in recorded.items():
        check(type(reference) is dict and set(reference) == {'id', 'attempt'}, 'A CI qualification job reference is invalid.')
        identifier(reference['id'])
        identifier(reference['attempt'])
        matches = [job for job in all_jobs if job['id'] == reference['id'] and job['name'] == name
                   and job['run_attempt'] == reference['attempt'] and job.get('status') == 'completed'
                   and job.get('conclusion') == 'success']
        check(len(matches) == 1 and reference['attempt'] <= jobs[name]['run_attempt'], 'A recorded successful CI job is not present.')
        if name == 'web':
            source_web_job = matches[0]
        if name == 'webkit':
            source_webkit_job = matches[0]
    check(document['ciWebRunAttempt'] == source_web_job['run_attempt'],
          'The signed archive generation attempt must match the recorded successful web job.')
    check(source_webkit_job['run_attempt'] >= source_web_job['run_attempt']
          and timestamp(source_webkit_job['started_at']) >= timestamp(source_web_job['completed_at'])
          and not any(job['name'] == 'web' and source_web_job['run_attempt'] < job['run_attempt']
                      <= source_webkit_job['run_attempt'] for job in all_jobs),
          'The recorded WebKit gate must qualify this archive generation, without an intervening web attempt.')
    return artifact, source_web_job


def producer_origin(run, release_provenance):
    match = PRODUCER_TITLE.fullmatch(run.get('display_title', ''))
    check(match is not None, 'The producer request has no canonical input identity.')
    version, sha, ci_id = match.groups()
    check(require_version(version) == release_provenance['productVersion'] and sha == release_provenance['sha']
          and int(ci_id) == release_provenance['ciRunId'], 'The producer run was requested for another release or CI run.')
    return timestamp(run['created_at']), identifier(run['id'])


def request_identity(run):
    match = PAGES_TITLE.fullmatch(run.get('display_title', ''))
    check(match is not None, 'The Pages request has no canonical input identity.')
    release_id, origin = match.groups()
    return int(release_id), None if origin == 'manual' else int(origin)


def require_current_request(current_generation, accepted_generations):
    check(not any(other > current_generation for other in accepted_generations),
          'A newer accepted publication or recovery request supersedes this request.')


def safe_extract(archive, output, *, max_expanded=MAX_EXPANDED, max_file=MAX_FILE, max_entries=MAX_ENTRIES):
    """Extract only the bounded, regular-file Pages archive into a new directory."""
    metadata = archive.lstat()
    check(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and 0 < metadata.st_size <= MAX_ARCHIVE,
          'The archive must be a bounded regular file without links.')
    check(not output.exists() and not output.is_symlink(), 'Archive extraction requires a new directory.')
    with zipfile.ZipFile(archive) as reader:
        entries = reader.infolist()
        check(0 < len(entries) <= max_entries, 'The archive entry count exceeds its limit.')
        names, files, total = set(), set(), 0
        for entry in entries:
            name = entry.filename
            path = PurePosixPath(name.rstrip('/'))
            check(name and path.parts and entry.orig_filename == name and '\\' not in name and '\0' not in name and not path.is_absolute()
                  and all(part not in {'', '.', '..'} for part in path.parts)
                  and name == path.as_posix() + ('/' if entry.is_dir() else '') and name not in names,
                  'The archive contains a duplicate or noncanonical path.')
            names.add(name)
            check(path.parts[0] in {'site', 'manifest.json', 'release.json'}
                  and (path.parts[0] == 'site' or len(path.parts) == 1), 'The archive has an unexpected top-level path.')
            mode = (entry.external_attr >> 16) & 0xffff
            check(not entry.flag_bits & 1 and (stat.S_IFMT(mode) in (0, stat.S_IFDIR) if entry.is_dir()
                  else stat.S_IFMT(mode) in (0, stat.S_IFREG)), 'Archive links, encryption and special files are not allowed.')
            check(entry.file_size <= max_file, 'An archive file exceeds its size limit.')
            if not entry.is_dir():
                files.add(path.as_posix())
                total += entry.file_size
            check(total <= max_expanded, 'The expanded archive exceeds its size limit.')
        check({'manifest.json', 'release.json'} <= files and any(name.startswith('site/') for name in files),
              'The Pages archive is incomplete.')
        check(all(not any(parent.as_posix() in files for parent in PurePosixPath(name).parents)
                  for name in files), 'An archive file is also used as a directory.')
        output.mkdir()
        try:
            actual = 0
            for entry in entries:
                destination = output.joinpath(*PurePosixPath(entry.filename).parts)
                if entry.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with reader.open(entry) as source, destination.open('xb') as target:
                    size = 0
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        size += len(chunk)
                        actual += len(chunk)
                        check(size <= max_file and actual <= max_expanded, 'Archive expansion exceeds its limits.')
                        target.write(chunk)
                    check(size == entry.file_size, 'An archive file size differs from its ZIP metadata.')
        except BaseException:
            shutil.rmtree(output)
            raise
    return output
