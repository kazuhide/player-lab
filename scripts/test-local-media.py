#!/usr/bin/env python3
"""Check the public local-media fixture contract without downloading media."""

import importlib.util
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import re
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
SOURCE_MIRROR_URL = (
    'https://github.com/kazuhide/player-lab/releases/download/test-source-bbb-v1/'
    'BigBuckBunny_640x360.m4v.zip'
)
COMPARISON_MASTER = (
    '#EXTM3U\n#EXT-X-VERSION:7\n'
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English test track",'
    'LANGUAGE="en",DEFAULT=YES,URI="media_2.m3u8"\n'
    '#EXT-X-STREAM-INF:BANDWIDTH=66234,RESOLUTION=640x360,'
    'CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"\nmedia_0.m3u8\n'
    '#EXT-X-STREAM-INF:BANDWIDTH=66234,RESOLUTION=320x180,'
    'CODECS="avc1.64000c,mp4a.40.2",AUDIO="audio"\nmedia_1.m3u8\n'
)


def write_hls_rendition(root, number, durations, sizes, target=4):
    lines = ['#EXTM3U', '#EXT-X-VERSION:6', f'#EXT-X-TARGETDURATION:{target}',
             '#EXT-X-MEDIA-SEQUENCE:1', f'#EXT-X-MAP:URI="init-stream{number}.m4s"']
    (root / f'init-stream{number}.m4s').write_bytes(b'initialization bytes are not media segments' * 1000)
    for index, (duration, size) in enumerate(zip(durations, sizes), 1):
        name = f'chunk-stream{number}-{index:05}.m4s'
        (root / name).write_bytes(b'x' * size)
        lines.extend([f'#EXTINF:{duration},', f'#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:{index:02}.000Z', name])
    lines.append('#EXT-X-ENDLIST')
    (root / f'media_{number}.m3u8').write_text('\n'.join(lines) + '\n')


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
    def acquire_archive(self, root, download):
        with patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
             patch.object(MEDIA, 'SOURCE_SHA256', PUBLIC_HASH), \
             patch.object(MEDIA.subprocess, 'run', side_effect=download), \
             patch.object(MEDIA, 'prepare_output', side_effect=ArchiveVerified):
            MEDIA.build(root / 'output', root / 'source.zip')

    def test_verified_cached_archive_never_uses_the_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.zip'
            archive.write_bytes(PUBLIC_BYTES)
            inode = archive.stat().st_ino
            with self.assertRaises(ArchiveVerified):
                self.acquire_archive(root, lambda *_args, **_options: self.fail('A cache hit must not download'))
            self.assertEqual(archive.read_bytes(), PUBLIC_BYTES)
            self.assertEqual(archive.stat().st_ino, inode)
            self.assertEqual(set(root.iterdir()), {archive})

    def test_corrupt_cached_archive_fails_without_downloading_or_replacing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.zip'
            archive.write_bytes(b'corrupt cached source')
            inode = archive.stat().st_ino
            with self.assertRaisesRegex(ValueError, 'pinned checksum'):
                self.acquire_archive(root, lambda *_args, **_options: self.fail('A corrupt cache must fail closed'))
            self.assertEqual(archive.read_bytes(), b'corrupt cached source')
            self.assertEqual(archive.stat().st_ino, inode)
            self.assertEqual(set(root.iterdir()), {archive})

    def test_http_failure_uses_the_same_pinned_mirror_without_partial_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []

            def download(command, **options):
                commands.append(command)
                self.assertEqual(command[command.index('--output') + 1], '-')
                if len(commands) == 1:
                    write_download(command, options, b'partial primary response')
                    raise subprocess.CalledProcessError(22, command)
                write_download(command, options, PUBLIC_BYTES)

            with self.assertRaises(ArchiveVerified):
                self.acquire_archive(root, download)
            self.assertEqual([command[-1] for command in commands], [MEDIA.SOURCE_URL, SOURCE_MIRROR_URL])
            self.assertEqual((root / 'source.zip').read_bytes(), PUBLIC_BYTES)
            self.assertEqual(set(root.iterdir()), {root / 'source.zip'})

    def test_successful_download_with_wrong_checksum_never_tries_the_mirror(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []

            def download(command, **options):
                commands.append(command)
                write_download(command, options, b'wrong successful response')

            with self.assertRaisesRegex(ValueError, 'pinned checksum'):
                self.acquire_archive(root, download)
            self.assertEqual([command[-1] for command in commands], [MEDIA.SOURCE_URL])
            self.assertEqual(list(root.iterdir()), [])

    def test_nontransport_curl_failure_never_tries_the_mirror(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []

            def download(command, **options):
                commands.append(command)
                raise subprocess.CalledProcessError(23, command)

            with self.assertRaises(subprocess.CalledProcessError) as raised:
                self.acquire_archive(root, download)
            self.assertEqual(raised.exception.returncode, 23)
            self.assertEqual([command[-1] for command in commands], [MEDIA.SOURCE_URL])
            self.assertEqual(list(root.iterdir()), [])

    def test_both_transport_failures_stop_after_one_request_per_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sibling = root / 'source.download'
            sibling.write_bytes(b'keep this unrelated sibling')
            commands = []

            def download(command, **options):
                commands.append(command)
                write_download(command, options, b'partial response')
                raise subprocess.CalledProcessError(22 if len(commands) == 1 else 28, command)

            with self.assertRaises(subprocess.CalledProcessError) as raised:
                self.acquire_archive(root, download)
            self.assertEqual(raised.exception.returncode, 28)
            self.assertEqual([command[-1] for command in commands], [MEDIA.SOURCE_URL, SOURCE_MIRROR_URL])
            self.assertEqual(sibling.read_bytes(), b'keep this unrelated sibling')
            self.assertEqual(set(root.iterdir()), {sibling})

    def test_transport_fallback_shares_the_original_download_time_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []

            def download(command, **options):
                commands.append((command, options['timeout']))
                if len(commands) == 1:
                    raise subprocess.CalledProcessError(22, command)
                write_download(command, options, PUBLIC_BYTES)

            with patch('time.monotonic', side_effect=[100, 100, 140]), self.assertRaises(ArchiveVerified):
                self.acquire_archive(root, download)
            self.assertEqual(len(commands), 2)
            self.assertEqual([float(command[command.index('--max-time') + 1]) for command, _ in commands], [300, 260])
            self.assertEqual([timeout for _, timeout in commands], [300, 260])
            self.assertTrue(all(command[command.index('--connect-timeout') + 1] == '20' for command, _ in commands))

    def test_expired_acquisition_budget_cannot_dispatch_another_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = []

            def download(command, **_options):
                commands.append(command)
                raise subprocess.CalledProcessError(22, command)

            with patch('time.monotonic', side_effect=[100, 100, 401]), \
                 self.assertRaisesRegex(RuntimeError, '300-second'):
                self.acquire_archive(root, download)
            self.assertEqual([command[-1] for command in commands], [MEDIA.SOURCE_URL])
            self.assertEqual(list(root.iterdir()), [])

    def test_ci_cache_is_only_the_exact_pinned_raw_archive(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        steps = re.split(r'(?m)^      - ', workflow)
        restore = [step for step in steps if 'uses: actions/cache/restore@' in step]
        save = [step for step in steps if 'uses: actions/cache/save@' in step]
        self.assertEqual(len(restore), 1)
        self.assertEqual(len(save), 1)
        expected_path = '${{ runner.temp }}/source-cache/BigBuckBunny_640x360.m4v.zip'
        expected_key = f'player-lab-bbb-source-v1-{MEDIA.SOURCE_SHA256}'
        pins = []
        for step in [restore[0], save[0]]:
            self.assertEqual(re.findall(r'(?m)^          path: (.+)$', step), [expected_path])
            self.assertEqual(re.findall(r'(?m)^          key: (.+)$', step), [expected_key])
            self.assertNotIn('restore-keys:', step)
            pin = re.search(r'uses: actions/cache/(?:restore|save)@([0-9a-f]{40})(?:\s|$)', step)
            self.assertIsNotNone(pin)
            pins.append(pin[1])
        self.assertEqual(pins[0], pins[1])
        self.assertIn('id: bbb-source-cache', restore[0])
        self.assertIn("if: steps.bbb-source-cache.outputs.cache-hit != 'true'", save[0])
        generation = next(step for step in steps if step.startswith('name: Generate the verified public test fixture\n'))
        self.assertNotIn('if:', generation)
        self.assertIn('--source-archive "$RUNNER_TEMP/source-cache/BigBuckBunny_640x360.m4v.zip"', generation)
        self.assertLess(steps.index(restore[0]), steps.index(generation))
        self.assertLess(steps.index(generation), steps.index(save[0]))

    def test_comparison_master_preserves_one_original_variant_and_english_audio(self):
        lines = COMPARISON_MASTER.splitlines()
        for resolution, stream in [('640x360', 0), ('320x180', 1)]:
            with self.subTest(resolution=resolution):
                result = MEDIA.comparison_master(COMPARISON_MASTER, resolution)
                variant = next(line for line in lines if f'RESOLUTION={resolution},' in line)
                self.assertEqual(result, '\n'.join(lines[:3] + [variant, f'media_{stream}.m3u8']) + '\n')
                self.assertEqual(result.count('#EXT-X-STREAM-INF:'), 1)
                self.assertEqual(result.count('#EXT-X-MEDIA:'), 1)
                self.assertIn('LANGUAGE="en",DEFAULT=YES,URI="media_2.m3u8"', result)
                self.assertNotIn(f'\nmedia_{1 - stream}.m3u8\n', result)

    def test_comparison_master_rejects_ambiguous_or_malformed_input(self):
        invalid = [
            COMPARISON_MASTER.replace('RESOLUTION=320x180', 'RESOLUTION=640x360'),
            COMPARISON_MASTER.replace('BANDWIDTH=66234,', 'BANDWIDTH=66234,BANDWIDTH=66234,', 1),
            COMPARISON_MASTER + COMPARISON_MASTER.splitlines()[2] + '\n',
            COMPARISON_MASTER.replace('LANGUAGE="en"', 'LANGUAGE="de"'),
            COMPARISON_MASTER.replace('AUDIO="audio"', 'AUDIO="missing"'),
            COMPARISON_MASTER.replace('media_0.m3u8', 'media_2.m3u8'),
            COMPARISON_MASTER.replace('URI="media_2.m3u8"', 'URI="media_3.m3u8"'),
            COMPARISON_MASTER.replace('CODECS="avc1.64001e,mp4a.40.2"', 'CODECS="unterminated'),
            COMPARISON_MASTER + '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"\n',
        ]
        for value in invalid:
            with self.subTest(master=value):
                with self.assertRaises(ValueError):
                    MEDIA.comparison_master(value, '640x360')
        for resolution in ['1920x1080', '', '640x360,RESOLUTION=320x180']:
            with self.subTest(resolution=resolution), self.assertRaises(ValueError):
                MEDIA.comparison_master(COMPARISON_MASTER, resolution)

    def test_comparison_master_rejects_nonlocal_or_unexpected_playlist_references(self):
        for value in ['../media_0.m3u8', '/media_0.m3u8', 'https://example.invalid/video.m3u8',
                      'media_0.m3u8?token=fake', '%6dedia_0.m3u8', 'media_0.m3u8#fragment']:
            with self.subTest(reference=value), self.assertRaises(ValueError):
                MEDIA.comparison_master(COMPARISON_MASTER.replace('media_0.m3u8', value), '640x360')

    def test_hls_peak_uses_eligible_contiguous_windows_and_average_uses_all_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_hls_rendition(root, 0, ['0.5', '1.5', '4'], [900, 100, 200])
            # The short first segment alone is not an eligible 2..6-second window.
            # Initialization bytes must not inflate either segment rate.
            self.assertEqual(MEDIA.hls_playlist_bitrates(root / 'media_0.m3u8'), (4000, 1600))

    def test_hls_master_adds_only_the_largest_playable_audio_rendition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_hls_rendition(root, 0, ['0.5', '1.5', '4'], [900, 100, 200])
            write_hls_rendition(root, 1, ['2', '2', '2'], [100, 100, 100])
            write_hls_rendition(root, 2, ['2', '2', '2'], [25, 25, 25])
            write_hls_rendition(root, 3, ['2', '2', '2'], [50, 50, 50])
            alternate = ('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="German test track",'
                         'LANGUAGE="de",DEFAULT=NO,URI="media_3.m3u8"\n')
            master = COMPARISON_MASTER.replace('#EXT-X-STREAM-INF:', alternate + '#EXT-X-STREAM-INF:', 1)
            before = {p.name: MEDIA.digest(p) for p in root.iterdir()}
            corrected = MEDIA.hls_master_bandwidth(master, root)
            variants = [MEDIA.hls_attributes(line) for line in corrected.splitlines() if line.startswith('#EXT-X-STREAM-INF:')]
            self.assertEqual([(v['BANDWIDTH'], v['AVERAGE-BANDWIDTH']) for v in variants], [('4200', '1800'), ('600', '600')])
            self.assertEqual({p.name: MEDIA.digest(p) for p in root.iterdir()}, before)
            self.assertEqual(MEDIA.hls_master_bandwidth(corrected, root), corrected)
            baseline = MEDIA.hls_master_bandwidth(COMPARISON_MASTER, root)
            for name, resolution in MEDIA.COMPARISON_MASTERS.items():
                comparison = MEDIA.comparison_master(baseline, resolution)
                variant = next(MEDIA.hls_attributes(line) for line in comparison.splitlines() if line.startswith('#EXT-X-STREAM-INF:'))
                expected = ('4100', '1700') if '360p' in name else ('500', '500')
                self.assertEqual((variant['BANDWIDTH'], variant['AVERAGE-BANDWIDTH']), expected)

    def test_hls_master_rounds_up_only_after_combining_rendition_rates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for number in (0, 1, 2):
                write_hls_rendition(root, number, ['1.5'], [1], target=2)
            corrected = MEDIA.hls_master_bandwidth(COMPARISON_MASTER, root)
            self.assertEqual(corrected.count('BANDWIDTH=11,AVERAGE-BANDWIDTH=11,'), 2)

    def test_hls_bandwidth_rejects_unsupported_or_incomplete_media_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_hls_rendition(root, 0, ['2', '2'], [100, 100], target=2)
            playlist = root / 'media_0.m3u8'
            original = playlist.read_text()
            invalid = [original.replace('#EXTINF:2,', '#EXTINF:0,', 1),
                       original.replace('#EXTINF:2,', '#EXTINF:NaN,', 1),
                       original.replace('#EXT-X-ENDLIST\n', ''),
                       original.replace('#EXT-X-MEDIA-SEQUENCE:1', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'),
                       original.replace('#EXT-X-MEDIA-SEQUENCE:1', '#EXT-X-BYTERANGE:100@0'),
                       original.replace('chunk-stream0-00001.m4s', '../other.m4s'),
                       original.replace('chunk-stream0-00001.m4s', 'https://example.invalid/segment.m4s'),
                       original.replace('#EXTINF:2,\n', '', 1)]
            for text in invalid:
                with self.subTest(playlist=text):
                    playlist.write_text(text)
                    with self.assertRaises(ValueError):
                        MEDIA.hls_playlist_bitrates(playlist)
                    self.assertEqual(playlist.read_text(), text)

    def test_generated_masters_use_the_actual_media_rates_without_reencoding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'source.zip'
            with zipfile.ZipFile(archive, 'w') as zipped:
                zipped.writestr(MEDIA.SOURCE_MEMBER, b'controlled source placeholder')
            output = root / 'output'

            def encode(command, **_options):
                if '-version' in command:
                    return SimpleNamespace(stdout='controlled tool version\n')
                self.assertEqual(command[0], 'ffmpeg')
                baseline = output / 'vod-baseline'
                for number, size in enumerate([100, 50, 20, 40]):
                    write_hls_rendition(baseline, number, ['2'] * 30, [size] * 30, target=2)
                raw = COMPARISON_MASTER.replace('English test track",LANGUAGE="en"', 'audio_2"')
                raw = raw.replace('#EXT-X-STREAM-INF:',
                    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio_3",DEFAULT=NO,URI="media_3.m3u8"\n#EXT-X-STREAM-INF:', 1)
                (baseline / 'master.m3u8').write_text(raw)
                (baseline / 'manifest.mpd').write_text('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet lang="en"/><AdaptationSet lang="de"/></Period></MPD>')
                return SimpleNamespace(returncode=0)

            with patch.object(MEDIA, 'SOURCE_SHA256', MEDIA.digest(archive)), \
                 patch.object(MEDIA.shutil, 'which', return_value='/available-tool'), \
                 patch.object(MEDIA, 'available_cpus', return_value=2), \
                 patch.object(MEDIA, 'available_memory', return_value=1024 ** 3), \
                 patch.object(MEDIA, 'probe_representation', return_value={'last_packet_end_seconds': 60}), \
                 patch.object(MEDIA.subprocess, 'run', side_effect=encode), redirect_stdout(io.StringIO()):
                MEDIA.build(output, archive)
            for relative in ['vod-baseline/master.m3u8', 'vod-baseline/comparison-360p.m3u8',
                             'vod-baseline/comparison-180p.m3u8', 'vod-multiaudio/master.m3u8', 'vod-sprites/master.m3u8']:
                master = output / relative
                variants = [MEDIA.hls_attributes(line) for line in master.read_text().splitlines() if line.startswith('#EXT-X-STREAM-INF:')]
                self.assertTrue(all(int(v['BANDWIDTH']) != 66234 and 'AVERAGE-BANDWIDTH' in v for v in variants))
                if 'multiaudio' not in relative:
                    self.assertTrue(all(int(v['BANDWIDTH']) == (480 if v['RESOLUTION'] == '640x360' else 280) for v in variants))
                else:
                    # Uniform two-second VTT segments have one-segment peak windows.
                    subtitles = [[p.stat().st_size for p in master.parent.glob(f'subtitle-{lang}-*.vtt')]
                                 for lang in ('en', 'de')]
                    peak = max(max(sizes) * 4 for sizes in subtitles)
                    total = max(sum(sizes) * 8 for sizes in subtitles)
                    for variant in variants:
                        video_audio = 560 if variant['RESOLUTION'] == '640x360' else 360
                        self.assertEqual(int(variant['BANDWIDTH']), video_audio + peak)
                        self.assertEqual(int(variant['AVERAGE-BANDWIDTH']), (video_audio * 60 + total + 59) // 60)

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
