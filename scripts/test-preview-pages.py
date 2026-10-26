"""Exercise the public preview lifecycle using owned temporary artifacts and ports."""
from functools import partial
from http.client import HTTPConnection
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import runpy
import shutil
import socket
import subprocess
import sys
import tempfile
from threading import Thread
import unittest


SCRIPT = Path(__file__).with_name('preview-pages.py')

def package_fixture():
    return runpy.run_path(str(Path(__file__).with_name('test-pages-package.py')))['PagesPackageTests']('runTest')


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class PreviewTests(unittest.TestCase):
    def setUp(self):
        fixture = package_fixture()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.make_package()
        self.root = fixture.root
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        fixture.output.rename(self.bundle / 'site')
        fixture.manifest.rename(self.bundle / 'manifest.json')
        self.state = self.root / 'state'
        self.port = free_port()
        self.receipt = None
        self.addCleanup(self.stop_owned)

    def cli(self, action, *options):
        return subprocess.run([sys.executable, '-B', str(SCRIPT), action,
                               '--state-dir', str(self.state), *map(str, options)],
                              capture_output=True, text=True, timeout=20)

    def start(self):
        result = self.cli('start', '--artifact-dir', self.bundle, '--port', self.port)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.receipt = (self.state / 'server.json').read_text()
        self.assertNotIn(json.loads(self.receipt)['token'], result.stdout + result.stderr)
        return json.loads(self.receipt)

    def stop_owned(self):
        if self.receipt:
            (self.state / 'server.json').write_text(self.receipt)
            self.cli('stop')

    def get(self, path):
        connection = HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_start_survives_source_removal_and_restart_uses_the_verified_cache(self):
        first = self.start()
        shutil.rmtree(self.bundle)
        self.assertEqual(self.get('/player-lab/guide/start/'), (200, b'public guide'))
        self.assertEqual(self.get('/player-lab/ja/guide/start/'), (200, b'public guide'))
        self.assertEqual(self.get('/manifest.json')[0], 404)
        self.assertEqual(self.get('/player-lab/../server.json')[0], 404)
        result = self.cli('restart')
        self.assertEqual(result.returncode, 0, result.stderr)
        second = json.loads((self.state / 'server.json').read_text())
        self.assertNotEqual(first['token'], second['token'])
        self.assertEqual(first['artifact'], second['artifact'])
        self.receipt = json.dumps(second)
        self.assertEqual(self.cli('status').returncode, 0)
        self.assertEqual(self.get('/player-lab/web/')[0], 200)
        self.assertEqual(self.cli('stop').returncode, 0)
        self.receipt = None
        self.assertEqual(self.cli('status').returncode, 1)

    def test_missing_cached_site_is_reported_and_can_be_replaced_before_restart(self):
        record = self.start()
        shutil.rmtree(self.state / record['artifact'] / 'site')
        status = self.cli('status')
        self.assertNotEqual(status.returncode, 0)
        self.assertIn('missing', status.stderr.lower())
        result = self.cli('restart')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('artifact', result.stderr.lower())
        result = self.cli('restart', '--artifact-dir', self.bundle)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.receipt = (self.state / 'server.json').read_text()
        self.assertEqual(self.get('/player-lab/web/')[0], 200)

    def test_wrong_ownership_token_never_stops_the_live_server(self):
        record = self.start()
        record['token'] = '0' * 64
        (self.state / 'server.json').write_text(json.dumps(record))
        self.assertNotEqual(self.cli('stop').returncode, 0)
        self.assertNotEqual(self.cli('restart').returncode, 0)
        self.assertEqual(self.get('/player-lab/web/')[0], 200)
        self.assertEqual(self.get('/__player_lab_preview__/health')[0], 403)

    def test_rejected_replacement_keeps_the_current_preview_running(self):
        self.start()
        (self.bundle / 'site/web/index.html').write_text('changed after packaging')
        result = self.cli('restart', '--artifact-dir', self.bundle)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.get('/player-lab/web/')[0], 200)
        self.assertEqual((self.state / 'server.json').read_text(), self.receipt)

    def test_repeated_start_is_idempotent_and_cache_is_reused_for_the_same_artifact(self):
        first = self.start()
        self.assertEqual(self.cli('start').returncode, 0)
        self.assertEqual((self.state / 'server.json').read_text(), self.receipt)
        result = self.cli('restart', '--artifact-dir', self.bundle)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.receipt = (self.state / 'server.json').read_text()
        self.assertEqual(first['artifact'], json.loads(self.receipt)['artifact'])
        self.assertEqual(len(list((self.state / 'artifacts').iterdir())), 1)

    def test_an_occupied_port_and_stale_receipt_cannot_stop_another_server(self):
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass
        other = ThreadingHTTPServer(('127.0.0.1', self.port),
                                    partial(QuietHandler, directory=str(self.bundle / 'site')))
        thread = Thread(target=other.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(other.server_close)
        self.addCleanup(other.shutdown)
        result = self.cli('start', '--artifact-dir', self.bundle, '--port', self.port)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.state / 'server.json').exists())
        self.state.mkdir(exist_ok=True)
        (self.state / 'server.json').write_text(json.dumps({
            'schema': 1, 'port': self.port, 'token': '0' * 64,
            'manifest': '1' * 64, 'artifact': 'artifacts/artifact-' + 'a' * 32,
        }))
        self.assertNotEqual(self.cli('stop').returncode, 0)
        self.assertEqual(self.get('/index.html')[0], 200)

    def test_corrupt_artifacts_and_symlinked_state_fail_without_starting(self):
        (self.bundle / 'site/web/index.html').write_text('changed after packaging')
        result = self.cli('start', '--artifact-dir', self.bundle, '--port', self.port)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.state / 'server.json').exists())
        if self.state.exists():
            shutil.rmtree(self.state)
        outside = self.root / 'outside'
        outside.mkdir()
        self.state.symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(self.cli('status').returncode, 0)
        self.assertFalse(list(outside.iterdir()))


if __name__ == '__main__':
    unittest.main()
