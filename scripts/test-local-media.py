#!/usr/bin/env python3
"""Check the public local-media fixture contract without downloading media."""

import importlib.util
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from threading import Barrier
from types import SimpleNamespace
import unittest
import zipfile
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


def mp4_box(kind, payload):
    return (len(payload) + 8).to_bytes(4, 'big') + kind + payload


def audio_fragment(sample_durations, default_duration=None):
    flags = 0x100 if default_duration is None else 0
    trun = flags.to_bytes(4, 'big') + len(sample_durations).to_bytes(4, 'big')
    if default_duration is None:
        trun += b''.join(value.to_bytes(4, 'big') for value in sample_durations)
    tfhd = (0x8 if default_duration else 0).to_bytes(4, 'big') + (1).to_bytes(4, 'big')
    if default_duration:
        tfhd += default_duration.to_bytes(4, 'big')
    return mp4_box(b'moof', mp4_box(b'traf', mp4_box(b'tfhd', tfhd) + mp4_box(b'trun', trun)))


class LocalMediaTests(unittest.TestCase):
    def test_native_hls_subtitles_have_two_second_segments_and_distinct_languages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="audio"\nvideo.m3u8\n'
            dates = [f'2026-01-01T00:00:{second:02}.000Z' for second in range(0, 60, 2)]
            result = MEDIA.add_hls_subtitles(master, root, dates)
            self.assertIn('LANGUAGE="en"', result)
            self.assertIn('LANGUAGE="de"', result)
            self.assertIn('AUDIO="audio",SUBTITLES="subtitles"', result)
            self.assertIn('\nvideo.m3u8\n', result)
            for language, text in [('en', 'English subtitle test'), ('de', 'Deutscher Untertiteltest')]:
                playlist = (root / f'subtitle-{language}.m3u8').read_text()
                self.assertEqual(playlist.count('#EXTINF:2.000,'), 30)
                self.assertEqual([line.split(':', 1)[1] for line in playlist.splitlines()
                                  if line.startswith('#EXT-X-PROGRAM-DATE-TIME:')], dates)
                self.assertTrue(playlist.endswith('#EXT-X-ENDLIST\n'))
                segments = [root / value for value in playlist.splitlines() if value.endswith('.vtt')]
                self.assertEqual(len(segments), 30)
                self.assertEqual(len(set(segments)), 30)
                self.assertIn('00:00:00.000 --> 00:00:02.000', segments[0].read_text())
                self.assertIn('00:00:58.000 --> 00:01:00.000', segments[-1].read_text())
                self.assertTrue(all('X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0' in p.read_text()
                                    and text in p.read_text() for p in segments))

    def test_native_subtitles_reject_missing_video_timing_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                MEDIA.add_hls_subtitles('#EXTM3U\n', Path(directory), [])
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_video_and_sprite_share_one_input_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.zip'
            with zipfile.ZipFile(archive, 'w') as zipped:
                zipped.writestr(MEDIA.SOURCE_MEMBER, b'encoded public fixture placeholder')
            commands = []

            def capture(command, **options):
                commands.append(command)
                raise ArchiveVerified()

            with patch.object(MEDIA, 'SOURCE_SHA256', MEDIA.digest(archive)), \
                 patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
                 patch.object(MEDIA, 'available_cpus', return_value=10), \
                 patch.object(MEDIA, 'available_memory', return_value=8 * 1024 ** 3), \
                 patch.object(MEDIA.subprocess, 'run', side_effect=capture):
                with self.assertRaises(ArchiveVerified):
                    MEDIA.build(root / 'output', archive)
            command = commands[0]
            self.assertEqual(command.count('-i'), 1)
            graph = command[command.index('-filter_complex') + 1]
            self.assertIn('tile=12x1', graph)
            self.assertIn(str(root / 'output/vod-baseline/manifest.mpd'), command)
            self.assertIn(str(root / 'output/vod-sprites/thumbnails/sprite-0.jpg'), command)
            self.assertEqual(command[command.index('-seg_duration') + 1], '2')

    def test_cpu_budget_is_shared_between_active_heavy_stages(self):
        self.assertEqual(MEDIA.plan_threads(10, 8 * 1024 ** 3), 4)
        self.assertEqual(MEDIA.plan_threads(8, 8 * 1024 ** 3), 4)
        self.assertEqual(MEDIA.plan_threads(4, 8 * 1024 ** 3), 2)
        self.assertEqual(MEDIA.plan_threads(64, 8 * 1024 ** 3), 4)

    def test_small_cpu_allocations_use_one_thread_per_required_pool(self):
        for cpus in (1, 2):
            with self.subTest(cpus=cpus):
                self.assertEqual(MEDIA.plan_threads(cpus, 8 * 1024 ** 3), 1)

    def test_frame_queue_memory_budget_reduces_parallelism(self):
        self.assertEqual(MEDIA.plan_threads(64, 128 * 1024 ** 2), 1)
        self.assertEqual(MEDIA.plan_threads(64, 256 * 1024 ** 2), 2)

    def test_unavailable_memory_information_uses_conservative_parallelism(self):
        self.assertEqual(MEDIA.plan_threads(64, None), 1)

    def test_cpu_count_honors_affinity_and_cgroup_quota(self):
        with patch.object(MEDIA.os, 'process_cpu_count', return_value=64, create=True), \
             patch.object(MEDIA.os, 'sched_getaffinity', return_value={0, 1, 2, 3}, create=True), \
             patch.object(MEDIA.Path, 'read_text', return_value='250000 100000'):
            self.assertEqual(MEDIA.available_cpus(), 2)

    def test_available_memory_honors_remaining_container_memory(self):
        with patch.object(MEDIA.Path, 'read_text', side_effect=[
            'MemAvailable: 4096 kB\n', '10485760', '9437184',
        ]):
            self.assertEqual(MEDIA.available_memory(), 1024 ** 2)

    def test_mac_memory_estimate_counts_reclaimable_pages(self):
        values = ('Mach Virtual Memory Statistics: (page size of 16384 bytes)\n'
                  'Pages free: 1.\nPages inactive: 2.\nPages speculative: 3.\n')
        with patch.object(MEDIA.Path, 'read_text', side_effect=OSError), \
             patch.object(MEDIA.sys, 'platform', 'darwin'), \
             patch.object(MEDIA.subprocess, 'run', return_value=SimpleNamespace(stdout=values)):
            self.assertEqual(MEDIA.available_memory(), 6 * 16384)

    def test_missing_memory_information_is_explicit(self):
        with patch.object(MEDIA.Path, 'read_text', side_effect=OSError), \
             patch.object(MEDIA.sys, 'platform', 'unknown'):
            self.assertIsNone(MEDIA.available_memory())

    def test_audio_tail_uses_the_serialized_partial_sample_duration(self):
        with tempfile.TemporaryDirectory() as directory:
            fragment = Path(directory) / 'last.m4s'
            fragment.write_bytes(audio_fragment([1024, 1024, 512]))
            self.assertEqual(MEDIA.last_audio_sample_duration(fragment), 512)

    def test_audio_tail_can_use_a_declared_default_sample_duration(self):
        with tempfile.TemporaryDirectory() as directory:
            fragment = Path(directory) / 'last.m4s'
            fragment.write_bytes(audio_fragment([1024, 1024], default_duration=1024))
            self.assertEqual(MEDIA.last_audio_sample_duration(fragment), 1024)

    def test_truncated_fragment_cannot_supply_an_audio_duration(self):
        with tempfile.TemporaryDirectory() as directory:
            fragment = Path(directory) / 'last.m4s'
            fragment.write_bytes(audio_fragment([512])[:-2])
            with self.assertRaises(ValueError):
                MEDIA.last_audio_sample_duration(fragment)

    def test_sample_count_must_fit_the_serialized_track_run(self):
        with tempfile.TemporaryDirectory() as directory:
            fragment = Path(directory) / 'last.m4s'
            # The enclosing boxes are complete; only the declared sample count
            # exceeds the duration entries actually stored inside the run.
            run = (0x100).to_bytes(4, 'big') + (2).to_bytes(4, 'big') + (512).to_bytes(4, 'big')
            fragment.write_bytes(mp4_box(b'moof', mp4_box(b'traf', mp4_box(b'trun', run))))
            with self.assertRaises(ValueError):
                MEDIA.last_audio_sample_duration(fragment)

    def test_ffprobe6_full_frame_inference_does_not_extend_actual_audio_presentation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'init-stream2.m4s').write_bytes(b'init')
            (root / 'chunk-stream2-00030.m4s').write_bytes(audio_fragment([512]))
            report = {
                'streams': [{'codec_name': 'aac', 'duration': '60.021333', 'sample_rate': '48000'}],
                'packets': [
                    {'pts_time': '-0.021333', 'duration_time': '0.021333',
                     'side_data_list': [{'skip_samples': 1024}]},
                    {'pts_time': '59.989333', 'duration_time': '0.021333'},
                ],
            }
            with patch.object(MEDIA.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(report))):
                actual = MEDIA.probe_representation(root, 2)
            self.assertEqual(actual['last_packet_end_seconds'], 60.0)
            self.assertEqual(actual['probe_last_packet_end_seconds'], 60.010666)
            self.assertEqual(actual['last_packet_duration_samples'], 512)
            self.assertEqual(actual['initial_skip_samples'], 1024)
            MEDIA.validate_presentation_end(2, actual)

    def test_a_genuine_extra_audio_tail_is_still_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'init-stream2.m4s').write_bytes(b'init')
            (root / 'chunk-stream2-00030.m4s').write_bytes(audio_fragment([1024]))
            report = {
                'streams': [{'codec_name': 'aac', 'duration': '60.021333', 'sample_rate': '48000'}],
                'packets': [{'pts_time': '59.989333', 'duration_time': '0.021333'}],
            }
            with patch.object(MEDIA.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(report))):
                actual = MEDIA.probe_representation(root, 2)
            self.assertEqual(actual['last_packet_end_seconds'], 60.010666)
            with self.assertRaisesRegex(ValueError, 'does not end at sixty seconds'):
                MEDIA.validate_presentation_end(2, actual)

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
