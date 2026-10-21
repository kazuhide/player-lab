"""Serve only an existing public Pages artifact under its project URL prefix."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import TCPServer
from urllib.parse import unquote, urlsplit
import argparse

PREFIX = '/player-lab/'


class PagesServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer resolves a hostname before listening; this can stall on macOS.
        # https://github.com/actions/runner-images/issues/14409
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class PagesHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.mpd': 'application/dash+xml',
        '.m3u8': 'application/vnd.apple.mpegurl',
        '.m4s': 'video/iso.segment',
        '.vtt': 'text/vtt',
    }

    def send_head(self):
        route = unquote(urlsplit(self.path).path)
        if not route.startswith(PREFIX):
            self.send_error(404)
            return None
        parts = route[len(PREFIX):].split('/')
        if any(part.startswith('.') for part in parts):
            self.send_error(404)
            return None
        root = Path(self.directory).resolve()
        target = Path(self.translate_path(self.path))
        try:
            outside = not target.resolve().is_relative_to(root)
            linked = any(root.joinpath(*parts[:index]).is_symlink() for index in range(1, len(parts) + 1))
        except (OSError, ValueError):
            outside, linked = True, True
        if outside or linked:
            self.send_error(404)
            return None
        return super().send_head()

    def translate_path(self, path):
        route = unquote(urlsplit(path).path)
        return str(Path(self.directory).resolve().joinpath(*route[len(PREFIX):].split('/')))

    def list_directory(self, path):
        self.send_error(404)
        return None

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--port', required=True, type=int)
    args = parser.parse_args()
    root = args.directory.resolve(strict=True)
    if not root.is_dir() or not 1024 <= args.port <= 65535:
        parser.error('Use a public artifact directory and a port from 1024 to 65535.')
    handler = partial(PagesHandler, directory=str(root))
    PagesServer(('127.0.0.1', args.port), handler).serve_forever()


if __name__ == '__main__':
    main()
