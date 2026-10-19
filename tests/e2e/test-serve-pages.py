"""Check the static test server's public-root boundary with owned temporary files."""
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import runpy
import tempfile
import unittest

PagesHandler = runpy.run_path(str(Path(__file__).with_name('serve-pages.py')))['PagesHandler']


class PagesServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='player-lab-pages-server-test-')
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        self.public = directory / 'public'
        self.public.mkdir()
        self.outside = directory / 'outside.txt'
        self.outside.write_text('owned-outside-sentinel')
        (self.public / 'index.html').write_text('public-index')
        (self.public / 'empty').mkdir()
        (self.public / '.hidden').write_text('hidden-sentinel')
        (self.public / 'linked.txt').symlink_to(self.outside)
        for name in ['manifest.mpd', 'master.m3u8', 'part.m4s', 'captions.vtt']:
            (self.public / name).write_text('public-fixture')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(PagesHandler, directory=str(self.public)))
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path):
        connection = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, response.getheader('Content-Type'), response.read()
        finally:
            connection.close()

    def test_repeated_slash_never_serves_an_absolute_file_outside_public_root(self):
        path = '/player-lab/' + self.outside.as_posix()
        for method in ['GET', 'HEAD']:
            with self.subTest(method=method):
                status, _, body = self.request(method, path)
                self.assertEqual(status, 404)
                self.assertNotIn(b'owned-outside-sentinel', body)

    def test_prefix_listing_hidden_traversal_and_symlink_boundaries(self):
        for path in ['/', '/player-lab/empty/', '/player-lab/missing.html', '/player-lab/.hidden',
                     '/player-lab/%2e%2e/outside.txt', '/player-lab/linked.txt']:
            with self.subTest(path=path):
                self.assertEqual(self.request('GET', path)[0], 404)

    def test_static_get_and_head_keep_media_types(self):
        for name, expected_type in [('manifest.mpd', 'application/dash+xml'),
                                    ('master.m3u8', 'application/vnd.apple.mpegurl'),
                                    ('part.m4s', 'video/iso.segment'), ('captions.vtt', 'text/vtt')]:
            with self.subTest(file=name):
                self.assertEqual(self.request('GET', '/player-lab/' + name),
                                 (200, expected_type, b'public-fixture'))
                self.assertEqual(self.request('HEAD', '/player-lab/' + name),
                                 (200, expected_type, b''))
        self.assertEqual(self.request('GET', '/player-lab/')[2], b'public-index')


if __name__ == '__main__':
    unittest.main()
