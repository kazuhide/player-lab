#!/usr/bin/env python3
"""Check the public local-media fixture contract without downloading media."""

import importlib.util
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import subprocess
import tempfile
from threading import Barrier
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "local_media", ROOT / "encoding/test-streams/local.py"
)
MEDIA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MEDIA)


class ArchiveVerified(Exception):
    """Stop before encoding; these tests exercise cache acquisition only."""


PUBLIC_BYTES = b'verified public fixture archive'
PUBLIC_HASH = hashlib.sha256(PUBLIC_BYTES).hexdigest()


def write_download(command, options, contents):
    if 'stdout' in options:
        options['stdout'].write(contents)
        options['stdout'].flush()
    else:
        Path(command[command.index('--output') + 1]).write_bytes(contents)


class LocalMediaTests(unittest.TestCase):
    def test_track_languages_and_only_one_default_survive_relative_reuse(self):
        master = '\n'.join([
            '#EXTM3U',
            '#EXT-X-MEDIA:TYPE=AUDIO,NAME="audio_2",DEFAULT=YES,URI="media_2.m3u8"',
            '#EXT-X-MEDIA:TYPE=AUDIO,NAME="audio_3",DEFAULT=NO,URI="media_3.m3u8"',
            '#EXT-X-STREAM-INF:BANDWIDTH=300000',
            'media_0.m3u8',
        ])
        actual = MEDIA.audio_master(master, prefix="../vod-baseline/")
        self.assertEqual(actual.count('DEFAULT=YES'), 1)
        self.assertIn('LANGUAGE="en"', actual)
        self.assertIn('LANGUAGE="de"', actual)
        self.assertIn('URI="../vod-baseline/media_3.m3u8"', actual)
        self.assertIn('\n../vod-baseline/media_0.m3u8', actual)

    def test_unexpected_packager_output_fails_instead_of_mislabeling_audio(self):
        with self.assertRaises(ValueError):
            MEDIA.audio_master('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,NAME="other"')

    def test_frame_durations_preserve_fractional_audio_boundaries(self):
        summary = MEDIA.summarize_durations([1.984, 2.005333, 1.984, 0.048])
        self.assertAlmostEqual(summary['duration_seconds'], 6.021333, places=6)
        self.assertEqual(summary['segment_count'], 4)
        self.assertEqual(summary['interior_min_seconds'], 1.984)
        self.assertEqual(summary['interior_max_seconds'], 2.005333)

    def test_existing_output_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'media'
            output.mkdir()
            (output / 'keep').write_text('existing output')
            with self.assertRaises(FileExistsError):
                MEDIA.prepare_output(output)
            self.assertEqual((output / 'keep').read_text(), 'existing output')

    def test_untrusted_source_fails_before_extraction_or_output_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'source.zip'
            archive.write_bytes(b'not the public source archive')
            output = Path(directory) / 'media'
            with patch.object(MEDIA.shutil, 'which', return_value='/available-tool'):
                with self.assertRaisesRegex(ValueError, 'pinned checksum'):
                    MEDIA.build(output, archive)
            self.assertFalse(output.exists())

    def check_existing_download(self, symlink):
        for succeeds in [True, False]:
            with self.subTest(symlink=symlink, succeeds=succeeds):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    archive = root / 'source.zip'
                    sibling = archive.with_suffix('.download')
                    target = root / 'keep.bin'
                    target.write_bytes(b'keep these unrelated bytes')
                    if symlink:
                        sibling.symlink_to(target)
                    else:
                        sibling.write_bytes(b'keep this sibling')
                    inode = sibling.lstat().st_ino

                    def download(command, **options):
                        write_download(command, options, PUBLIC_BYTES if succeeds else b'bad download')

                    with patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
                         patch.object(MEDIA, 'SOURCE_SHA256', PUBLIC_HASH), \
                         patch.object(MEDIA.subprocess, 'run', side_effect=download), \
                         patch.object(MEDIA, 'prepare_output', side_effect=ArchiveVerified):
                        expected = ArchiveVerified if succeeds else ValueError
                        with self.assertRaises(expected):
                            MEDIA.build(root / 'output', archive)
                    self.assertEqual(sibling.lstat().st_ino, inode)
                    self.assertEqual(target.read_bytes(), b'keep these unrelated bytes')
                    self.assertEqual(sibling.read_bytes(), target.read_bytes() if symlink else b'keep this sibling')
                    self.assertEqual(archive.exists(), succeeds)
                    self.assertFalse((root / 'output').exists())
                    self.assertEqual(set(root.iterdir()), {sibling, target, archive} if succeeds else {sibling, target})

    def test_existing_download_sibling_survives_success_and_checksum_failure(self):
        self.check_existing_download(symlink=False)

    def test_existing_download_symlink_and_target_survive_success_and_checksum_failure(self):
        self.check_existing_download(symlink=True)

    def test_concurrent_archive_winner_is_verified_and_never_replaced(self):
        for winner in [PUBLIC_BYTES, b'untrusted concurrent archive']:
            with self.subTest(valid_winner=winner == PUBLIC_BYTES):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    archive = root / 'source.zip'
                    winner_inode = []

                    def download(command, **options):
                        write_download(command, options, PUBLIC_BYTES)
                        archive.write_bytes(winner)
                        winner_inode.append(archive.stat().st_ino)

                    with patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
                         patch.object(MEDIA, 'SOURCE_SHA256', PUBLIC_HASH), \
                         patch.object(MEDIA.subprocess, 'run', side_effect=download), \
                         patch.object(MEDIA, 'prepare_output', side_effect=ArchiveVerified):
                        expected = ArchiveVerified if winner == PUBLIC_BYTES else ValueError
                        with self.assertRaises(expected):
                            MEDIA.build(root / 'output', archive)
                    self.assertEqual(archive.read_bytes(), winner)
                    self.assertEqual(archive.stat().st_ino, winner_inode[0])
                    self.assertEqual(set(root.iterdir()), {archive})

    def test_two_cold_cache_downloaders_publish_one_archive_without_interference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.zip'
            ready = Barrier(2)

            def download(command, **options):
                write_download(command, options, PUBLIC_BYTES)
                ready.wait(timeout=5)

            def generate(index):
                try:
                    MEDIA.build(root / f'output-{index}', archive)
                except ArchiveVerified:
                    return True

            with patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
                 patch.object(MEDIA, 'SOURCE_SHA256', PUBLIC_HASH), \
                 patch.object(MEDIA.subprocess, 'run', side_effect=download), \
                 patch.object(MEDIA, 'prepare_output', side_effect=ArchiveVerified):
                with ThreadPoolExecutor(max_workers=2) as pool:
                    self.assertEqual(list(pool.map(generate, [0, 1])), [True, True])
            self.assertEqual(archive.read_bytes(), PUBLIC_BYTES)
            self.assertEqual(set(root.iterdir()), {archive})

    def test_failed_download_cleans_only_its_own_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.zip'
            sibling = archive.with_suffix('.download')
            sibling.write_bytes(b'keep this sibling')

            def download(command, **options):
                write_download(command, options, b'partial download')
                raise subprocess.CalledProcessError(1, 'curl')

            with patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
                 patch.object(MEDIA.subprocess, 'run', side_effect=download):
                with self.assertRaises(subprocess.CalledProcessError):
                    MEDIA.build(root / 'output', archive)
            self.assertEqual(sibling.read_bytes(), b'keep this sibling')
            self.assertEqual(set(root.iterdir()), {sibling})


if __name__ == '__main__':
    unittest.main()
