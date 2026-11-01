#!/usr/bin/env python3
"""Exercise the public Pages package boundary without downloading dependencies."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from guide_routes import GUIDE_ASSETS, GUIDE_FILES


SCRIPT = Path(__file__).with_name('package-pages.py')
COMPARISON_PAGES = {'comparison.html', 'comparison-runner.html'}
COMPARISON_NOTICES = {
    'BITMOVIN-PLAYER-WEB-X-NOTICE.txt', 'HLS-JS-LICENSE.txt',
    'SHAKA-PLAYER-LICENSE.txt', 'SHAKA-PLAYER-THIRD-PARTY-NOTICES.txt',
}


class PagesPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.site = self.root / 'site'
        self.web = self.root / 'dist'
        self.guide = self.root / 'guide'
        self.notices = self.root / 'notices'
        self.output = self.root / 'public'
        self.manifest = self.root / 'report.json'
        for name in {'index.html', 'ja/index.html', 'styles.css',
                     'assets/player-preview.jpg', 'assets/favicon.svg'} | GUIDE_ASSETS:
            self.write(self.site, name, b'public overview')
        for name in GUIDE_FILES:
            self.write(self.guide, name, b'[]' if name.endswith('.json') else b'public guide')
        self.write(self.web, 'index.html', b'<script type="module" src="/player-lab/web/assets/main-12345678.js"></script>')
        self.write(self.web, 'guide.html', b'<a href="./index.html">Player Lab</a>')
        self.write(self.web, 'assets/main-12345678.js', b'console.log("public");')
        self.write(self.web, 'assets/main-12345678.css', b'body { color: black; }')
        for name in ['PROJECT-LICENSE.txt', 'BITMOVIN-PLAYER-UI-LICENSE.txt',
                     'BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt']:
            self.write(self.notices, name, b'public license notice')

    def write(self, root, name, data):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def run_package(self, *extra):
        return subprocess.run([
            sys.executable, str(SCRIPT), '--site-dir', str(self.site),
            '--web-dir', str(self.web), '--notices-dir', str(self.notices),
            '--guide-dir', str(self.guide),
            '--output-dir', str(self.output), '--manifest', str(self.manifest),
            *map(str, extra),
        ], text=True, capture_output=True, timeout=10)

    def run_verify(self, *extra):
        return subprocess.run([
            sys.executable, str(SCRIPT), '--verify-dir', str(self.output),
            '--manifest', str(self.manifest), *map(str, extra),
        ], text=True, capture_output=True, timeout=10)

    def make_package(self, *extra):
        result = self.run_package(*extra)
        self.assertEqual(result.returncode, 0, result.stderr)

    def assert_rejected(self, *extra):
        result = self.run_package(*extra)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse(self.output.exists(), result.stderr)
        self.assertFalse(self.manifest.exists(), result.stderr)

    def test_only_public_files_are_copied_with_a_separate_deterministic_manifest(self):
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        files = {str(p.relative_to(self.output)): p for p in self.output.rglob('*') if p.is_file()}
        self.assertEqual(set(files), {
            'index.html', 'ja/index.html', 'styles.css',
            'assets/player-preview.jpg', 'assets/favicon.svg',
            'web/index.html', 'web/guide.html',
            'web/assets/main-12345678.js', 'web/assets/main-12345678.css',
            'web/notices/PROJECT-LICENSE.txt', 'web/notices/BITMOVIN-PLAYER-UI-LICENSE.txt',
            'web/notices/BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt',
        } | GUIDE_ASSETS | GUIDE_FILES)
        report = json.loads(self.manifest.read_text())
        self.assertEqual([f['path'] for f in report['files']], sorted(files))
        for item in report['files']:
            data = files[item['path']].read_bytes()
            self.assertEqual(item['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(item['size'], len(data))
        first_report = self.manifest.read_bytes()
        self.output = self.root / 'public-again'
        self.manifest = self.root / 'report-again.json'
        self.assertEqual(self.run_package().returncode, 0)
        self.assertEqual(self.manifest.read_bytes(), first_report)

    def test_extra_landing_file_is_rejected(self):
        self.write(self.site, 'internal.html', b'not public')
        self.assert_rejected()

    def add_comparison(self):
        for name in COMPARISON_PAGES:
            self.write(self.web, name, b'<html>Public comparison entry</html>')
        for name in COMPARISON_NOTICES:
            self.write(self.notices, name, b'public SDK distribution notice')
        return self.make_media()

    def test_exact_comparison_entry_pair_and_sdk_notices_are_packaged(self):
        media = self.add_comparison()
        self.make_package('--media-dir', media)
        for name in COMPARISON_PAGES:
            self.assertEqual((self.output / 'web' / name).read_bytes(), (self.web / name).read_bytes())
        for name in COMPARISON_NOTICES:
            self.assertEqual((self.output / 'web/notices' / name).read_bytes(), (self.notices / name).read_bytes())
        self.assertEqual(self.run_verify().returncode, 0)

    def test_comparison_entries_cannot_be_partial_or_use_similar_unlisted_names(self):
        media = self.add_comparison()
        for name in COMPARISON_PAGES:
            path = self.web / name
            data = path.read_bytes()
            path.unlink()
            self.assert_rejected('--media-dir', media)
            path.write_bytes(data)
        for name in ['comparison-old.html', 'comparison-runner-debug.html', 'comparison/index.html']:
            path = self.write(self.web, name, b'unlisted entry')
            self.assert_rejected('--media-dir', media)
            path.unlink()
            if path.parent != self.web:
                path.parent.rmdir()

    def test_each_comparison_sdk_notice_is_required(self):
        media = self.add_comparison()
        for name in COMPARISON_NOTICES:
            path = self.notices / name
            data = path.read_bytes()
            path.unlink()
            self.assert_rejected('--media-dir', media)
            path.write_bytes(data)

    def test_a_partial_comparison_notice_set_is_rejected_even_without_new_pages(self):
        self.write(self.notices, 'HLS-JS-LICENSE.txt', b'one SDK license')
        self.assert_rejected()

    def test_comparison_pages_require_their_media_fixture(self):
        self.add_comparison()
        self.assert_rejected()

    def test_verify_cannot_omit_a_required_comparison_notice_from_both_artifact_and_manifest(self):
        media = self.add_comparison()
        self.make_package('--media-dir', media)
        name = 'web/notices/HLS-JS-LICENSE.txt'
        (self.output / name).unlink()
        manifest = json.loads(self.manifest.read_text())
        manifest['files'] = [entry for entry in manifest['files'] if entry['path'] != name]
        self.manifest.write_text(json.dumps(manifest))
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_only_generated_guide_files_are_accepted(self):
        for name in ['.env', 'docs/guide/en/start.json', 'guide/notes.html', 'guide/start/source.json']:
            with self.subTest(name=name):
                path = self.write(self.guide, name, b'not public')
                self.assert_rejected()
                path.unlink()
                while path.parent != self.guide and not any(path.parent.iterdir()):
                    path = path.parent
                    path.rmdir()

    def test_guide_and_translated_entry_are_required(self):
        for name in ['guide/start/index.html', 'ja/guide/index.html', 'ja/guide/search-index.json']:
            with self.subTest(name=name):
                path = self.guide / name
                data = path.read_bytes()
                path.unlink()
                self.assert_rejected()
                path.write_bytes(data)

    def test_guide_output_must_be_separate_from_inputs(self):
        self.output = self.guide / 'public'
        self.assert_rejected()

    def test_guide_root_link_is_rejected(self):
        original = self.guide
        self.guide = self.root / 'linked-guide'
        self.guide.symlink_to(original, target_is_directory=True)
        self.assert_rejected()

    def test_source_map_is_rejected(self):
        self.write(self.web, 'assets/main-12345678.js.map', b'not public')
        self.assert_rejected()

    def test_generated_public_image_font_and_wasm_files_are_preserved(self):
        for name in ['assets/icon-12345678.svg', 'assets/font-12345678.woff2',
                     'assets/decoder-12345678.wasm']:
            self.write(self.web, name, b'public generated asset')
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.output / 'web/assets/decoder-12345678.wasm').read_bytes(),
                         b'public generated asset')

    def test_optional_sdk_notice_is_preserved(self):
        self.write(self.notices, 'BITMOVIN-PLAYER-NOTICE.txt', b'Bitmovin proprietary SDK version and terms')
        result = self.run_package()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.output / 'web/notices/BITMOVIN-PLAYER-NOTICE.txt').read_bytes(),
                         b'Bitmovin proprietary SDK version and terms')

    def test_optional_sdk_notice_must_be_nonempty_utf8_and_extra_notices_are_rejected(self):
        path = self.notices / 'BITMOVIN-PLAYER-NOTICE.txt'
        for data in [b'', b' \n', b'\xff']:
            with self.subTest(contents=data):
                path.write_bytes(data)
                self.assert_rejected()
        path.unlink()
        self.write(self.notices, 'INTERNAL.txt', b'not public')
        self.assert_rejected()

    def test_existing_output_is_preserved(self):
        self.output.mkdir()
        marker = self.write(self.output, 'keep', b'keep existing bytes')
        self.assertNotEqual(self.run_package().returncode, 0)
        self.assertEqual(marker.read_bytes(), b'keep existing bytes')
        self.assertFalse(self.manifest.exists())

    def test_private_and_unexpected_web_files_are_rejected(self):
        for name in ['.env', 'server.js', 'assets/source.ts', 'assets/unhashed.js',
                     'assets/settings-12345678.json', 'native/app.apk']:
            with self.subTest(name=name):
                path = self.write(self.web, name, b'not public')
                self.assert_rejected()
                path.unlink()
                if path.parent.name == 'native':
                    path.parent.rmdir()

    def test_missing_entry_or_notice_is_rejected(self):
        for path in [self.web / 'guide.html', self.notices / 'PROJECT-LICENSE.txt']:
            with self.subTest(name=path.name):
                data = path.read_bytes()
                path.unlink()
                self.assert_rejected()
                path.write_bytes(data)

    def test_symbolic_and_hard_links_are_rejected_in_every_input(self):
        for root, name in [(self.site, 'styles.css'), (self.web, 'assets/main-12345678.js'),
                           (self.notices, 'PROJECT-LICENSE.txt'),
                           (self.guide, 'guide/search-index.json')]:
            for hard in [False, True]:
                with self.subTest(name=name, hard=hard):
                    path = root / name
                    data = path.read_bytes()
                    path.unlink()
                    target = self.root / 'unrelated'
                    target.write_bytes(data)
                    if hard:
                        os.link(target, path)
                    else:
                        path.symlink_to(target)
                    self.assert_rejected()
                    path.unlink()
                    target.unlink()
                    path.write_bytes(data)

    def test_linked_root_and_directory_are_rejected(self):
        original = self.site
        self.site = self.root / 'linked-site'
        self.site.symlink_to(original, target_is_directory=True)
        self.assert_rejected()
        self.site = original
        (self.web / 'linked').symlink_to(self.web / 'assets', target_is_directory=True)
        self.assert_rejected()

    def test_empty_notice_and_special_file_are_rejected(self):
        notice = self.notices / 'PROJECT-LICENSE.txt'
        notice.write_bytes(b' \n')
        self.assert_rejected()
        notice.write_bytes(b'public license notice')
        path = self.web / 'assets/main-12345678.js'
        path.unlink()
        os.mkfifo(path)
        self.assert_rejected()

    def test_report_cannot_be_written_inside_an_input(self):
        self.manifest = self.site / 'report.json'
        self.assert_rejected()

    def test_existing_report_and_report_inside_output_are_rejected(self):
        self.manifest.write_bytes(b'keep report')
        self.assertNotEqual(self.run_package().returncode, 0)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.manifest.read_bytes(), b'keep report')
        self.manifest.unlink()
        self.manifest = self.output / 'report.json'
        self.assert_rejected()

    def make_media(self):
        media = self.root / 'media'
        self.write(media, 'ATTRIBUTION.txt', b'Blender Foundation: https://creativecommons.org/licenses/by/3.0/')
        self.write(media, 'fixture-report.json', b'not part of the public package')
        self.write(media, 'assets/sintel_en.vtt', b'WEBVTT\n\n00:00.000 --> 00:01.000\nA subtitle\n')
        prefix = ('#EXTM3U\n#EXT-X-VERSION:7\n'
                  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English test track",'
                  'LANGUAGE="en",DEFAULT=YES,URI="media_2.m3u8"\n')
        variants = [f'#EXT-X-STREAM-INF:BANDWIDTH=66234,RESOLUTION={resolution},'
                    f'CODECS="{codec},mp4a.40.2",AUDIO="audio"\nmedia_{number}.m3u8\n'
                    for number, resolution, codec in [(0, '640x360', 'avc1.64001e'),
                                                       (1, '320x180', 'avc1.64000c')]]
        master = prefix + ''.join(variants)
        self.write(media, 'vod-baseline/master.m3u8', master.encode())
        for label, variant in zip(['360p', '180p'], variants):
            self.write(media, f'vod-baseline/comparison-{label}.m3u8', (prefix + variant).encode())
        for number in range(4):
            self.write(media, f'vod-baseline/media_{number}.m3u8', (
                f'#EXTM3U\n#EXT-X-MAP:URI="init-stream{number}.m4s"\n'
                f'#EXTINF:2.000000,\nchunk-stream{number}-00001.m4s\n#EXT-X-ENDLIST\n'
            ).encode())
            self.write(media, f'vod-baseline/init-stream{number}.m4s', b'public init')
            self.write(media, f'vod-baseline/chunk-stream{number}-00001.m4s', b'public media')
        manifest = ('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" '
                    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                    'xsi:schemaLocation="urn:mpeg:DASH:schema:MPD:2011 '
                    'http://standards.iso.org/ittf/PubliclyAvailableStandards/MPEG-DASH_schema_files/DASH-MPD.xsd" '
                    'profiles="urn:mpeg:dash:profile:isoff-live:2011"><Period><AdaptationSet>')
        for number in range(3):
            manifest += (f'<Representation id="{number}"><SegmentTemplate startNumber="1" '
                         'initialization="init-stream$RepresentationID$.m4s" '
                         'media="chunk-stream$RepresentationID$-$Number%05d$.m4s">'
                         '<SegmentTimeline><S d="2"/></SegmentTimeline>'
                         '</SegmentTemplate></Representation>')
        manifest += '</AdaptationSet></Period></MPD>'
        self.write(media, 'vod-baseline/manifest.mpd', manifest.encode())
        relative = master.replace('media_', '../vod-baseline/media_')
        self.write(media, 'vod-sprites/master.m3u8', relative.encode())
        self.write(media, 'vod-multiaudio/master.m3u8', (relative + '#EXT-X-MEDIA:TYPE=AUDIO,URI="../vod-baseline/media_3.m3u8"\n').encode())
        self.write(media, 'vod-sprites/thumbnails/thumbnails.vtt',
                   b'WEBVTT\n\n00:00.000 --> 00:01.000\nsprite-0.jpg#xywh=0,0,160,90\n')
        self.write(media, 'vod-sprites/thumbnails/sprite-0.jpg', b'public image')
        return media

    def test_public_media_preserves_sibling_references_and_omits_run_report(self):
        media = self.make_media()
        result = self.run_package('--media-dir', media)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.output / 'web/media/fixture-report.json').exists())
        for name in ['vod-baseline/manifest.mpd', 'vod-sprites/master.m3u8',
                     'vod-multiaudio/master.m3u8', 'assets/sintel_en.vtt', 'ATTRIBUTION.txt']:
            self.assertEqual((self.output / 'web/media' / name).read_bytes(), (media / name).read_bytes())
        self.assertNotIn('fixture-report', self.manifest.read_text())

    def test_comparison_media_reuses_exact_original_single_variants_and_audio(self):
        media = self.make_media()
        self.make_package('--media-dir', media)
        for label in ['360p', '180p']:
            name = f'vod-baseline/comparison-{label}.m3u8'
            self.assertEqual((self.output / 'web/media' / name).read_bytes(), (media / name).read_bytes())
            self.assertEqual((media / name).read_text().count('#EXT-X-STREAM-INF:'), 1)
        self.assertEqual(self.run_verify().returncode, 0)

    def test_comparison_media_rejects_partial_changed_or_ambiguous_masters(self):
        media = self.make_media()
        path = media / 'vod-baseline/comparison-360p.m3u8'
        original = path.read_text()
        path.unlink()
        self.assert_rejected('--media-dir', media)
        invalid = [
            original + original.splitlines()[3] + '\nmedia_0.m3u8\n',
            original.replace('CODECS="avc1.64001e,mp4a.40.2"', 'CODECS="avc1.changed,mp4a.40.2"'),
            original.replace('RESOLUTION=640x360', 'RESOLUTION=320x180'),
            original.replace('LANGUAGE="en"', 'LANGUAGE="de"'),
            original.replace('BANDWIDTH=66234,', 'BANDWIDTH=66234,BANDWIDTH=66234,'),
            original.replace('media_0.m3u8', '../vod-baseline/media_0.m3u8'),
            original.replace('media_2.m3u8', 'media_3.m3u8'),
        ]
        for text in invalid:
            with self.subTest(master=text):
                path.write_text(text)
                self.assert_rejected('--media-dir', media)
        path.write_text(original)

    def test_native_hls_subtitles_are_packaged_only_with_local_referenced_segments(self):
        media = self.make_media()
        master = media / 'vod-multiaudio/master.m3u8'
        master.write_text(master.read_text() + '#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitle-en.m3u8"\n')
        self.write(media, 'vod-multiaudio/subtitle-en.m3u8',
                   b'#EXTM3U\n#EXTINF:2.000,\nsubtitle-en-00.vtt\n#EXT-X-ENDLIST\n')
        self.write(media, 'vod-multiaudio/subtitle-en-00.vtt',
                   b'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n00:00.000 --> 00:02.000\nTest\n')
        self.make_package('--media-dir', media)
        self.assertTrue((self.output / 'web/media/vod-multiaudio/subtitle-en-00.vtt').is_file())
        self.write(media, 'vod-multiaudio/subtitle-en-01.vtt', b'WEBVTT\n')
        other_output = self.root / 'unreferenced-output'
        self.output, self.manifest = other_output, self.root / 'unreferenced-report.json'
        self.assert_rejected('--media-dir', media)

    def test_media_references_cannot_escape_or_load_remote_resources(self):
        media = self.make_media()
        playlist = media / 'vod-sprites/master.m3u8'
        for uri in ['../../outside.m3u8', '/outside.m3u8', 'https://example.invalid/private.m3u8',
                    '//example.invalid/private.m3u8', 'file:///tmp/private',
                    '../vod-baseline/%2e%2e/private.m3u8', '..\\private.m3u8',
                    '../vod-baseline/missing.m3u8']:
            with self.subTest(uri=uri):
                playlist.write_text(f'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="{uri}"\n')
                self.assert_rejected('--media-dir', media)

    def test_media_xml_and_sprite_references_are_checked(self):
        media = self.make_media()
        manifest = media / 'vod-baseline/manifest.mpd'
        original = manifest.read_bytes()
        for replacement in [b'../../outside.m4s', b'https://example.invalid/private.m4s']:
            with self.subTest(reference=replacement):
                manifest.write_bytes(original.replace(b'init-stream$RepresentationID$.m4s', replacement))
                self.assert_rejected('--media-dir', media)
        manifest.write_bytes(original.replace(b'<Period>', b'<BaseURL>https://example.invalid/</BaseURL><Period>'))
        self.assert_rejected('--media-dir', media)
        manifest.write_bytes(original.replace(b'<Period>', b'<!-- https://example.invalid/private --><Period>'))
        self.assert_rejected('--media-dir', media)
        manifest.write_bytes(original.replace(b'<Period>', b'<!DOCTYPE MPD [<!ENTITY local "private">]><Period>'))
        self.assert_rejected('--media-dir', media)
        manifest.write_bytes(original)
        (media / 'vod-sprites/thumbnails/thumbnails.vtt').write_text('WEBVTT\n\n00:00 --> 00:01\n../../../outside.jpg#xywh=0,0,1,1\n')
        self.assert_rejected('--media-dir', media)

    def test_extra_media_files_and_linked_excluded_report_are_rejected(self):
        media = self.make_media()
        extra = self.write(media, 'internal.json', b'not public')
        self.assert_rejected('--media-dir', media)
        extra.unlink()
        report = media / 'fixture-report.json'
        report.unlink()
        report.symlink_to(self.site / 'styles.css')
        self.assert_rejected('--media-dir', media)
        report.unlink()
        os.link(self.site / 'styles.css', report)
        self.assert_rejected('--media-dir', media)

    def test_missing_attribution_and_orphan_segments_are_rejected(self):
        media = self.make_media()
        attribution = media / 'ATTRIBUTION.txt'
        attribution.unlink()
        self.assert_rejected('--media-dir', media)
        attribution.write_text('Blender Foundation attribution')
        self.write(media, 'vod-baseline/chunk-stream0-00099.m4s', b'unreferenced')
        self.assert_rejected('--media-dir', media)

    def test_empty_attribution_or_media_is_rejected(self):
        media = self.make_media()
        for name in ['ATTRIBUTION.txt', 'vod-baseline/chunk-stream0-00001.m4s']:
            with self.subTest(name=name):
                path = media / name
                data = path.read_bytes()
                path.write_bytes(b'')
                self.assert_rejected('--media-dir', media)
                path.write_bytes(data)

    def test_media_cache_directory_is_rejected(self):
        media = self.make_media()
        self.write(media, '.vite/deps/cache.js', b'not public')
        self.assert_rejected('--media-dir', media)

    def test_verify_accepts_the_exact_package_without_changing_any_bytes(self):
        self.make_package('--media-dir', self.make_media())
        before = self.manifest.read_bytes()
        result = self.run_verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Verified', result.stdout)
        self.assertEqual(self.manifest.read_bytes(), before)

    def test_verify_rejects_corrupted_missing_and_additional_files(self):
        self.make_package()
        asset = self.output / 'web/assets/main-12345678.js'
        original = asset.read_bytes()
        asset.write_bytes(b'x' * len(original))
        self.assertNotEqual(self.run_verify().returncode, 0)
        asset.write_bytes(original)
        asset.unlink()
        self.assertNotEqual(self.run_verify().returncode, 0)
        asset.write_bytes(original)
        self.write(self.output, 'web/assets/extra-12345678.js', b'additional bytes')
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_rejects_noncanonical_and_duplicate_manifest_paths(self):
        self.make_package()
        report = json.loads(self.manifest.read_text())
        for name in ['../outside', '/outside', './index.html', 'web//index.html',
                     'web/assets/../index.html', 'web\\index.html', 'web/index.html/']:
            with self.subTest(name=name):
                changed = json.loads(json.dumps(report))
                changed['files'][0]['path'] = name
                self.manifest.write_text(json.dumps(changed))
                self.assertNotEqual(self.run_verify().returncode, 0)
        report['files'].insert(1, report['files'][0])
        self.manifest.write_text(json.dumps(report))
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_enforces_allowlist_even_if_the_manifest_lists_an_extra_file(self):
        self.make_package()
        data = b'not approved for distribution'
        self.write(self.output, 'web/settings.json', data)
        report = json.loads(self.manifest.read_text())
        report['files'].append({'path': 'web/settings.json', 'size': len(data),
                                'sha256': hashlib.sha256(data).hexdigest()})
        report['files'].sort(key=lambda item: item['path'])
        self.manifest.write_text(json.dumps(report))
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_requires_the_exact_manifest_schema_and_sorted_records(self):
        self.make_package()
        original = self.manifest.read_text()
        variants = [[], {'files': {}}, {'files': []}, {'files': [], 'extra': True}]
        for field, value in [('path', 12), ('size', True), ('size', -1), ('size', 1.5),
                             ('sha256', 'A' * 64), ('sha256', 'a' * 63), ('extra', 'unexpected')]:
            report = json.loads(original)
            report['files'][0][field] = value
            variants.append(report)
        missing_field = json.loads(original)
        del missing_field['files'][0]['size']
        variants.append(missing_field)
        unsorted = json.loads(original)
        unsorted['files'].reverse()
        variants.append(unsorted)
        for number, report in enumerate(variants):
            with self.subTest(case=number):
                self.manifest.write_text(json.dumps(report))
                self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_rejects_duplicate_json_object_keys(self):
        self.make_package()
        original = self.manifest.read_text()
        for text in [original.replace('"files":', '"files": [], "files":', 1),
                     original.replace('"path":', '"path": "duplicate", "path":', 1)]:
            with self.subTest(text=text[:30]):
                self.manifest.write_text(text)
                self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_rejects_linked_or_special_manifests_without_following_them(self):
        self.make_package()
        data = self.manifest.read_bytes()
        target = self.write(self.root, 'keep-report.json', data)
        for kind in ['symbolic', 'hard', 'fifo']:
            with self.subTest(kind=kind):
                self.manifest.unlink()
                if kind == 'symbolic':
                    self.manifest.symlink_to(target)
                elif kind == 'hard':
                    os.link(target, self.manifest)
                else:
                    os.mkfifo(self.manifest)
                self.assertNotEqual(self.run_verify().returncode, 0)
                self.assertEqual(target.read_bytes(), data)

    def test_verify_rejects_linked_files_and_a_linked_artifact_root(self):
        self.make_package()
        asset = self.output / 'web/assets/main-12345678.js'
        data = asset.read_bytes()
        target = self.write(self.root, 'keep-asset.js', data)
        for hard in [False, True]:
            with self.subTest(hard=hard):
                asset.unlink()
                if hard:
                    os.link(target, asset)
                else:
                    asset.symlink_to(target)
                self.assertNotEqual(self.run_verify().returncode, 0)
                asset.unlink()
                asset.write_bytes(data)
        original = self.output
        self.output = self.root / 'linked-public'
        self.output.symlink_to(original, target_is_directory=True)
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_rejects_packaging_flags_and_a_manifest_inside_the_artifact(self):
        self.make_package()
        self.assertNotEqual(self.run_verify('--web-dir', self.web).returncode, 0)
        self.assertNotEqual(self.run_verify('--media-dir', self.root / 'media').returncode, 0)
        source = self.manifest
        self.manifest = self.output / 'report.json'
        self.manifest.write_bytes(source.read_bytes())
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_never_accepts_a_generator_report_even_with_a_matching_record(self):
        self.make_package('--media-dir', self.make_media())
        data = b'local generator metadata must remain outside the public artifact'
        self.write(self.output, 'web/media/fixture-report.json', data)
        report = json.loads(self.manifest.read_text())
        report['files'].append({'path': 'web/media/fixture-report.json', 'size': len(data),
                                'sha256': hashlib.sha256(data).hexdigest()})
        report['files'].sort(key=lambda item: item['path'])
        self.manifest.write_text(json.dumps(report))
        self.assertNotEqual(self.run_verify().returncode, 0)

    def test_verify_hashes_the_entire_file_across_chunk_boundaries(self):
        name = 'web/assets/main-12345678.js'
        data = b'x' * (2 * 1024 * 1024 + 17)
        (self.web / 'assets/main-12345678.js').write_bytes(data)
        self.make_package()
        self.assertEqual(self.run_verify().returncode, 0)
        with (self.output / name).open('r+b') as writer:
            writer.seek(1024 * 1024)
            writer.write(b'y')
        self.assertNotEqual(self.run_verify().returncode, 0)


class NoticeGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.write('LICENSE', b'project license fixture\n')
        self.write('packages/ui-shared/node_modules/bitmovin-player-ui/LICENSE', b'UI license fixture\n')
        self.sdk_roots = {name: self.repo / 'apps/web/node_modules' / name
                          for name in ['bitmovin-player', '@bitmovin/player-web-x', 'hls.js', 'shaka-player']}
        self.write_sdk('bitmovin-player', 'package.json', b'{"version":"8.281.0","main":"player.js"}')
        self.write_sdk('bitmovin-player', 'player.js', b'/* Bitmovin Proprietary Software: test fixture */\n')
        self.write_sdk('bitmovin-player', 'THIRD_PARTY_NOTICES', b'legacy SDK attribution fixture\n')
        self.webx_banner = (b'/* This source code is the proprietary property of Bitmovin, Inc.\r\n'
                            b' * Bitmovin Player X Version 10.3.1\r\n */')
        self.write_sdk('@bitmovin/player-web-x', 'package.json', b'{"version":"10.3.1"}')
        self.write_sdk('@bitmovin/player-web-x', 'bundles/playerx-hls.js', self.webx_banner + b'\n/* no SDK execution */')
        self.write_sdk('hls.js', 'package.json', b'{"version":"1.7.4","license":"Apache-2.0"}')
        self.write_sdk('shaka-player', 'package.json', b'{"version":"5.3.3","license":"Apache-2.0"}')
        self.legal_files = {
            ('hls.js', 'LICENSE'): b'Apache license fixture\r\nHLS attribution fixture\r\n',
            ('shaka-player', 'LICENSE'): b'Apache license fixture\nShaka attribution fixture\n',
            ('shaka-player', 'third_party/language-mapping-list/LICENSE'): b'language mapping license fixture\n',
            ('shaka-player', 'third_party/cml-cmcd/LICENSE'): b'CMCD library license fixture\n',
            ('shaka-player', 'third_party/cml-cmcd/NOTICE'): b'CMCD library attribution fixture\n',
        }
        for (sdk, name), data in self.legal_files.items():
            self.write_sdk(sdk, name, data)
        build = SCRIPT.with_name('build-pages.sh').read_text()
        self.generator = build.split('python3 - "$notice_dir" <<\'PY\'\n', 1)[1].split('\nPY\n', 1)[0]

    def write(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def write_sdk(self, sdk, name, data):
        return self.write('apps/web/node_modules/' + sdk + '/' + name, data)

    def generate(self):
        output = Path(tempfile.mkdtemp(prefix='notices-', dir=self.root))
        result = subprocess.run([sys.executable, '-', str(output)], input=self.generator,
                                cwd=self.repo, text=True, capture_output=True, timeout=10)
        return result, output / 'notices'

    def test_actual_shipped_license_bytes_and_attributions_are_preserved(self):
        result, notices = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({path.name for path in notices.iterdir()}, COMPARISON_NOTICES | {
            'PROJECT-LICENSE.txt', 'BITMOVIN-PLAYER-UI-LICENSE.txt',
            'BITMOVIN-PLAYER-THIRD-PARTY-NOTICES.txt', 'BITMOVIN-PLAYER-NOTICE.txt',
        })
        self.assertEqual((notices / 'HLS-JS-LICENSE.txt').read_bytes(), self.legal_files[('hls.js', 'LICENSE')])
        self.assertEqual((notices / 'SHAKA-PLAYER-LICENSE.txt').read_bytes(), self.legal_files[('shaka-player', 'LICENSE')])
        third_party = (notices / 'SHAKA-PLAYER-THIRD-PARTY-NOTICES.txt').read_bytes()
        for (sdk, name), data in self.legal_files.items():
            if sdk == 'shaka-player' and name.startswith('third_party/'):
                self.assertIn(name.encode(), third_party)
                self.assertIn(data, third_party)
        webx = (notices / 'BITMOVIN-PLAYER-WEB-X-NOTICE.txt').read_bytes()
        self.assertIn(self.webx_banner, webx)
        self.assertIn(b'10.3.1', webx)
        self.assertIn(b'https://legal.bitmovin.com/legal/terms', webx)
        self.assertIn(b'no standalone license or third-party notice files', webx)
        for path in notices.iterdir():
            self.assertNotIn(str(self.root).encode(), path.read_bytes())

    def test_missing_or_empty_distribution_material_fails_closed(self):
        for (sdk, name), data in self.legal_files.items():
            path = self.sdk_roots[sdk] / name
            for replacement in [None, b'']:
                with self.subTest(sdk=sdk, name=name, replacement=replacement):
                    if replacement is None:
                        path.unlink()
                    else:
                        path.write_bytes(replacement)
                    result, _ = self.generate()
                    self.assertNotEqual(result.returncode, 0)
                    path.write_bytes(data)

    def test_symlinked_sdk_material_cannot_copy_a_local_file_outside_the_package(self):
        outside = self.root / 'unrelated.txt'
        outside.write_bytes(b'fake-local-canary')
        path = self.sdk_roots['hls.js'] / 'LICENSE'
        path.unlink()
        path.symlink_to(outside)
        result, notices = self.generate()
        self.assertNotEqual(result.returncode, 0)
        for notice in notices.iterdir():
            self.assertNotIn(b'fake-local-canary', notice.read_bytes())

    def test_unrecognized_or_newly_added_legal_inventory_needs_review(self):
        self.write_sdk('@bitmovin/player-web-x', 'LICENSE', b'new legal material fixture')
        result, _ = self.generate()
        self.assertNotEqual(result.returncode, 0)

    def test_oversized_or_binary_sdk_material_is_rejected(self):
        for data in [b'x' * (1024 * 1024 + 1), b'license\0binary']:
            with self.subTest(size=len(data)):
                self.write_sdk('hls.js', 'LICENSE', data)
                result, _ = self.generate()
                self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
