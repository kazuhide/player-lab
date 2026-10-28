#!/usr/bin/env python3
"""Generate self-authored H.264/AAC fixtures and serve bounded local streams.

This local publisher is a repeatable development fixture, not a cloud encoder.
It has no management credentials, uploads, or application dependencies.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import copy
import hashlib
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import threading
import time
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
GENERATED = FIXTURES / "generated"
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")
NS = "{urn:mpeg:dash:schema:mpd:2011}"
ET.register_namespace("", NS[1:-1])


def utc(epoch_ms):
    return datetime.fromtimestamp(epoch_ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def event_state(elapsed, duration, archive_delay):
    if elapsed < 0:
        return "scheduled", "not_ready"
    if elapsed < duration:
        return "live", "not_ready"
    return "ended", "ready" if elapsed >= duration + archive_delay else "processing"


def visible_segments(parts, elapsed, window):
    end = 0.0
    available = []
    for duration, uri in parts:
        end += duration
        if end <= elapsed + 0.00001:
            available.append((duration, uri))
    first = 0
    retained = sum(p[0] for p in available)
    while first < len(available) - 1 and retained - available[first][0] >= window:
        retained -= available[first][0]
        first += 1
    return first, available[first:]


def safe_path(root, request_path):
    if root.is_symlink():
        return None
    decoded = unquote(request_path)
    if "\\" in decoded or "\x00" in decoded or any(p in ("..", ".") for p in decoded.split("/")):
        return None
    root = root.resolve()
    candidate = root / decoded.lstrip("/")
    try:
        current = root
        for part in candidate.relative_to(root).parts:
            current = current / part
            if current.is_symlink():
                return None
        return candidate if candidate.is_relative_to(root) else None
    except (OSError, ValueError):
        return None


@contextmanager
def public_file(root, request_path):
    path = safe_path(root, request_path)
    if path is None or not hasattr(os, "O_NOFOLLOW"):
        raise FileNotFoundError("Unavailable fixture")
    pieces = path.relative_to(root.resolve()).parts
    if not pieces:
        raise FileNotFoundError("Unavailable fixture")
    canonical_root = root.resolve()
    descriptor = os.open(canonical_root.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    stream = None
    try:
        for part in canonical_root.parts[1:] + pieces[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        child = os.open(pieces[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
        if not stat.S_ISREG(os.fstat(child).st_mode):
            os.close(child)
            raise FileNotFoundError("Unavailable fixture")
        stream = os.fdopen(child, "rb")
        yield stream
    finally:
        if stream is not None:
            stream.close()
        os.close(descriptor)


def small_file(root, request_path, limit=1024 * 1024):
    with public_file(root, request_path) as stream:
        if os.fstat(stream.fileno()).st_size > limit:
            raise ValueError("Fixture metadata is too large")
        value = stream.read(limit + 1)
        if len(value) > limit:
            raise ValueError("Fixture metadata is too large")
        return value


def webvtt(cues):
    def timestamp(ms):
        if type(ms) is not int or ms < 0:
            raise ValueError("Cue times must be nonnegative integer milliseconds")
        seconds, milliseconds = divmod(ms, 1000)
        hours, seconds = divmod(seconds, 3600)
        minutes, seconds = divmod(seconds, 60)
        return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"
    blocks = ["WEBVTT", ""]
    for cue in cues:
        if not isinstance(cue.get("text"), str) or "\r" in cue["text"] or "\n\n" in cue["text"] or "<" in cue["text"] or "\x00" in cue["text"] or cue["endMs"] <= cue["startMs"] or "-->" in cue["text"]:
            raise ValueError("Invalid cue interval or text")
        blocks += [f"{timestamp(cue['startMs'])} --> {timestamp(cue['endMs'])}", cue["text"], ""]
    return "\n".join(blocks) + "\n"


def hls_parts(text):
    parts = []
    duration = None
    init = None
    for line in text.splitlines():
        if line.startswith("#EXT-X-MAP:"):
            init = line
        elif line.startswith("#EXTINF:"):
            duration = float(line.split(":", 1)[1].split(",", 1)[0])
        elif line and not line.startswith("#") and duration is not None:
            parts.append((duration, line))
            duration = None
    return init, parts


def live_hls(text, elapsed, window, epoch_ms, finished):
    init, parts = hls_parts(text)
    target = math.ceil(max((p[0] for p in parts), default=2))
    first, available = visible_segments(parts, min(elapsed, sum(p[0] for p in parts)), max(window, target * 3))
    lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS",
             f"#EXT-X-TARGETDURATION:{math.ceil(max((p[0] for p in parts), default=2))}",
             f"#EXT-X-MEDIA-SEQUENCE:{first}"]
    if init:
        lines.append(init)
    offset = sum(p[0] for p in parts[:first])
    for duration, uri in available:
        lines += ["#EXT-X-PROGRAM-DATE-TIME:" + utc(epoch_ms + round(offset * 1000)), f"#EXTINF:{duration:.6f},", uri]
        offset += duration
    if finished and elapsed + .00001 >= sum(duration for duration, _ in parts):
        lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


def dash_tracks(text):
    tree = ET.fromstring(text)
    periods = tree.findall(NS + "Period")
    if len(periods) != 1 or periods[0].get("start", "PT0S") not in ("PT0S", "PT0.0S"):
        raise ValueError("Fixtures require one zero-based period")
    tracks = []
    for representation in tree.iter(NS + "Representation"):
        template = representation.find(NS + "SegmentTemplate")
        if template is None:
            raise ValueError("Fixture representations require explicit segment templates")
        timeline = template.find(NS + "SegmentTimeline")
        if timeline is None:
            raise ValueError("The generated MPD requires an explicit segment timeline")
        scale = int(template.attrib.get("timescale", "1"))
        if scale <= 0 or scale > 1_000_000_000:
            raise ValueError("Invalid fixture timescale")
        pto = int(template.attrib.get("presentationTimeOffset", "0"))
        if pto < 0 or pto > 86400 * scale or len(tracks) >= 8:
            raise ValueError("Invalid fixture timing bounds")
        offset = 0
        number = int(template.attrib.get("startNumber", "1"))
        if not 0 <= number <= 100000:
            raise ValueError("Invalid fixture segment number")
        entries = []
        for entry in timeline:
            offset = int(entry.attrib.get("t", offset))
            repeat = int(entry.attrib.get("r", "0"))
            duration = int(entry.attrib["d"])
            if repeat < 0 or repeat > 10000 or len(entries) + repeat + 1 > 10000 or duration <= 0 or offset < 0 or offset + duration * (repeat + 1) > 86400 * scale:
                raise ValueError("Invalid or unbounded fixture timeline")
            for _ in range(repeat + 1):
                entries.append((number, offset, duration, (offset - pto) / scale, (offset + duration - pto) / scale))
                offset += duration
                number += 1
        tracks.append((representation.attrib.get("id", ""), template, timeline, entries))
    if not tracks:
        raise ValueError("No fixture representation")
    return tree, tracks


def template_name(pattern, representation, number=None):
    if not pattern:
        raise ValueError("Missing fixture segment path")
    value = pattern.replace("$RepresentationID$", representation)
    if number is not None:
        value = re.sub(r"\$Number(?:%0(\d{1,2})d)?\$", lambda m: str(number).zfill(int(m.group(1) or 0)), value)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", value) or "$" in value:
        raise ValueError("Unsupported fixture segment path")
    return value


def live_dash(text, elapsed, window, epoch_ms, now_ms, finished):
    tree, tracks = dash_tracks(text)
    full_end = max(entry[4] for _, _, _, entries in tracks for entry in entries)
    finished = finished and elapsed + .00001 >= full_end
    publication_end = full_end if finished else min(elapsed, full_end)
    tree.set("availabilityStartTime", utc(epoch_ms))
    tree.set("publishTime", utc(epoch_ms + round(full_end * 1000) if finished else now_ms))
    tree.set("type", "static" if finished else "dynamic")
    for name in ("minimumUpdatePeriod", "timeShiftBufferDepth", "suggestedPresentationDelay"):
        tree.attrib.pop(name, None)
    if finished:
        tree.set("mediaPresentationDuration", f"PT{full_end:.6f}S")
        for period in tree.findall(NS + "Period"):
            period.set("duration", f"PT{full_end:.6f}S")
    else:
        tree.attrib.pop("mediaPresentationDuration", None)
        tree.set("minimumUpdatePeriod", "PT2S")
        tree.set("timeShiftBufferDepth", f"PT{window}S")
        tree.set("suggestedPresentationDelay", "PT4S")
    for _, template, timeline, entries in tracks:
        visible = [entry for entry in entries if entry[4] <= publication_end + .00001 and entry[4] > max(0, publication_end - window)]
        for entry in list(timeline):
            timeline.remove(entry)
        if visible:
            template.set("startNumber", str(visible[0][0]))
        for _, offset, duration, _, _ in visible:
            ET.SubElement(timeline, NS + "S", {"t": str(offset), "d": str(duration)})
    for timing in tree.findall(NS + "UTCTiming"):
        tree.remove(timing)
    if not finished:
        ET.SubElement(tree, NS + "UTCTiming", {"schemeIdUri": "urn:mpeg:dash:utc:direct:2014", "value": utc(now_ms)})
    return ET.tostring(tree, encoding="unicode", xml_declaration=True)


def media_paths(asset_id, protocol):
    return cached_media_paths(str(GENERATED.resolve()), asset_id, protocol)


@lru_cache(maxsize=16)
def cached_media_paths(root, asset_id, protocol):
    generated = Path(root)
    if protocol == "hls":
        text = small_file(generated, asset_id + "/hls/media.m3u8").decode("utf-8")
        init, parts = hls_parts(text)
        names = {uri for _, uri in parts}
        if init:
            match = re.search(r'URI="([A-Za-z0-9_.-]+)"', init)
            if not match:
                raise ValueError("Invalid fixture initialization path")
            names.add(match.group(1))
        if any(not re.fullmatch(r"[A-Za-z0-9_.-]+", name) for name in names):
            raise ValueError("Invalid fixture segment path")
        return text, parts, names
    text = small_file(generated, asset_id + "/dash/manifest.mpd").decode("utf-8")
    _, tracks = dash_tracks(text)
    names = set()
    for representation, template, _, entries in tracks:
        names.add(template_name(template.get("initialization"), representation))
        names.update(template_name(template.get("media"), representation, entry[0]) for entry in entries)
    return text, tracks, names


def fragment_available(asset_id, protocol, filename, elapsed, window, duration):
    text, entries, names = media_paths(asset_id, protocol)
    if filename not in names:
        return False
    if filename.startswith("init"):
        return True
    duration = sum(length for length, _ in entries) if protocol == "hls" else max(entry[4] for _, _, _, segments in entries for entry in segments)
    published = min(elapsed, duration)
    if protocol == "hls":
        target = math.ceil(max((part[0] for part in entries), default=2))
        retained_window = max(window, target * 3)
        end = 0.0
        for length, uri in entries:
            end += length
            if uri == filename:
                # Removed HLS segments retain a bounded grace interval for readers
                # that obtained an earlier playlist (RFC 8216 section 6.2.2).
                return end <= published + .00001 and ((elapsed >= duration and end > max(0, duration - retained_window)) or end > max(0, elapsed - retained_window * 2 - target * 2))
        return False
    for representation, template, _, segments in entries:
        for number, _, _, _, end in segments:
            if template_name(template.get("media"), representation, number) == filename:
                return end <= published + .00001 and end > max(0, published - window)
    return False


def verified_timing(asset_id):
    try:
        receipt = json.loads(small_file(GENERATED, asset_id + "/receipt.json", 128 * 1024))
        with public_file(GENERATED, asset_id + "/source.mp4") as stream:
            hasher = hashlib.sha256()
            for block in iter(lambda: stream.read(64 * 1024), b""):
                hasher.update(block)
            digest = hasher.hexdigest()
        if receipt.get("assetId") != asset_id or receipt.get("sha256") != digest:
            return None
        video = next((item.get("durationMs") for item in receipt.get("streams", []) if item.get("type") == "video"), None)
        measured = receipt.get("measuredDurationMs")
        if type(video) is not int or video <= 0 or type(measured) is not int or measured <= 0:
            return None
        base = receipt.get("renderUtcStartMs")
        mode = receipt.get("renderMode")
        rendered = base if mode in ("synthetic-sports-utc-v1", "copied-continuous-source-utc-v1") and valid_utc_base(base) else None
        return {"videoDurationMs": video, "measuredDurationMs": measured, "sha256": digest, "renderUtcStartMs": rendered}
    except (OSError, ValueError, KeyError, StopIteration):
        return None


def valid_utc_base(value):
    return type(value) is int and 0 < value < 4_102_444_800_000


def timing_cache(state):
    with state.setdefault("timingLock", threading.Lock()):
        if "timings" not in state:
            state["timings"] = {item["id"]: verified_timing(item["id"]) for item in state["spec"].get("assets", [])}
    return state["timings"]


def source_utc_base(state, archive_id):
    timing = timing_cache(state).get(archive_id)
    return timing.get("renderUtcStartMs") if timing else None


def runtime_catalog(state, elapsed):
    catalog = copy.deepcopy(state["catalog"])
    specs = {item["id"]: item for item in state["spec"].get("assets", [])}
    live = {item["id"]: item for item in state["spec"].get("live", [])}
    timings = timing_cache(state)
    for asset in catalog.get("lessons", catalog.get("assets", [])):
        spec = specs.get(asset["id"])
        timing = timings.get(asset["id"])
        asset["expectedDurationMs"] = spec.get("durationMs") if spec else live.get(asset["id"], {}).get("durationMs")
        asset["durationMs"] = timing["videoDurationMs"] if timing else None
        asset["measuredDurationMs"] = timing["measuredDurationMs"] if timing else None
        asset["timingSource"] = "verified-local-file-receipt" if timing else None
        asset["durationBasis"] = "measured-video" if timing else None
        if "kind" in asset:
            asset["utcStartMs"] = None
            asset["utcMappings"] = []
            backing = live.get(asset["id"])
            if backing and backing["eventId"] == asset.get("eventId") and timings.get(backing["archiveId"]):
                asset["utcStartMs"] = source_utc_base(state, backing["archiveId"])
            direct = next((item for item in live.values() if item["archiveId"] == asset["id"] and item["eventId"] == asset.get("eventId")), None)
            if direct and timing:
                asset["utcStartMs"] = source_utc_base(state, asset["id"])
            elif timing and spec and spec.get("intervals"):
                asset["utcMappings"] = verified_edit_mapping(asset, spec, catalog, state)
    for event in catalog.get("events", []):
        item = next((item for item in live.values() if item["eventId"] == event["id"]), None)
        if item:
            event["status"], event["archiveStatus"] = event_state(elapsed, item["durationMs"] / 1000, state["archiveDelay"])
    return catalog


def verified_edit_mapping(asset, spec, catalog, state):
    source = spec.get("source")
    timing = state["timings"].get(asset["id"])
    original = state["timings"].get(source)
    source_asset = next((item for item in catalog.get("assets", []) if item["id"] == source), None)
    if not timing or not original or not valid_utc_base(original.get("renderUtcStartMs")) or not source_asset or source_asset.get("eventId") != asset.get("eventId"):
        return []
    try:
        receipt = json.loads(small_file(FIXTURES, "mapping-validation.json", 128 * 1024))
        if receipt.get("schemaVersion") != 1:
            return []
        check = next(item for item in receipt.get("assets", []) if item["assetId"] == asset["id"])
        if check.get("sourceAssetId") != source:
            return []
        if check.get("sourceSha256") != original["sha256"] or check.get("sha256") != timing["sha256"] or check.get("intervals") != spec["intervals"]:
            return []
        tests = check.get("boundaryChecks", [])
        expected = []
        cursor = 0
        for start, end in spec["intervals"]:
            expected.extend([(start, cursor), (end - 40, cursor + end - start - 40)])
            cursor += end - start
        if len(tests) != len(expected):
            return []
        for test, (source_ms, archive_ms) in zip(tests, expected):
            frame = test.get("sourceFrameSha256", "")
            if test.get("matches") is not True or test.get("sourcePositionMs") != source_ms or test.get("archivePositionMs") != archive_ms or not re.fullmatch(r"[0-9a-f]{64}", frame) or frame != test.get("archiveFrameSha256"):
                return []
        position = 0
        output = []
        last = 0
        for start, end in spec["intervals"]:
            if start < last or start < 0 or end <= start or end > original["videoDurationMs"] or position + end - start > timing["videoDurationMs"]:
                return []
            output.append({"utcStartMs": original["renderUtcStartMs"] + start, "utcEndMs": original["renderUtcStartMs"] + end, "archiveStartMs": position})
            position += end - start
            last = end
        return output
    except (OSError, ValueError, KeyError, StopIteration, TypeError):
        return []


def seekable_utc(item, elapsed, state):
    base = source_utc_base(state, item["archiveId"])
    if base is None:
        return None, None
    try:
        _, parts, _ = media_paths(item["archiveId"], "hls")
        target = math.ceil(max(duration for duration, _ in parts))
        first, visible = visible_segments(parts, elapsed, max(state["window"], target * 3))
        if not visible:
            return None, None
        start = sum(duration for duration, _ in parts[:first])
        end = start + sum(duration for duration, _ in visible)
        _, tracks, _ = media_paths(item["archiveId"], "dash")
        for _, _, _, entries in tracks:
            visible = [entry for entry in entries if entry[4] <= elapsed + .00001 and entry[4] > max(0, elapsed - state["window"])]
            if not visible:
                return None, None
            start = max(start, visible[0][3], 0)
            end = min(end, visible[-1][4])
        return (base + math.ceil(start * 1000), base + math.floor(end * 1000)) if end > start else (None, None)
    except (OSError, ValueError):
        return None, None


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def byte_range(value, size):
    if value is None:
        return 0, size - 1
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or size == 0:
        raise ValueError("Invalid byte range")
    a, b = match.groups()
    if not a:
        if int(b) <= 0:
            raise ValueError("Invalid suffix range")
        return max(0, size - int(b)), size - 1
    first, last = int(a), min(int(b), size - 1) if b else size - 1
    if first >= size or last < first:
        raise ValueError("Unsatisfiable byte range")
    return first, last


def run(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def ffmpeg(*arguments):
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *map(str, arguments)])


def duration_ms(value):
    try:
        number = float(value)
        return round(number * 1000) if math.isfinite(number) and number >= 0 else None
    except (TypeError, ValueError):
        return None


def encoder_threads():
    return min(2, os.cpu_count() or 1)


def encoder_workers(count):
    return min(2, max(1, (os.cpu_count() or 1) // 2), count) if count else 0


def validate_spec(spec):
    assets = spec.get("assets", [])
    identifiers = {asset.get("id") for asset in assets}
    if len(assets) != len(identifiers) or not assets or len(assets) > 32:
        raise ValueError("Invalid fixture asset set")
    by_id = {asset["id"]: asset for asset in assets}
    for asset in assets:
        if not isinstance(asset["id"], str) or not re.fullmatch(r"[A-Z0-9-]{1,64}", asset["id"]):
            raise ValueError("Invalid fixture asset ID")
        if type(asset.get("durationMs")) is not int or not 1 <= asset["durationMs"] <= 7_200_000 or any(language not in ("en", "ja") for language in asset.get("subtitles", [])):
            raise ValueError("Invalid fixture duration or language")
        if "renderUtcStartMs" in asset and not valid_utc_base(asset["renderUtcStartMs"]):
            raise ValueError("Invalid rendered UTC base")
        if "source" in asset:
            if asset["source"] not in by_id or asset["source"] == asset["id"]:
                raise ValueError("Unknown fixture source")
            source_duration = by_id[asset["source"]]["durationMs"]
            intervals = asset.get("intervals", [[asset.get("startMs", 0), asset.get("startMs", 0) + asset["durationMs"]]])
            previous = 0
            total = 0
            for start, end in intervals:
                if type(start) is not int or type(end) is not int or start < previous or end <= start or end > source_duration:
                    raise ValueError("Invalid fixture source interval")
                previous = end
                total += end - start
            if total != asset["durationMs"]:
                raise ValueError("Fixture intervals disagree with expected duration")
    visiting = set()
    visited = set()
    def check_cycle(identifier):
        if identifier in visiting:
            raise ValueError("Cyclic fixture dependency")
        if identifier in visited:
            return
        visiting.add(identifier)
        if by_id[identifier].get("source"):
            check_cycle(by_id[identifier]["source"])
        visiting.remove(identifier)
        visited.add(identifier)
    for identifier in by_id:
        check_cycle(identifier)
    live_ids = set()
    events = set()
    for item in spec.get("live", []):
        if item.get("archiveId") not in by_id or item.get("id") in identifiers | live_ids or not re.fullmatch(r"[A-Z0-9-]{1,64}", item.get("id", "")) or not re.fullmatch(r"[A-Z0-9-]{1,64}", item.get("eventId", "")) or item["eventId"] in events or item.get("durationMs") != by_id[item["archiveId"]]["durationMs"]:
            raise ValueError("Invalid or ambiguous live fixture")
        live_ids.add(item["id"])
        events.add(item["eventId"])
    return by_id


def generation_layers(spec, selected, available):
    assets = validate_spec(spec)
    wanted = set(selected or assets)
    if not wanted.issubset(assets):
        raise ValueError("Unknown fixture asset ID")
    required = set(wanted)
    visiting = set()
    visited = set()
    def include(identifier):
        if identifier in visiting:
            raise ValueError("Cyclic fixture dependency")
        if identifier in visited:
            return
        visiting.add(identifier)
        source = assets[identifier].get("source")
        if source:
            if source in wanted or source not in available:
                required.add(source)
                include(source)
        visiting.remove(identifier)
        visited.add(identifier)
    for identifier in tuple(wanted):
        include(identifier)
    layers = []
    done = set()
    while required - done:
        layer = [asset for identifier, asset in assets.items() if identifier in required - done and (asset.get("source") not in required or asset["source"] in done)]
        if not layer:
            raise ValueError("Cyclic fixture dependency")
        layers.append(layer)
        done.update(asset["id"] for asset in layer)
    return layers


def frame_hash(asset_id, position_ms):
    if not re.fullmatch(r"[A-Z0-9-]{1,64}", asset_id):
        raise ValueError("Invalid fixture asset ID")
    result = subprocess.run([FFMPEG, "-v", "error", "-nostdin", "-ss", str(position_ms / 1000),
                             "-i", str(GENERATED / asset_id / "source.mp4"), "-map", "0:v:0", "-frames:v", "1",
                             "-f", "hash", "-hash", "sha256", "-"],
                            check=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
    value = result.stdout.decode("ascii").strip()
    if not re.fullmatch(r"SHA256=[0-9a-f]{64}", value):
        raise ValueError("Missing decoded frame")
    return value.removeprefix("SHA256=")


def verify_edits(spec):
    validate_spec(spec)
    checks = []
    for asset in spec["assets"]:
        if not asset.get("intervals"):
            continue
        source = verified_timing(asset["source"])
        target = verified_timing(asset["id"])
        if not source or not target:
            continue
        position = 0
        boundaries = []
        for start, end in asset["intervals"]:
            # These fixtures are authored at 25 fps. Compare boundary frames;
            # this is sampled verification, not an exhaustive frame comparison.
            for original_ms, archive_ms in [(start, position), (end - 40, position + end - start - 40)]:
                original_hash = frame_hash(asset["source"], original_ms)
                archive_hash = frame_hash(asset["id"], archive_ms)
                boundaries.append({"sourcePositionMs": original_ms, "archivePositionMs": archive_ms,
                                   "sourceFrameSha256": original_hash, "archiveFrameSha256": archive_hash,
                                   "matches": original_hash == archive_hash})
            position += end - start
        checks.append({"assetId": asset["id"], "sourceAssetId": asset["source"], "sourceSha256": source["sha256"],
                       "sha256": target["sha256"], "intervals": asset["intervals"], "boundaryChecks": boundaries,
                       "positionToleranceMs": 40, "unmappedTailMs": max(0, target["videoDurationMs"] - position)})
    value = {"schemaVersion": 1, "source": "self-authored local media", "verifiedAt": utc(round(time.time() * 1000)),
             "method": "Decoded video frame SHA-256 at retained interval boundaries; sampled, not exhaustive; audio is measured separately.",
             "cloudJob": None, "assets": checks}
    if any(asset.get("intervals") for asset in spec["assets"]):
        write_json(FIXTURES / "mapping-validation.json", value)
    if any(not boundary["matches"] for check in checks for boundary in check["boundaryChecks"]):
        raise ValueError("Edited fixture boundary verification failed")
    return value


def video_filters(asset):
    identifier = asset["id"]
    if asset.get("subject") == "sports":
        base = asset.get("renderUtcStartMs")
        if not valid_utc_base(base):
            raise ValueError("Sports fixtures require an explicit validated UTC render base")
        return [
            "drawbox=x=40:y=104:w=560:h=190:color=0x286e58:t=fill",
            "drawbox=x=40:y=104:w=560:h=190:color=white:t=2",
            "drawbox=x=319:y=104:w=2:h=190:color=white:t=fill",
            "drawbox=x=40:y=149:w=80:h=100:color=white:t=2",
            "drawbox=x=520:y=149:w=80:h=100:color=white:t=2",
            "drawbox=x=317:y=196:w=6:h=6:color=white:t=fill",
            f"drawtext=text='{identifier}':fontsize=22:fontcolor=white:x=26:y=20",
            "drawtext=text='Home 1 - 0 Away':fontsize=22:fontcolor=white:x=360:y=20",
            "drawtext=text='Elapsed %{pts\\:hms}':fontsize=18:fontcolor=white:x=26:y=58",
            f"drawtext=text='UTC %{{pts\\:gmtime\\:{base / 1000:.3f}}}':fontsize=18:fontcolor=white:x=300:y=58",
            "drawtext=text='o':fontsize=28:fontcolor=0xffd669:x='50+mod(t*38,525)':y='185+40*sin(t)'",
        ]
    return [
        "drawbox=x=40:y=220:w=560:h=3:color=0x58d6c7:t=fill",
        "drawbox=x=39:y=200:w=2:h=40:color=white:t=fill",
        "drawbox=x=319:y=200:w=2:h=40:color=white:t=fill",
        "drawbox=x=599:y=200:w=2:h=40:color=white:t=fill",
        f"drawtext=text='{identifier}  Number line':fontsize=24:fontcolor=white:x=28:y=25",
        "drawtext=text='%{pts\\:hms}':fontsize=32:fontcolor=white:x=28:y=90",
        "drawtext=text='0':fontsize=22:fontcolor=white:x=40-tw/2:y=245",
        "drawtext=text='5':fontsize=22:fontcolor=white:x=320-tw/2:y=245",
        "drawtext=text='10':fontsize=22:fontcolor=white:x=600-tw/2:y=245",
        "drawtext=text='o':fontsize=30:fontcolor=0xffc66b:x='40+mod(t*30,560)-tw/2':y=183",
    ]


def generate_asset(asset):
    identifier = asset["id"]
    if not re.fullmatch(r"[A-Z0-9-]+", identifier):
        raise ValueError("Fixture IDs must be plain uppercase identifiers")
    output = GENERATED / identifier
    output.mkdir(parents=True, exist_ok=True)
    mp4 = output / "source.mp4"
    duration = asset["durationMs"] / 1000
    if "source" in asset:
        source = GENERATED / asset["source"] / "source.mp4"
        if asset.get("intervals"):
            pieces = []
            for index, interval in enumerate(asset["intervals"]):
                piece = output / f"part-{index}.mp4"
                ffmpeg("-ss", interval[0] / 1000, "-i", source, "-t", (interval[1] - interval[0]) / 1000,
                       "-c", "copy", "-avoid_negative_ts", "make_zero", piece)
                pieces.append(piece)
            listing = output / "pieces.txt"
            listing.write_text("".join(f"file '{p.name}'\n" for p in pieces))
            ffmpeg("-f", "concat", "-safe", "1", "-i", listing, "-c", "copy", mp4)
        else:
            ffmpeg("-ss", asset.get("startMs", 0) / 1000, "-i", source, "-t", duration, "-c", "copy",
                   "-avoid_negative_ts", "make_zero", mp4)
    else:
        filters = video_filters(asset)
        ffmpeg("-f", "lavfi", "-i", "color=c=0x14283f:s=640x360:r=25", "-f", "lavfi", "-i",
               "sine=frequency=440:sample_rate=48000", "-t", duration, "-vf", ",".join(filters),
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", encoder_threads(), "-filter_threads", "1", "-filter_complex_threads", "1", "-pix_fmt", "yuv420p",
               "-g", "50", "-keyint_min", "50", "-sc_threshold", "0", "-bf", "0", "-c:a", "aac", "-b:a", "64k",
               "-af", "volume=0.08", "-movflags", "+faststart", mp4)
    for protocol in ("hls", "dash"):
        (output / protocol).mkdir(exist_ok=True)
    ffmpeg("-i", mp4, "-c", "copy", "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
           "-hls_segment_type", "fmp4", "-hls_flags", "independent_segments", "-hls_segment_filename",
           output / "hls/seg-%05d.m4s", output / "hls/media.m3u8")
    ffmpeg("-i", mp4, "-c", "copy", "-f", "dash", "-seg_duration", "2", "-use_template", "1", "-use_timeline", "1",
           output / "dash/manifest.mpd")
    subtitles = asset.get("subtitles", [])
    master = ["#EXTM3U", "#EXT-X-VERSION:7"]
    for language in subtitles:
        canonical = read_json(FIXTURES / "transcripts" / f"{identifier}.json")["cues"]
        cues = [cue for cue in canonical if cue.get("language") == language]
        vtt = webvtt(cues)
        write_json(FIXTURES / "transcripts" / f"{identifier}.{language}.json", {"cues": cues})
        (FIXTURES / "subtitles" / f"{identifier}.{language}.vtt").write_text(vtt, encoding="utf-8")
        (output / "hls" / f"sub-{language}.vtt").write_text(vtt)
        (output / "hls" / f"sub-{language}.m3u8").write_text(
            f"#EXTM3U\n#EXT-X-TARGETDURATION:{math.ceil(duration)}\n#EXT-X-VERSION:3\n#EXTINF:{duration:.3f},\nsub-{language}.vtt\n#EXT-X-ENDLIST\n")
        master.append(f'#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="{language}",LANGUAGE="{language}",AUTOSELECT=YES,DEFAULT=NO,URI="sub-{language}.m3u8"')
    master.append('#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"' + (',SUBTITLES="subs"' if subtitles else ""))
    master.append("media.m3u8")
    (output / "hls/master.m3u8").write_text("\n".join(master) + "\n")
    probe = subprocess.check_output([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(mp4)])
    measured = json.loads(probe)
    receipt = {"assetId": identifier, "source": "self-authored local FFmpeg fixture", "generatedAt": utc(round(time.time() * 1000)),
               "requestedDurationMs": asset["durationMs"], "measuredDurationMs": duration_ms(measured.get("format", {}).get("duration")),
               "streams": [{"codec": s["codec_name"], "type": s["codec_type"], "durationMs": duration_ms(s.get("duration")), "startMs": duration_ms(s.get("start_time"))} for s in measured["streams"]],
               "sha256": file_sha256(mp4),
               "cloudJob": None, "androidPlayback": None, "receiverPlayback": None}
    if asset.get("subject") == "sports" and "source" not in asset:
        receipt["renderUtcStartMs"] = asset["renderUtcStartMs"]
        receipt["renderMode"] = "synthetic-sports-utc-v1"
        receipt["clockType"] = "synthetic-fixture-clock"
        receipt["clockExpression"] = "pts:gmtime:<renderUtcStartMs / 1000>"
    elif "source" not in asset:
        receipt["renderUtcStartMs"] = None
        receipt["renderMode"] = "number-line-v2"
    if asset.get("source"):
        original = verified_timing(asset["source"])
        if not asset.get("intervals") and original and valid_utc_base(original.get("renderUtcStartMs")):
            receipt["renderUtcStartMs"] = original["renderUtcStartMs"] + asset.get("startMs", 0)
            receipt["renderMode"] = "copied-continuous-source-utc-v1"
        else:
            receipt["renderUtcStartMs"] = None
            receipt["renderMode"] = "copied-noncontinuous-source-v1"
        receipt["sourceAssetId"] = asset["source"]
        receipt["sourceSha256"] = original.get("sha256") if original else None
        receipt["sourceUtcStartMs"] = original.get("renderUtcStartMs") if original else None
        receipt["clockType"] = "synthetic-fixture-clock" if original and valid_utc_base(original.get("renderUtcStartMs")) else None
        receipt["sourceIntervalsMs"] = asset.get("intervals", [[asset.get("startMs", 0), asset.get("startMs", 0) + asset["durationMs"]]])
    write_json(output / "receipt.json", receipt)
    print(f"Generated {identifier}: {receipt['measuredDurationMs']} ms", flush=True)
    return receipt


def generate(selected):
    if not shutil.which(FFMPEG) or not shutil.which(FFPROBE):
        raise SystemExit("Install FFmpeg and ffprobe first")
    filters = subprocess.check_output([FFMPEG, "-hide_banner", "-filters"], stderr=subprocess.DEVNULL, text=True)
    if " drawtext " not in filters:
        raise SystemExit("FFmpeg requires the drawtext filter. Set FFMPEG_BIN to a build with libfreetype/harfbuzz support (for example Homebrew ffmpeg-full).")
    spec = read_json(FIXTURES / "media-spec.json")
    available = {asset["id"] for asset in spec["assets"] if verified_timing(asset["id"])}
    batch_utc = int(time.time()) * 1000
    for group in generation_layers(spec, selected, available):
        group = [{**asset, "renderUtcStartMs": asset.get("renderUtcStartMs", batch_utc)} if asset.get("subject") == "sports" and "source" not in asset else asset for asset in group]
        # Encoder/process counts adapt downward on small CPUs. At most two
        # encoders retain their own fixed 640x360 frame buffers.
        with ThreadPoolExecutor(max_workers=encoder_workers(len(group))) as pool:
            list(pool.map(generate_asset, group))
    verify_edits(spec)


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        self.request_slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, address):
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            request.settimeout(15)
            super().process_request_thread(request, address)
        finally:
            self.request_slots.release()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, state, **kwargs):
        self.fixture_state = state
        super().__init__(*args, directory=str(GENERATED), **kwargs)

    def log_message(self, *_):
        pass  # Request paths can contain private query strings.

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)

    def send_bytes(self, value, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(value)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(value)

    def send_file(self, root, relative, content_type):
        with public_file(root, relative) as stream:
            size = os.fstat(stream.fileno()).st_size
            try:
                first, last = byte_range(self.headers.get("Range"), size)
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            partial_response = self.headers.get("Range") is not None
            self.send_response(206 if partial_response else 200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(max(0, last - first + 1)))
            self.send_header("Accept-Ranges", "bytes")
            if partial_response:
                self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
            self.end_headers()
            if self.command != "HEAD":
                stream.seek(first)
                remaining = last - first + 1
                while remaining > 0:
                    block = stream.read(min(64 * 1024, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        try:
            return self.fixture_get()
        except (FileNotFoundError, NotADirectoryError, PermissionError, ValueError, UnicodeError, ET.ParseError, KeyError, TypeError, OverflowError):
            return self.send_error(404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return None
        except OSError:
            return self.send_error(404)

    def fixture_get(self):
        if len(self.path) > 2048:
            return self.send_error(414)
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) > 1 or (lengths and lengths[0] != "0"):
            self.close_connection = True
            return self.send_error(400, "Request bodies are not supported")
        route = unquote(urlsplit(self.path).path).lstrip("/")
        if safe_path(GENERATED, route) is None or "%" in route:
            return self.send_error(404)
        state = self.fixture_state
        elapsed = time.monotonic() - state["startedMonotonic"]
        observed_ms = round(time.time() * 1000)
        spec = state["spec"]
        live = {item["id"]: item for item in spec.get("live", [])}
        assets = {item["id"]: item for item in spec.get("assets", [])}
        if route == "catalog.json":
            return self.send_json(runtime_catalog(state, elapsed))
        if route.startswith("api/events/"):
            event_id = route.removeprefix("api/events/")
            item = next((v for v in live.values() if v["eventId"] == event_id), None)
            if item is None:
                return self.send_error(404)
            catalog = runtime_catalog(state, elapsed)
            archive_asset = next((asset for asset in catalog.get("assets", []) if asset["id"] == item["archiveId"] and asset.get("eventId") == event_id), None)
            status, archive = event_state(elapsed, item["durationMs"] / 1000, state["archiveDelay"])
            if archive == "ready" and not (archive_asset and archive_asset.get("durationMs")):
                archive = "not_ready"
            mapping = None
            if archive_asset and (archive_asset.get("utcStartMs") is not None or archive_asset.get("utcMappings")):
                mapping = {key: archive_asset.get(key) for key in ("durationMs", "utcStartMs", "utcMappings")}
                mapping["assetId"] = archive_asset["id"]
            seekable = seekable_utc(item, elapsed, state) if status == "live" else (None, None)
            return self.send_json({"id": event_id, "eventId": event_id, "status": status, "archiveStatus": archive,
                                   "liveAssetId": item["id"], "archiveAssetId": item["archiveId"],
                                   "utcStartMs": source_utc_base(state, item["archiveId"]),
                                   "mediaUtcNow": (source_utc_base(state, item["archiveId"]) + round(elapsed * 1000)) if source_utc_base(state, item["archiveId"]) is not None else None,
                                   "clockType": "synthetic-fixture-clock" if source_utc_base(state, item["archiveId"]) is not None else None,
                                   "archiveMapping": mapping if archive == "ready" else None,
                                   "seekableUtcStartMs": seekable[0], "seekableUtcEndMs": seekable[1], "observedAt": utc(observed_ms)})
        if route.startswith(("subtitles/", "transcripts/")):
            allowed = {entry["id"] for entry in spec.get("assets", [])} | set(live)
            if route not in {"subtitles/malformed.vtt", "subtitles/overlap.en.vtt"} and (not re.fullmatch(r"(?:subtitles|transcripts)/[A-Z0-9-]+(?:\.(?:en|ja))?\.(?:vtt|json)", route) or route.split("/")[1].split(".")[0] not in allowed):
                return self.send_error(404)
            return self.send_file(FIXTURES, route, "text/vtt; charset=utf-8" if route.endswith(".vtt") else "application/json; charset=utf-8")
        if route.startswith("prepared/"):
            parts = route.split("/")
            if len(parts) != 3 or parts[1] not in assets or parts[2] != "source.mp4":
                return self.send_error(404)
            return self.send_file(GENERATED, parts[1] + "/source.mp4", "video/mp4")
        asset_id, _, suffix = route.partition("/")
        item = live.get(asset_id)
        if asset_id not in assets and item is None:
            return self.send_error(404)
        catalog_asset = next((asset for asset in state["catalog"].get("assets", []) if asset["id"] == asset_id), None)
        archive_live = next((v for v in live.values() if v["eventId"] == catalog_asset.get("eventId")), None) if catalog_asset and catalog_asset.get("kind") == "archive" else None
        if archive_live and event_state(elapsed, archive_live["durationMs"] / 1000, state["archiveDelay"])[1] != "ready":
            return self.send_error(404, "Archive is not ready")
        disk_id = item["archiveId"] if item else asset_id
        protocol, _, filename = suffix.partition("/")
        if protocol not in ("hls", "dash") or "/" in filename:
            return self.send_error(404)
        text, _, allowed = media_paths(disk_id, protocol)
        subtitles = assets.get(disk_id, {}).get("subtitles", [])
        extra = {"master.m3u8", "media.m3u8"} | {f"sub-{language}.{ext}" for language in subtitles for ext in ("m3u8", "vtt")} if protocol == "hls" else {"manifest.mpd"}
        if filename not in allowed | extra:
            return self.send_error(404)
        if item and filename in ("media.m3u8", "manifest.mpd"):
            if elapsed < 2:
                return self.send_error(503, "Waiting for the first complete segment")
            base = source_utc_base(state, disk_id)
            if base is None:
                return self.send_error(503, "A rendered synthetic UTC receipt is required")
            now_ms = base + round(elapsed * 1000)
            finished = elapsed >= item["durationMs"] / 1000
            if protocol == "hls":
                value = live_hls(text, elapsed, state["window"], base, finished)
                return self.send_bytes(value.encode(), "application/vnd.apple.mpegurl")
            value = live_dash(text, elapsed, state["window"], base, now_ms, finished)
            return self.send_bytes(value.encode(), "application/dash+xml")
        if item and filename in allowed and not fragment_available(disk_id, protocol, filename, elapsed, state["window"], item["durationMs"] / 1000):
            return self.send_error(404)
        content_type = {".m3u8": "application/vnd.apple.mpegurl", ".mpd": "application/dash+xml", ".vtt": "text/vtt; charset=utf-8"}.get(Path(filename).suffix, "video/mp4")
        return self.send_file(GENERATED, disk_id + "/" + suffix, content_type)


def serve(port, window, archive_delay):
    spec = read_json(FIXTURES / "media-spec.json")
    validate_spec(spec)
    catalog = copy.deepcopy(read_json(FIXTURES / "catalog.json"))
    state = {"spec": spec, "catalog": catalog, "startedMonotonic": time.monotonic(),
             "window": window, "archiveDelay": archive_delay}
    server = FixtureServer(("127.0.0.1", port), partial(Handler, state=state))
    print(f"Local fixtures: http://127.0.0.1:{port}/catalog.json (Ctrl-C to stop)", flush=True)
    print("Development fixture publisher; not a bitovp or cloud encoding receipt.", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("generate", help="Generate only this reference's self-authored local assets")
    build.add_argument("--asset", action="append", help="Generate a named media-spec asset; repeatable")
    sub.add_parser("verify", help="Verify prepared edited video boundaries without regenerating media")
    server = sub.add_parser("serve", help="Serve local media; Live publication follows real elapsed time")
    server.add_argument("--port", type=int, default=8621)
    server.add_argument("--window", type=int, default=60, help="Minimum live retention in seconds (6..7200); HLS retains at least three target durations")
    server.add_argument("--archive-delay", type=float, default=6)
    args = parser.parse_args()
    if args.command == "generate":
        generate(args.asset)
    elif args.command == "verify":
        value = verify_edits(read_json(FIXTURES / "media-spec.json"))
        print(f"Verified {len(value['assets'])} prepared edited fixture(s); no cloud or device result is implied.")
    elif 1 <= args.port <= 65535 and 6 <= args.window <= 7200 and 0 <= args.archive_delay <= 60:
        serve(args.port, args.window, args.archive_delay)
    else:
        parser.error("Port, window, or archive delay is outside its allowed range")


if __name__ == "__main__":
    main()
