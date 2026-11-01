#!/usr/bin/env python3
"""Package the public overview and production Web app with explicit file lists."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

from guide_routes import GUIDE_ASSETS, GUIDE_FILES


SITE_FILES = {
    'index.html', 'ja/index.html', 'styles.css',
    'assets/player-preview.jpg', 'assets/favicon.svg',
} | GUIDE_ASSETS
NOTICE_FILES = {
    'PROJECT-LICENSE.txt', 'BITMOVIN-PLAYER-UI-LICENSE.txt',
    'BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt',
}
OPTIONAL_NOTICE_FILES = {'BITMOVIN-PLAYER-NOTICE.txt'}
COMPARISON_WEB_FILES = {'comparison.html', 'comparison-runner.html'}
COMPARISON_NOTICE_FILES = {
    'BITMOVIN-PLAYER-WEB-X-NOTICE.txt', 'HLS-JS-LICENSE.txt',
    'SHAKA-PLAYER-LICENSE.txt', 'SHAKA-PLAYER-THIRD-PARTY-NOTICES.txt',
}
WEB_ASSET = re.compile(
    r'assets/[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}'
    r'\.(?:js|css|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico|wasm)'
)
MEDIA_FILES = {
    'ATTRIBUTION.txt', 'assets/sintel_en.vtt', 'vod-baseline/master.m3u8',
    'vod-baseline/manifest.mpd', 'vod-sprites/master.m3u8',
    'vod-multiaudio/master.m3u8', 'vod-sprites/thumbnails/thumbnails.vtt',
    'vod-sprites/thumbnails/sprite-0.jpg',
    *(f'vod-baseline/media_{number}.m3u8' for number in range(4)),
    *(f'vod-baseline/init-stream{number}.m4s' for number in range(4)),
    'vod-baseline/comparison-360p.m3u8', 'vod-baseline/comparison-180p.m3u8',
}
MEDIA_SEGMENT = re.compile(r'vod-baseline/chunk-stream[0-3]-[0-9]{5}\.m4s')
MEDIA_SUBTITLE_SEGMENT = re.compile(r'vod-multiaudio/subtitle-(?:en|de)-[0-2][0-9]\.vtt')
OPTIONAL_MEDIA_FILES = {f'vod-multiaudio/subtitle-{language}.m3u8' for language in ('en', 'de')}
MEDIA_DIRECTORIES = {'vod-baseline', 'vod-sprites', 'vod-sprites/thumbnails', 'vod-multiaudio', 'assets'}
DASH_NAMESPACE = 'urn:mpeg:dash:schema:mpd:2011'
DASH_SCHEMA = ('urn:mpeg:DASH:schema:MPD:2011 '
               'http://standards.iso.org/ittf/PubliclyAvailableStandards/MPEG-DASH_schema_files/DASH-MPD.xsd')
DASH_ELEMENTS = {
    'MPD', 'ProgramInformation', 'ServiceDescription', 'Period', 'AdaptationSet',
    'Representation', 'SegmentTemplate', 'SegmentTimeline', 'S', 'AudioChannelConfiguration',
}
DASH_TAGS = {f'{{{DASH_NAMESPACE}}}{tag}' for tag in DASH_ELEMENTS}
EXTERNAL_ADDRESS = re.compile(r'://|\b(?:file|data|javascript):', re.IGNORECASE)


def media_reference(owner, value, files, sprite=False):
    """Allow sibling fixture reuse, but never a reference outside this package."""
    uri = urlsplit(value)
    if (not value or any(character in value for character in ['\\', '%', '\0'])
            or uri.scheme or uri.netloc or uri.query or uri.path.startswith('/')
            or (uri.fragment and not (sprite and re.fullmatch(r'xywh=\d+,\d+,\d+,\d+', uri.fragment)))):
        raise ValueError('A media reference is not a local fixture path.')
    name = posixpath.normpath(posixpath.join(posixpath.dirname(owner), uri.path))
    if name not in files or name.startswith('../'):
        raise ValueError('A media reference is outside the supplied fixture or missing.')
    return name


def check_dash(name, text, files):
    if '<!DOCTYPE' in text or '<!ENTITY' in text:
        raise ValueError('The DASH fixture must not contain document declarations.')
    schema_addresses = {
        'http://www.w3.org/2001/XMLSchema-instance', DASH_SCHEMA.split()[1],
    }
    addresses = re.findall(r'''(?:[A-Za-z][A-Za-z0-9+.-]*://|\b(?:file|data|javascript):)[^\s<>"']*''', text, re.IGNORECASE)
    if any(address not in schema_addresses for address in addresses):
        raise ValueError('The DASH fixture contains an unexpected external address.')
    root = ET.fromstring(text)
    if root.tag != f'{{{DASH_NAMESPACE}}}MPD':
        raise ValueError('The DASH fixture has an unexpected namespace.')
    for element in root.iter():
        if element.tag not in DASH_TAGS:
            raise ValueError('The DASH fixture contains an unexpected element.')
        for attribute, value in element.attrib.items():
            if attribute == '{http://www.w3.org/2001/XMLSchema-instance}schemaLocation':
                if value != DASH_SCHEMA:
                    raise ValueError('The DASH fixture has an unexpected schema address.')
            elif EXTERNAL_ADDRESS.search(value) or '\\' in value:
                raise ValueError('The DASH fixture contains an external reference.')
        if element.text and EXTERNAL_ADDRESS.search(element.text):
            raise ValueError('The DASH fixture contains an external address.')
    representations = root.findall(f'.//{{{DASH_NAMESPACE}}}Representation')
    if not representations:
        raise ValueError('The DASH fixture has no representations.')
    references = set()
    for representation in representations:
        number = representation.get('id')
        template = representation.find(f'{{{DASH_NAMESPACE}}}SegmentTemplate')
        if (number not in {'0', '1', '2', '3'} or template is None
                or template.get('initialization') != 'init-stream$RepresentationID$.m4s'
                or template.get('media') != 'chunk-stream$RepresentationID$-$Number%05d$.m4s'):
            raise ValueError('The DASH fixture has an unexpected segment template.')
        references.add(media_reference(name, f'init-stream{number}.m4s', files))
        timeline = template.findall(f'{{{DASH_NAMESPACE}}}SegmentTimeline/{{{DASH_NAMESPACE}}}S')
        count = sum(int(segment.get('r', '0')) + 1 for segment in timeline)
        if not timeline or not 1 <= count <= 1000 or any(int(segment.get('r', '0')) < 0 for segment in timeline):
            raise ValueError('The DASH fixture has an invalid segment timeline.')
        start = int(template.get('startNumber', '1'))
        if start != 1:
            raise ValueError('The DASH fixture must start at its first segment.')
        for index in range(start, start + count):
            references.add(media_reference(name, f'chunk-stream{number}-{index:05d}.m4s', files))
    return references


def collect_media(root, allow_report=True):
    files = regular_tree(root, MEDIA_DIRECTORIES)
    allowed = MEDIA_FILES | OPTIONAL_MEDIA_FILES | ({'fixture-report.json'} if allow_report else set())
    if not MEDIA_FILES <= files.keys() or any(
        name not in allowed and not MEDIA_SEGMENT.fullmatch(name) and not MEDIA_SUBTITLE_SEGMENT.fullmatch(name)
        for name in files
    ):
        raise ValueError('The media fixture contains missing or unexpected files.')
    # The generator report records local tool versions and run metadata, not media.
    files.pop('fixture-report.json', None)
    if any(path.stat().st_size == 0 for path in files.values()):
        raise ValueError('Every public fixture file must be nonempty.')
    references = set()
    for name, path in files.items():
        if path.suffix not in {'.m3u8', '.mpd', '.vtt'}:
            continue
        text = path.read_text(encoding='utf-8')
        if '\0' in text:
            raise ValueError('A text media file contains a null byte.')
        if path.suffix == '.mpd':
            references.update(check_dash(name, text, files))
            continue
        if EXTERNAL_ADDRESS.search(text) or '\\' in text:
            raise ValueError('A text media file contains an external address.')
        if path.suffix == '.m3u8':
            if not text.startswith('#EXTM3U\n'):
                raise ValueError('An HLS fixture has an invalid header.')
            for line in text.splitlines():
                if not line:
                    continue
                values = re.findall(r'\bURI="([^"]*)"', line) if line.startswith('#') else [line]
                if line.startswith('#') and len(values) != len(re.findall(r'\bURI\s*=', line)):
                    raise ValueError('An HLS URI attribute is malformed.')
                for value in values:
                    target = media_reference(name, value, files)
                    if not target.endswith(('.m3u8', '.m4s')) and not MEDIA_SUBTITLE_SEGMENT.fullmatch(target):
                        raise ValueError('An HLS fixture references an unexpected file type.')
                    references.add(target)
        elif name == 'vod-sprites/thumbnails/thumbnails.vtt':
            for line in text.splitlines():
                if not line or line == 'WEBVTT' or '-->' in line:
                    continue
                if not re.fullmatch(r'sprite-0\.jpg#xywh=\d+,\d+,\d+,\d+', line):
                    raise ValueError('The thumbnail track has an unexpected image reference.')
                references.add(media_reference(name, line, files, sprite=True))
    if any((MEDIA_SEGMENT.fullmatch(name) or MEDIA_SUBTITLE_SEGMENT.fullmatch(name)
            or name in OPTIONAL_MEDIA_FILES) and name not in references for name in files):
        raise ValueError('The media fixture contains an unreferenced segment.')
    # Reuse the pure generator contract, without invoking its encoding entry point.
    spec = importlib.util.spec_from_file_location(
        'comparison_media', Path(__file__).resolve().parents[1] / 'encoding/test-streams/local.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    master = files['vod-baseline/master.m3u8'].read_text(encoding='utf-8')
    for label, resolution in [('360p', '640x360'), ('180p', '320x180')]:
        expected = helper.comparison_master(master, resolution)
        if files[f'vod-baseline/comparison-{label}.m3u8'].read_text(encoding='utf-8') != expected:
            raise ValueError('A comparison master does not preserve its original single rendition and English audio.')
    return files


def regular_tree(root, directories):
    """Reject links and special files before inspecting any file contents."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Each input must be a real directory.')
    files = {}
    def unreadable(error):
        raise error

    for current, children, names in os.walk(root, followlinks=False, onerror=unreadable):
        for name in children + names:
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            metadata = path.lstat()
            if stat.S_ISDIR(metadata.st_mode):
                if relative not in directories:
                    raise ValueError('An input contains an unexpected directory.')
            elif stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1:
                files[relative] = path
            else:
                raise ValueError('Inputs must not contain links or special files.')
    return files


