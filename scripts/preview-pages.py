#!/usr/bin/env python3
"""Manage a loopback-only preview of a verified public Pages artifact (macOS/Linux)."""
import argparse
from contextlib import contextmanager
import fcntl
from functools import partial
import hashlib
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import re
import runpy
import secrets
import shutil
import subprocess
import sys
import tempfile
from threading import Thread
import time


ROOT = Path(__file__).resolve().parents[1]
CONTROL = '/__player_lab_preview__/'
package = runpy.run_path(str(ROOT / 'scripts/package-pages.py'))
server_types = runpy.run_path(str(ROOT / 'tests/e2e/serve-pages.py'))
HEX = re.compile(r'[0-9a-f]{64}')
ARTIFACT = re.compile(r'artifacts/artifact-[0-9a-f]{32}')


class PreviewError(ValueError):
    pass


def default_state():
    base = Path(os.environ.get('XDG_CACHE_HOME', str(Path.home() / '.cache')))
    return base / 'player-lab/preview'


def private_file(path, flags):
    return os.open(path, flags | os.O_NOFOLLOW, 0o600)


@contextmanager
def locked_state(path):
    if path.is_symlink():
        raise PreviewError('The state directory must not be a symbolic link.')
    if path.resolve().is_relative_to(ROOT):
        raise PreviewError('Choose a state directory outside the checkout.')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise PreviewError('Choose a state directory outside the checkout.')
    with os.fdopen(private_file(path / 'manager.lock', os.O_RDWR | os.O_CREAT), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield path.resolve()


def validate_record(record):
    if (not isinstance(record, dict) or record.keys() != {'schema', 'port', 'token', 'manifest', 'artifact'}
            or record['schema'] != 1 or type(record['port']) is not int or not 1024 <= record['port'] <= 65535
            or any(not isinstance(record[key], str) or not HEX.fullmatch(record[key]) for key in ('token', 'manifest'))
            or not isinstance(record['artifact'], str) or not ARTIFACT.fullmatch(record['artifact'])):
        raise PreviewError('Invalid preview receipt; no server was stopped.')
    return record


def read_record(state):
    path = state / 'server.json'
    if not path.exists() and not path.is_symlink():
        return None
    with os.fdopen(private_file(path, os.O_RDONLY), 'r') as reader:
        raw = reader.read(4097)
    if len(raw) > 4096:
        raise PreviewError('The preview receipt is too large.')
    return validate_record(json.loads(raw))


def write_record(state, record):
    descriptor, name = tempfile.mkstemp(prefix='.server-', dir=state)
    try:
        with os.fdopen(descriptor, 'w') as writer:
            json.dump(record, writer)
            writer.write('\n')
        os.replace(name, state / 'server.json')
    finally:
        Path(name).unlink(missing_ok=True)


def verify_artifact(directory, expected=None):
    manifest = directory / 'manifest.json'
    try:
        hasher = hashlib.sha256()
        with package['open_regular'](manifest) as reader:
            for block in iter(lambda: reader.read(1024 * 1024), b''):
                hasher.update(block)
        digest = hasher.hexdigest()
        if expected and digest != expected:
            raise PreviewError('The cached artifact manifest changed.')
        package['verify'](directory / 'site', manifest)
    except (OSError, ValueError) as error:
        raise PreviewError('The public artifact is missing or invalid; supply a verified --artifact-dir.') from error
    return digest


def cache_artifact(state, source, record=None):
    source = source.resolve(strict=True)
    digest = verify_artifact(source)
    if record and record['manifest'] == digest:
        try:
            verify_artifact(state / record['artifact'], digest)
            return record['artifact'], digest
        except PreviewError:
            pass  # A verified input can restore a missing or damaged cached copy.
    artifacts = state / 'artifacts'
    if artifacts.is_symlink():
        raise PreviewError('The artifact cache must not be a symbolic link.')
    artifacts.mkdir(exist_ok=True)
    destination = artifacts / ('artifact-' + secrets.token_hex(16))
    destination.mkdir(mode=0o700)
    try:
        records = package['read_manifest'](source / 'manifest.json')
        for name in records:
            target = destination / 'site' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with package['open_regular'](source / 'site' / name) as reader, target.open('xb') as writer:
                shutil.copyfileobj(reader, writer, length=1024 * 1024)
        with package['open_regular'](source / 'manifest.json') as reader, (destination / 'manifest.json').open('xb') as writer:
            shutil.copyfileobj(reader, writer)
        verify_artifact(destination, digest)
    except BaseException:
        shutil.rmtree(destination)
        raise
    return str(destination.relative_to(state)), digest


def contact(record, action='health'):
    """Authenticate the live instance; never infer ownership from a cached PID."""
    connection = HTTPConnection('127.0.0.1', record['port'], timeout=1)
    try:
        try:
            connection.request('POST' if action == 'stop' else 'GET', CONTROL + action,
                               headers={'X-Player-Lab-Preview': record['token']})
            response = connection.getresponse()
            raw = response.read(4097)
        except ConnectionRefusedError:
            return None
        except OSError as error:
            raise PreviewError('Cannot verify preview ownership; no server was stopped.') from error
        if response.status != 200 or len(raw) > 4096:
            raise PreviewError('This port is not the recorded preview; no server was stopped.')
        try:
            data = json.loads(raw)
        except ValueError as error:
            raise PreviewError('Unexpected preview response; no server was stopped.') from error
        if (not isinstance(data, dict) or data.get('token') != record['token']
                or data.get('manifest') != record['manifest'] or type(data.get('available')) is not bool):
            raise PreviewError('Preview ownership differs; no server was stopped.')
        return data
    finally:
        connection.close()


def stop_server(state, record):
    if not record:
        return
    if contact(record) is not None:
        contact(record, 'stop')
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                if contact(record) is None:
                    break
            except PreviewError:
                # Closing a listener can reset the last accepted health connection.
                # Wait for a refused connection; never send a process signal.
                pass
            time.sleep(0.05)
        else:
            raise PreviewError('The recorded preview did not stop; no process signal was sent.')
    (state / 'server.json').unlink(missing_ok=True)


def start_server(state, artifact, digest, port):
    record = validate_record({'schema': 1, 'port': port, 'token': secrets.token_hex(32),
                              'manifest': digest, 'artifact': artifact})
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('BITMOVIN_', 'VITE_', 'EXPO_PUBLIC_', 'PLAYER_LAB_PUBLIC_'))}
    with os.fdopen(private_file(state / 'server.log', os.O_WRONLY | os.O_CREAT | os.O_APPEND), 'a') as log:
        process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '_serve'],
                                   stdin=subprocess.PIPE, stdout=log, stderr=log,
                                   cwd=state, env=environment, start_new_session=True)
    try:
        process.stdin.write(json.dumps({'state': str(state), 'record': record}).encode())
        process.stdin.close()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise PreviewError('Preview could not start; the port may already be in use.')
            try:
                if contact(record):
                    write_record(state, record)
                    return record
            except PreviewError:
                # A different listener on the requested port is never stopped.
                raise PreviewError('The port is occupied by a different server; no server was stopped.') from None
            time.sleep(0.05)
        raise PreviewError('Preview startup did not acknowledge ownership.')
    except BaseException:
        if process.poll() is None:
            process.terminate()  # This call owns the Popen child, never a stored PID.
            process.wait(timeout=5)
        raise


