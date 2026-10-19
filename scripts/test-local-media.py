#!/usr/bin/env python3
"""Check the public local-media fixture contract without downloading media."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "local_media", ROOT / "encoding/test-streams/local.py"
)
MEDIA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MEDIA)


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


if __name__ == '__main__':
    unittest.main()