def exact_tree(root, expected):
    directories = {str(parent) for name in expected for parent in Path(name).parents if str(parent) != '.'}
    files = regular_tree(root, directories)
    if set(files) != expected:
        raise ValueError('An input contains missing or unexpected files.')
    return files


def check_web_files(files):
    if not {'index.html', 'guide.html'} <= files.keys():
        raise ValueError('Both production Web entry pages are required.')
    if COMPARISON_WEB_FILES & files.keys() and not COMPARISON_WEB_FILES <= files.keys():
        raise ValueError('The comparison page and runner must be supplied together.')
    if any(name not in {'index.html', 'guide.html'} | COMPARISON_WEB_FILES and not WEB_ASSET.fullmatch(name) for name in files):
        raise ValueError('The Web build contains an unexpected file.')
    if not any(name.endswith('.js') for name in files) or not any(name.endswith('.css') for name in files):
        raise ValueError('The Web build must contain generated JavaScript and styles.')
    return files


def collect_web(root):
    return check_web_files(regular_tree(root, {'assets'}))


def check_notice_files(files, comparison=False):
    required = NOTICE_FILES | (COMPARISON_NOTICE_FILES if comparison or COMPARISON_NOTICE_FILES & files.keys() else set())
    if not required <= files.keys() or not files.keys() <= NOTICE_FILES | OPTIONAL_NOTICE_FILES | COMPARISON_NOTICE_FILES:
        raise ValueError('The distribution notices contain missing or unexpected files.')
    if any(not path.read_text(encoding='utf-8').strip() for path in files.values()):
        raise ValueError('Every distribution notice must be nonempty.')
    return files