def serve():
    payload = json.loads(sys.stdin.buffer.read(4097))
    state = Path(payload['state']).resolve(strict=True)
    record = validate_record(payload['record'])
    artifact = state / record['artifact']
    verify_artifact(artifact, record['manifest'])
    site = artifact / 'site'

    class Handler(server_types['PagesHandler']):
        def control(self, action):
            if not secrets.compare_digest(self.headers.get('X-Player-Lab-Preview', ''), record['token']):
                self.send_error(403)
                return
            data = {'token': record['token'], 'manifest': record['manifest'],
                    'available': all((site / name).is_file() for name in ('index.html', 'web/index.html', 'ja/guide/index.html'))}
            raw = json.dumps(data).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)
            self.wfile.flush()
            if action == 'stop':
                Thread(target=self.server.shutdown, daemon=True).start()

        def do_GET(self):
            if self.path == CONTROL + 'health':
                self.control('health')
            else:
                super().do_GET()

        def do_POST(self):
            if self.path == CONTROL + 'stop':
                self.control('stop')
            else:
                self.send_error(404)

    server = server_types['PagesServer'](('127.0.0.1', record['port']), partial(Handler, directory=str(site)))
    try:
        server.serve_forever(poll_interval=0.05)
    finally:
        server.server_close()


def main():
    if sys.argv[1:] == ['_serve']:
        serve()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'status', 'stop', 'restart'])
    parser.add_argument('--artifact-dir', type=Path, help='Directory containing site/ and the separate manifest.json.')
    parser.add_argument('--state-dir', type=Path, default=default_state(), help='Stable cache outside the checkout.')
    parser.add_argument('--port', type=int, help='Loopback port, default 5218 on first start.')
    args = parser.parse_args()
    if args.port is not None and not 1024 <= args.port <= 65535:
        parser.error('Use a port from 1024 to 65535.')
    if args.action in ('status', 'stop') and (args.artifact_dir is not None or args.port is not None):
        parser.error('Only start and restart accept --artifact-dir or --port.')
    try:
        with locked_state(args.state_dir) as state:
            record = read_record(state)
            if args.action == 'stop':
                stop_server(state, record)
                print('Preview stopped.' if record else 'No managed preview is recorded.')
                return
            live = contact(record) if record else None
            if args.action == 'status':
                if not live:
                    raise PreviewError('The managed preview is not running.')
                if not live['available']:
                    raise PreviewError('The cached site is missing; restart with --artifact-dir to restore it.')
                verify_artifact(state / record['artifact'], record['manifest'])
            else:
                if live and args.action == 'start':
                    if args.artifact_dir or (args.port is not None and args.port != record['port']):
                        raise PreviewError('A managed preview is running; use restart to change its artifact or port.')
                    verify_artifact(state / record['artifact'], record['manifest'])
                else:
                    if args.artifact_dir:
                        artifact, digest = cache_artifact(state, args.artifact_dir, record)
                    elif record:
                        artifact, digest = record['artifact'], verify_artifact(state / record['artifact'], record['manifest'])
                    else:
                        raise PreviewError('The first start needs --artifact-dir containing site/ and manifest.json.')
                    port = args.port if args.port is not None else record['port'] if record else 5218
                    stop_server(state, record)
                    record = start_server(state, artifact, digest, port)
            print(f'http://localhost:{record["port"]}/player-lab/ja/guide/')
            print(f'http://localhost:{record["port"]}/player-lab/guide/')
            print(f'http://localhost:{record["port"]}/player-lab/web/')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Preview: {error}\n')


if __name__ == '__main__':
    main()
