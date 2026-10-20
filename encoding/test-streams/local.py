#!/usr/bin/env python3
"""Build small public playback fixtures locally; no cloud account is used."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SOURCE_URL = (
    "https://download.blender.org/peach/bigbuckbunny_movies/"
    "BigBuckBunny_640x360.m4v.zip"
)
SOURCE_SHA256 = "7118242b6728d40c871479c5b3c0f0fb27d748089df15d7f1b469f297c74a2d6"
SOURCE_MEMBER = "BigBuckBunny_640x360.m4v"
ATTRIBUTION = "(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org"
LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/"
# Decoder, complex filter and two simultaneous video encoders share a budget.
ENCODE_POOLS = 4
# The fixed small ladder does not keep every configured pool busy together.
# Decode/encode dominate measured CPU work; budget two active heavy pools.
CPU_HEAVY_POOLS = 2
AUDIO_ENCODERS = 2
FRAME_QUEUE_BYTES = 640 * 360 * 3 // 2 * 48 * ENCODE_POOLS


def available_cpus():
    count = (getattr(os, 'process_cpu_count', os.cpu_count)() or 1)
    try:
        count = min(count, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        pass
    try:
        quota, period = Path('/sys/fs/cgroup/cpu.max').read_text().split()
        if quota != 'max' and int(period) > 0:
            count = min(count, max(1, int(quota) // int(period)))
    except (OSError, ValueError):
        pass
    return max(1, count)


def available_memory():
    """Estimate reclaimable memory; unknown platforms use conservative threads."""
    memory = None
    try:
        values = Path('/proc/meminfo').read_text()
        match = re.search(r'^MemAvailable:\s+(\d+) kB$', values, re.MULTILINE)
        if match:
            memory = int(match[1]) * 1024
    except OSError:
        pass
    if memory is None and sys.platform == 'darwin':
        try:
            values = subprocess.run(['vm_stat'], capture_output=True, text=True, check=True).stdout
            page_size = int(re.search(r'page size of (\d+) bytes', values)[1])
            pages = sum(int(re.search(rf'^Pages {kind}:\s+(\d+)', values, re.MULTILINE)[1])
                        for kind in ('free', 'inactive', 'speculative'))
            memory = page_size * pages
        except (OSError, subprocess.CalledProcessError, TypeError, ValueError):
            pass
    try:
        limit = Path('/sys/fs/cgroup/memory.max').read_text().strip()
        current = int(Path('/sys/fs/cgroup/memory.current').read_text())
        if limit != 'max':
            remaining = max(0, int(limit) - current)
            memory = min(memory, remaining) if memory is not None else remaining
    except (OSError, ValueError):
        pass
    return memory


def plan_threads(cpus, memory):
    # Keep the existing four-thread ceiling for this fixed 360p/180p ladder.
    # Configured pool sizes are not simultaneous CPU utilization: filter and
    # encoder stages also wait for frames. Share CPU between the heavy stages.
    cpu_limit = max(1, max(1, cpus) // CPU_HEAVY_POOLS)
    # Budget a two-second frame queue per pool/thread, keeping half the
    # available memory for libraries, audio and other work. This is a parallelism
    # estimate, not an operating-system RSS or total-thread limit.
    memory_limit = max(1, memory // (2 * FRAME_QUEUE_BYTES)) if memory else 1
    return min(4, cpu_limit, memory_limit)


def audio_master(master, prefix="", alternate=True):
    """Preserve packager paths while making test track metadata explicit."""
    if 'NAME="audio_2"' not in master or 'NAME="audio_3"' not in master:
        raise ValueError("Expected two audio renditions from the DASH packager.")
    lines = []
    for line in master.splitlines():
        if 'NAME="audio_3"' in line and not alternate:
            continue
        if line.startswith('#EXT-X-MEDIA:TYPE=AUDIO'):
            line = re.sub(r',LANGUAGE="[^"]*"', '', line)
        if 'NAME="audio_2"' in line:
            line = line.replace('NAME="audio_2"', 'NAME="English test track",LANGUAGE="en"')
        if 'NAME="audio_3"' in line:
            line = line.replace('NAME="audio_3"', 'NAME="German test track",LANGUAGE="de"')
        if prefix:
            line = re.sub(r'URI="([^"]+)"', lambda m: f'URI="{prefix}{m[1]}"', line)
            if line and not line.startswith('#'):
                line = prefix + line
        lines.append(line)
    return '\n'.join(lines) + '\n'


def add_hls_subtitles(master, directory):
    """Add native HLS test cues without re-encoding or copying video/audio."""
    renditions = []
    for language, label, text in [
        ('en', 'English test subtitles', 'English subtitle test'),
        ('de', 'German test subtitles', 'Deutscher Untertiteltest'),
    ]:
        playlist = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2',
                    '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD']
        for number in range(30):
            start, end = number * 2, (number + 1) * 2
            stamp = lambda second: f'00:{second // 60:02}:{second % 60:02}.000'
            name = f'subtitle-{language}-{number:02}.vtt'
            (directory / name).write_text(
                'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n'
                f'{stamp(start)} --> {stamp(end)}\n{text}: {start:02}s\n', encoding='utf-8')
            playlist.extend(['#EXTINF:2.000,', name])
        playlist.append('#EXT-X-ENDLIST')
        name = f'subtitle-{language}.m3u8'
        (directory / name).write_text('\n'.join(playlist) + '\n', encoding='utf-8')
        renditions.append(
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitles",'
            f'NAME="{label}",LANGUAGE="{language}",AUTOSELECT=YES,DEFAULT=NO,'
            f'FORCED=NO,URI="{name}"')
    lines = []
    for line in master.splitlines():
        if line.startswith('#EXT-X-STREAM-INF:'):
            line += ',SUBTITLES="subtitles"'
        lines.append(line)
        if line == '#EXTM3U':
            lines.extend(renditions)
    return '\n'.join(lines) + '\n'


def summarize_durations(durations):
    if not durations or any(value <= 0 for value in durations):
        raise ValueError("A media playlist has no valid segment durations.")
    interior = durations[1:-1] or durations
    return {
        'segment_count': len(durations),
        'duration_seconds': round(sum(durations), 6),
        'first_seconds': durations[0],
        'last_seconds': durations[-1],
        'interior_min_seconds': min(interior),
        'interior_max_seconds': max(interior),
    }


def prepare_output(output):
    # A failed or earlier run is evidence; never recursively delete user files.
    output.mkdir(parents=True, exist_ok=False)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def last_audio_sample_duration(fragment):
    """Read the AAC tail's stored duration, including a partial final frame.

    FFprobe 6.1 infers a full AAC frame for the final packet even when the
    fragment's track-run (trun) box stores a shorter presentation duration.
    This reader is limited to the single-track fragments generated here.
    """
    def boxes(data):
        offset = 0
        while offset < len(data):
            if len(data) - offset < 8:
                raise ValueError("The generated MP4 fragment has a truncated box header.")
            size = int.from_bytes(data[offset:offset + 4], 'big')
            kind = data[offset + 4:offset + 8]
            header = 8
            if size == 1:
                if len(data) - offset < 16:
                    raise ValueError("The generated MP4 fragment has a truncated large box.")
                size = int.from_bytes(data[offset + 8:offset + 16], 'big')
                header = 16
            elif size == 0:
                size = len(data) - offset
            if size < header or offset + size > len(data):
                raise ValueError("The generated MP4 fragment has an invalid box size.")
            yield kind, data[offset + header:offset + size]
            offset += size

    tracks = [payload for kind, movie in boxes(fragment.read_bytes()) if kind == b'moof'
              for kind, payload in boxes(movie) if kind == b'traf']
    if len(tracks) != 1:
        raise ValueError("Expected a single-track generated audio fragment.")
    contents = list(boxes(tracks[0]))
    default_duration = None
    for kind, payload in contents:
        if kind == b'tfhd':
            if len(payload) < 8:
                raise ValueError("The generated track-fragment header is truncated.")
            flags = int.from_bytes(payload[:4], 'big') & 0xffffff
            cursor = 8 + (8 if flags & 0x1 else 0) + (4 if flags & 0x2 else 0)
            if flags & 0x8:
                if len(payload) < cursor + 4:
                    raise ValueError("The generated default sample duration is truncated.")
                default_duration = int.from_bytes(payload[cursor:cursor + 4], 'big')
    runs = [payload for kind, payload in contents if kind == b'trun']
    if not runs or len(runs[-1]) < 8:
        raise ValueError("The generated audio fragment has no complete track run.")
    run = runs[-1]
    flags = int.from_bytes(run[:4], 'big') & 0xffffff
    if run[0] not in [0, 1] or flags & ~0xf05:
        raise ValueError("The generated audio track run uses unsupported fields.")
    count = int.from_bytes(run[4:8], 'big')
    cursor = 8 + (4 if flags & 0x1 else 0) + (4 if flags & 0x4 else 0)
    width = 4 * sum(bool(flags & flag) for flag in [0x100, 0x200, 0x400, 0x800])
    if not count or len(run) != cursor + count * width:
        raise ValueError("The generated audio track run has an invalid sample count.")
    if flags & 0x100:
        tail = cursor + (count - 1) * width
        duration = int.from_bytes(run[tail:tail + 4], 'big')
    else:
        duration = default_duration
    if duration is None or not 0 < duration <= 1024:
        raise ValueError("The generated AAC tail has no valid sample duration.")
    return duration


def probe_representation(baseline, number):
    """Inspect real encoded packets independently from playlist durations."""
    with tempfile.NamedTemporaryFile(suffix='.mp4') as combined:
        parts = [baseline / f'init-stream{number}.m4s',
                 *sorted(baseline.glob(f'chunk-stream{number}-*.m4s'))]
        for part in parts:
            with part.open('rb') as reader:
                shutil.copyfileobj(reader, combined, length=1024 * 1024)
        combined.flush()
        result = subprocess.run([
            'ffprobe', '-v', 'error', '-show_streams', '-show_packets',
            '-show_entries', 'stream=codec_name,width,height,duration,sample_rate:'
            'packet=pts_time,duration_time,side_data_list',
            '-of', 'json', combined.name,
        ], capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    stream = data['streams'][0]
    packets = data['packets']
    last = packets[-1]
    probe_end = round(float(last['pts_time']) + float(last['duration_time']), 6)
    report = {
        'codec': stream['codec_name'],
        'container_duration_seconds': float(stream['duration']),
        'packet_count': len(packets),
        'first_packet_seconds': float(packets[0]['pts_time']),
        'probe_last_packet_end_seconds': probe_end,
        'last_packet_end_seconds': probe_end,
        'initial_skip_samples': sum(item.get('skip_samples', 0) for item in packets[0].get('side_data_list', [])),
    }
    if stream['codec_name'] == 'aac':
        duration = last_audio_sample_duration(parts[-1])
        report['last_packet_duration_samples'] = duration
        report['last_packet_end_seconds'] = round(float(last['pts_time']) + duration / int(stream['sample_rate']), 6)
    return report


def validate_presentation_end(number, probe):
    if abs(probe['last_packet_end_seconds'] - 60) > .001:
        raise ValueError(f"Representation {number} does not end at sixty seconds: {json.dumps(probe, sort_keys=True)}")


def build(output, archive):
    for tool in ['ffmpeg', 'ffprobe', 'curl']:
        if not shutil.which(tool):
            raise RuntimeError(f"Install {tool} before generating local test media.")
    if not archive.exists():
        archive.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(
            prefix=f'.{archive.name}.', suffix='.download', dir=archive.parent
        )
        temporary = Path(name)
        try:
            # Write through the exclusively created descriptor, so curl never
            # reopens a predictable filename or follows a sibling symlink.
            with os.fdopen(descriptor, 'wb') as writer:
                subprocess.run([
                    'curl', '--fail', '--location', '--silent', '--show-error',
                    '--connect-timeout', '20', '--max-time', '300',
                    '--output', '-', SOURCE_URL,
                ], stdout=writer, check=True)
            if digest(temporary) != SOURCE_SHA256:
                raise ValueError("The downloaded public source does not match its pinned checksum.")
            try:
                # A hard link publishes the verified file atomically and fails
                # if another generator already populated this cache path.
                os.link(temporary, archive)
            except FileExistsError:
                pass  # The common checksum check below also verifies the winner.
        finally:
            temporary.unlink(missing_ok=True)
    if digest(archive) != SOURCE_SHA256:
        raise ValueError("The source archive does not match its pinned checksum.")

    prepare_output(output)
    baseline = output / 'vod-baseline'
    baseline.mkdir()
    cpus = available_cpus()
    memory = available_memory()
    threads = plan_threads(cpus, memory)
    with tempfile.TemporaryDirectory(prefix='player-lab-media-') as scratch:
        source = Path(scratch) / SOURCE_MEMBER
        # Extract only the expected member, rather than trusting archive paths.
        with zipfile.ZipFile(archive) as zipped:
            with zipped.open(SOURCE_MEMBER) as reader, source.open('wb') as writer:
                shutil.copyfileobj(reader, writer, length=1024 * 1024)
        thumbnails = output / 'vod-sprites/thumbnails'
        thumbnails.mkdir(parents=True)
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-threads', str(threads), '-i', str(source), '-t', '60',
            '-filter_complex_threads', str(threads), '-filter_complex',
            '[0:v]split=2[encode][sprites];[encode]fps=24,split=2[hi][lo];'
            '[hi]scale=640:360[v0];[lo]scale=320:180[v1];'
            '[0:a]asplit=2[a0][a1];[a1]volume=0.25[alt];'
            '[sprites]fps=1/5,scale=160:90,tile=12x1[sprite]',
            '-map', '[v0]', '-map', '[v1]', '-map', '[a0]', '-map', '[alt]',
            '-map_metadata', '-1', '-c:v', 'libx264', '-preset', 'veryfast',
            '-crf', '25', '-pix_fmt', 'yuv420p', '-g', '48', '-keyint_min', '48',
            '-sc_threshold', '0', '-bf', '0', '-threads:v', str(threads),
            '-c:a', 'aac', '-threads:a', '1', '-b:a', '64k', '-ar', '48000', '-ac', '2',
            '-metadata:s:a:0', 'language=en', '-metadata:s:a:1', 'language=de',
            '-f', 'dash', '-seg_duration', '2', '-use_template', '1',
            '-use_timeline', '1', '-hls_playlist', '1', '-hls_master_name', 'master.m3u8',
            '-adaptation_sets', 'id=0,streams=v id=1,streams=2 id=2,streams=3',
            str(baseline / 'manifest.mpd'),
            '-map', '[sprite]', '-frames:v', '1', '-c:v', 'mjpeg',
            '-threads:v', '1', str(thumbnails / 'sprite-0.jpg'),
        ], check=True)

    master = (baseline / 'master.m3u8').read_text()
    (baseline / 'master.m3u8').write_text(audio_master(master, alternate=False))
    multi = output / 'vod-multiaudio'
    multi.mkdir()
    (multi / 'master.m3u8').write_text(add_hls_subtitles(
        audio_master(master, prefix='../vod-baseline/'), multi))
    (output / 'vod-sprites/master.m3u8').write_text(
        audio_master(master, prefix='../vod-baseline/', alternate=False)
    )
    # The baseline DASH selects one audio track; its second audio payload is reused
    # by the multi-audio HLS fixture, without copying the encoded media.
    manifest = baseline / 'manifest.mpd'
    tree = ET.parse(manifest)
    namespace = {'d': 'urn:mpeg:dash:schema:mpd:2011'}
    period = tree.find('d:Period', namespace)
    for adaptation in list(period):
        if adaptation.get('lang') == 'de':
            period.remove(adaptation)
    ET.register_namespace('', namespace['d'])
    tree.write(manifest, encoding='utf-8', xml_declaration=True)

    def stamp(seconds):
        return f'00:{seconds // 60:02}:{seconds % 60:02}.000'

    cues = [
        f'{stamp(second)} --> {stamp(second + 5)}\n'
        f'sprite-0.jpg#xywh={index * 160},0,160,90\n'
        for index, second in enumerate(range(0, 60, 5))
    ]
    (thumbnails / 'thumbnails.vtt').write_text('WEBVTT\n\n' + '\n'.join(cues))
    assets = output / 'assets'
    assets.mkdir()
    shutil.copyfile(ROOT / 'encoding/test-streams/assets/sintel_en.vtt', assets / 'sintel_en.vtt')
    (output / 'ATTRIBUTION.txt').write_text(
        f'Big Buck Bunny (60-second excerpt; resized; alternate audio attenuated).\n'
        f'{ATTRIBUTION}\n{LICENSE_URL}\nhttps://peach.blender.org/about/\n\n'
        'The en/de labels are test metadata, not translations of the soundtrack.\n'
        'Native HLS subtitle renditions contain generated English/German test cues, not movie dialogue.\n'
        'Subtitle verification uses separate, retimed Sintel text, not Big Buck Bunny dialogue.\n'
        'Sintel: Blender Foundation, CC BY 3.0; https://durian.blender.org/\n'
    )
    streams = []
    for number in range(4):
        playlist = (baseline / f'media_{number}.m3u8').read_text()
        durations = [float(value) for value in re.findall(r'#EXTINF:([\d.]+)', playlist)]
        summary = summarize_durations(durations)
        if number < 2 and (len(durations) != 30 or any(abs(v - 2) > .000001 for v in durations)):
            raise ValueError("Video did not produce thirty two-second segments.")
        probe = probe_representation(baseline, number)
        validate_presentation_end(number, probe)
        streams.append({'type': 'video' if number < 2 else 'audio', 'representation': number, **summary, **probe})
    version = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True, check=True).stdout.splitlines()[0]
    probe_version = subprocess.run(['ffprobe', '-version'], capture_output=True, text=True, check=True).stdout.splitlines()[0]
    report = {
        'source_url': SOURCE_URL, 'source_sha256': SOURCE_SHA256,
        'source_license': LICENSE_URL, 'attribution': ATTRIBUTION,
        'ffmpeg': version, 'ffprobe': probe_version, 'threads_per_stage': threads,
        'thread_budget': {
            'available_cpus': cpus, 'available_memory_bytes': memory,
            'parallel_codec_filter_pools': ENCODE_POOLS,
            'cpu_heavy_pool_estimate': CPU_HEAVY_POOLS,
            'serial_audio_encoders': AUDIO_ENCODERS,
            'serial_image_encoders': 1,
            'frame_queue_bytes_per_worker_set': FRAME_QUEUE_BYTES,
            'thumbnail_filter_threads': threads,
        },
        'video_frames_per_second': 24, 'audio_sample_rate': 48000,
        'audio_samples_per_frame': 1024, 'streams': streams,
    }
    (output / 'fixture-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/test-streams')
    parser.add_argument('--source-archive', type=Path, default=ROOT / '.cache/sources/BigBuckBunny_640x360.m4v.zip')
    args = parser.parse_args()
    try:
        build(args.output.resolve(), args.source_archive.resolve())
    except FileExistsError:
        parser.exit(1, 'Output already exists. Choose a new --output directory.\n')
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f'Local media generation failed: {error}\n')
    except (OSError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Local media generation failed ({type(error).__name__}). See encoding/test-streams/README.md.\n')


if __name__ == '__main__':
    main()