def open_regular(path):
    # Nonblocking open also lets us reject a FIFO without waiting for a writer.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError('A file is a link or special file.')
    except BaseException:
        os.close(descriptor)
        raise
    return os.fdopen(descriptor, 'rb')


def manifest_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('The manifest contains duplicate object keys.')
        result[key] = value
    return result


def read_manifest(path):
    with open_regular(path) as reader:
        report = json.loads(reader.read().decode('utf-8'), object_pairs_hook=manifest_object)
    if not isinstance(report, dict) or report.keys() != {'files'} or not isinstance(report['files'], list):
        raise ValueError('The manifest has an unexpected schema.')
    records = {}
    for item in report['files']:
        if not isinstance(item, dict) or item.keys() != {'path', 'size', 'sha256'}:
            raise ValueError('A manifest file record has an unexpected schema.')
        name = item['path']
        if (not isinstance(name, str) or not name or '\\' in name or '\0' in name
                or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts
                or PurePosixPath(name).as_posix() != name or name in records):
            raise ValueError('Manifest paths must be unique canonical relative paths.')
        if (type(item['size']) is not int or item['size'] < 0
                or not isinstance(item['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', item['sha256'])):
            raise ValueError('A manifest size or SHA-256 is invalid.')
        records[name] = item
    if not records or list(records) != sorted(records):
        raise ValueError('Manifest file records must be nonempty and sorted by path.')
    return records


def verify(root, manifest):
    if manifest.resolve().is_relative_to(root.resolve()):
        raise ValueError('The manifest must be separate from the public artifact.')
    records = read_manifest(manifest)
    directories = {'ja', 'assets', 'web', 'web/assets', 'web/notices', 'web/media'}
    directories.update(str(parent) for name in SITE_FILES | GUIDE_FILES
                       for parent in Path(name).parents if str(parent) != '.')
    directories.update(f'web/media/{name}' for name in MEDIA_DIRECTORIES)
    files = regular_tree(root, directories)
    if files.keys() != records.keys():
        raise ValueError('The artifact contains missing or additional files.')
    if {name for name in files if not name.startswith('web/')} != SITE_FILES | GUIDE_FILES:
        raise ValueError('The overview or guide contains missing or unexpected files.')
    web_files = check_web_files({name[4:]: path for name, path in files.items()
                                if name.startswith('web/') and not name.startswith(('web/notices/', 'web/media/'))})
    comparison = bool(COMPARISON_WEB_FILES & web_files.keys())
    check_notice_files({name[12:]: path for name, path in files.items() if name.startswith('web/notices/')}, comparison)
    if comparison and not (root / 'web/media').exists():
        raise ValueError('The comparison pages require the packaged media fixture.')
    if (root / 'web/media').exists():
        collect_media(root / 'web/media', allow_report=False)
    for name, path in files.items():
        digest = hashlib.sha256()
        size = 0
        with open_regular(path) as reader:
            for block in iter(lambda: reader.read(1024 * 1024), b''):
                size += len(block)
                digest.update(block)
        if size != records[name]['size'] or digest.hexdigest() != records[name]['sha256']:
            raise ValueError('An artifact file does not match its recorded size or SHA-256.')
    return len(files)


def package(site, web, notices, guide, output, manifest, media=None):
    if os.path.lexists(output) or os.path.lexists(manifest):
        raise FileExistsError('The output and manifest must be new paths.')
    output = output.resolve()
    manifest = manifest.resolve()
    inputs = [source.resolve() for source in [site, web, notices, guide, *([media] if media else [])]]
    if manifest.is_relative_to(output) or any(
        output.is_relative_to(source) or source.is_relative_to(output)
        or manifest.is_relative_to(source) for source in inputs
    ):
        raise ValueError('Output and report paths must be separate from all inputs.')
    selected = exact_tree(site, SITE_FILES)
    selected.update(exact_tree(guide, GUIDE_FILES))
    web_files = collect_web(web)
    comparison = bool(COMPARISON_WEB_FILES & web_files.keys())
    selected.update({f'web/{name}': path for name, path in web_files.items()})
    notice_files = check_notice_files(regular_tree(notices, set()), comparison)
    selected.update({f'web/notices/{name}': path for name, path in notice_files.items()})
    if comparison and not media:
        raise ValueError('The comparison pages require their local media fixture.')
    if media:
        selected.update({f'web/media/{name}': path for name, path in collect_media(media).items()})

    output.mkdir(parents=True, exist_ok=False)
    report = {'files': []}
    for name, source in sorted(selected.items()):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        with open_regular(source) as reader, target.open('xb') as writer:
            for block in iter(lambda: reader.read(1024 * 1024), b''):
                writer.write(block)
                digest.update(block)
                size += len(block)
        report['files'].append({'path': name, 'sha256': digest.hexdigest(), 'size': size})
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with manifest.open('x', encoding='utf-8') as writer:
        json.dump(report, writer, indent=2, sort_keys=True)
        writer.write('\n')
    return len(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['site-dir', 'web-dir', 'notices-dir', 'guide-dir', 'output-dir']:
        parser.add_argument(f'--{name}', type=Path)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--media-dir', type=Path)
    parser.add_argument('--verify-dir', type=Path)
    args = parser.parse_args()
    packaging = [args.site_dir, args.web_dir, args.notices_dir, args.guide_dir, args.output_dir]
    if args.verify_dir and any(value is not None for value in packaging + [args.media_dir]):
        parser.error('--verify-dir cannot be combined with packaging arguments.')
    if not args.verify_dir and any(value is None for value in packaging):
        parser.error('Packaging requires --site-dir, --web-dir, --notices-dir, --guide-dir and --output-dir.')
    try:
        if args.verify_dir:
            count = verify(args.verify_dir, args.manifest)
        else:
            count = package(args.site_dir, args.web_dir, args.notices_dir, args.guide_dir,
                            args.output_dir, args.manifest, args.media_dir)
    except (OSError, ValueError, ET.ParseError):
        parser.exit(1, 'Pages validation failed: invalid input or output. No package was approved.\n')
    if args.verify_dir:
        print(f'Verified {count} public files against the separate SHA-256 manifest.')
    else:
        print(f'Packaged {count} public files; SHA-256 manifest written separately.')


if __name__ == '__main__':
    main()
