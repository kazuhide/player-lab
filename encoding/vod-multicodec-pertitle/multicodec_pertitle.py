"""
VOD multi-codec Per-Title encoding -> single combined custom DASH/HLS manifest.

Goal
----
Three H.264 / HEVC / AV1 Per-Title encodings plus one shared AAC track, combined
into ONE multi-codec DASH (.mpd) and ONE multi-codec HLS (master.m3u8).

Why three jobs (not one)
------------------------
Per-Title analysis is per-codec, and Bitmovin's recommendation is 1 codec = 1 job.
So we run three independent encodings in parallel. The shared AAC track rides along
in the H.264 job (a dedicated audio-only job would re-download the source for nothing).

Why the manifest is built in code (not a template / default manifest)
----------------------------------------------------------------------
A custom manifest must reference concrete stream/muxing ids. Per-Title only produces
those ids *after* the encode finishes, and they are dynamic in number, so they cannot
be written ahead of time. We therefore:
  1. start the three Per-Title encodings,
  2. wait for all of them to FINISH (barrier),
  3. enumerate each encoding's generated fMP4 muxings via the API,
  4. build a combined custom DASH + HLS that references them across all three encodings.

Custom manifests can combine the output of multiple encodings when generated
post-encoding, which is exactly what the three-job layout needs.

Output layout (all under one base so the manifest's relative paths resolve;
the base follows provision.sh's `test-streams/<scenario>/` convention, plus a
run scope so a re-run can't clobber a published manifest)
--------------------------------------------------------------------------
    test-streams/vod-multicodec-pertitle/<RUN>/video/h264/...   <- Job A (H.264 Per-Title)
    test-streams/vod-multicodec-pertitle/<RUN>/video/hevc/...   <- Job B (HEVC  Per-Title)
    test-streams/vod-multicodec-pertitle/<RUN>/video/av1/...    <- Job C (AV1   Per-Title)
    test-streams/vod-multicodec-pertitle/<RUN>/audio/aac/...    <- Job A (AAC, shared)
    test-streams/vod-multicodec-pertitle/<RUN>/manifest.mpd , master.m3u8

Configuration (the repo convention — see docs/SETUP.md)
--------------------------------------------------------
Loaded automatically from the repo-root `.env` (secrets) and
`config/encoding.conf` (committed non-secrets); environment variables win over
both files. No ids are hard-coded: the S3 output is resolved BY NAME and created
only when missing ("bootstrap once, reference by name"), and the HTTPS input is
resolved/created by host — the same flow as encoding/test-streams/provision.sh.

    BITMOVIN_API_KEY                              account API key (secret, .env)
    BITMOVIN_TENANT_ORG_ID                        optional; multi-tenant accounts only
    BITMOVIN_OUTPUT_NAME                          S3 output resource name (encoding.conf)
    BITMOVIN_OUTPUT_BUCKET / _REGION              create the output on first use + public URLs
    BITMOVIN_OUTPUT_ACCESS_KEY / _SECRET_KEY      create the output on first use (only then)
    SOURCE_VOD_MULTICODEC_PERTITLE_HOST / _PATH   test source (encoding.conf catalog)

DRY_RUN=1 prints the resolved plan and exits before any API call (no cost).

This script CREATES and STARTS encodings, which incurs cost. It does not run anything
on import; call it explicitly.
"""

import concurrent.futures
import os
import sys
import time
from datetime import datetime
from os import path

from bitmovin_api_sdk import (
    AacAudioConfiguration,
    AclEntry,
    AclPermission,
    AudioAdaptationSet,
    AudioMediaInfo,
    Av1PerTitleConfiguration,
    Av1VideoConfiguration,
    AutoRepresentation,
    BitmovinApi,
    DashFmp4Representation,
    DashManifest,
    DashProfile,
    DashRepresentationType,
    Encoding,
    EncodingOutput,
    Fmp4Muxing,
    Fmp4MuxingListQueryParams,
    H264PerTitleConfiguration,
    H264VideoConfiguration,
    H265PerTitleConfiguration,
    H265VideoConfiguration,
    HlsManifest,
    HttpsInput,
    HttpsInputListQueryParams,
    MessageType,
    MuxingStream,
    PerTitle,
    Period,
    S3OutputListQueryParams,
    StartEncodingRequest,
    Status,
    Stream,
    StreamInfo,
    StreamInput,
    StreamMode,
    StreamSelectionMode,
    VideoAdaptationSet,
)

RUN = datetime.now().strftime("%Y%m%d-%H%M%S")
SCENARIO = "vod-multicodec-pertitle"
# Everything lands under test-streams/<scenario>/<RUN>/ on the shared showcase
# output (see config/encoding.conf) — provision.sh's layout plus a run scope.
OUTPUT_BASE = "test-streams/%s/%s" % (SCENARIO, RUN)
HLS_AUDIO_GROUP = "audio-aac"

# Per-title muxing output paths use placeholders; Per-Title fills them per rendition.
H264_VIDEO_PATH = "video/h264/{height}_{bitrate}_{uuid}"
HEVC_VIDEO_PATH = "video/hevc/{height}_{bitrate}_{uuid}"
AV1_VIDEO_PATH = "video/av1/{height}_{bitrate}_{uuid}"
AAC_AUDIO_PATH = "audio/aac"

_REPO_ROOT = path.abspath(path.join(path.dirname(path.abspath(__file__)), "..", ".."))
sys.path.insert(0, path.join(_REPO_ROOT, "encoding"))
from s3_output import create_output


def _load_env_defaults():
    """Apply repo config files as defaults: environment > .env > config/encoding.conf.

    Same precedence as scripts/env-lib.sh (docs/SETUP.md). Values are literal —
    no shell expansion — except that ONE surrounding quote pair is stripped
    (KEY="value"), and they never overwrite variables already exported.
    """
    for rel in (".env", path.join("config", "encoding.conf")):
        p = path.join(_REPO_ROOT, rel)
        if not path.isfile(p):
            continue
        with open(p, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                if key.isidentifier():
                    os.environ.setdefault(key, value)


def _api():
    key = os.environ["BITMOVIN_API_KEY"]
    org = os.environ.get("BITMOVIN_TENANT_ORG_ID")
    # The verbose SDK logger prints request bodies, including S3 credentials.
    kwargs = {"api_key": key}
    if org:
        kwargs["tenant_org_id"] = org
    return BitmovinApi(**kwargs)


api = None  # created in main() — imports and DRY_RUN stay credential-free


# ---------------------------------------------------------------------------
# Per-encoding tracking. We can hold references to STANDARD resources at build
# time (the AAC stream/muxing), but NOT to Per-Title video renditions, which
# only exist after the encode finishes and are discovered then.
# ---------------------------------------------------------------------------
class Job:
    def __init__(self, codec, encoding, start_request):
        self.codec = codec                 # "h264" | "hevc" | "av1"
        self.encoding = encoding
        self.start_request = start_request
        self.aac_stream = None             # set only for the audio-hosting job
        self.aac_muxing = None
        self.video_muxings = []            # filled during discovery (post-FINISH)


# ---------------------------------------------------------------------------
# Build phase
# ---------------------------------------------------------------------------
def build_h264_job(http_input, input_path, output):
    encoding = api.encoding.encodings.create(
        encoding=Encoding(name="multicodec %s H.264+AAC Per-Title" % RUN)
    )

    # H.264 Per-Title video: one bare template config + one template stream + muxing.
    h264_cfg = api.encoding.configurations.video.h264.create(
        h264_video_configuration=H264VideoConfiguration(name="H.264 per-title template")
    )
    v_stream = _per_title_stream(encoding, http_input, input_path, h264_cfg.id)
    _fmp4_muxing(encoding, output, H264_VIDEO_PATH, v_stream)

    # Shared AAC: STANDARD stream, known at build time -> hold its ids.
    aac_cfg = api.encoding.configurations.audio.aac.create(
        aac_audio_configuration=AacAudioConfiguration(name="AAC 128k", bitrate=128_000)
    )
    a_stream = _standard_stream(encoding, http_input, input_path, aac_cfg.id)
    a_muxing = _fmp4_muxing(encoding, output, AAC_AUDIO_PATH, a_stream)

    job = Job("h264", encoding, StartEncodingRequest(
        per_title=PerTitle(h264_configuration=H264PerTitleConfiguration(
            auto_representations=AutoRepresentation()))))
    job.aac_stream = a_stream
    job.aac_muxing = a_muxing
    return job


def build_hevc_job(http_input, input_path, output):
    encoding = api.encoding.encodings.create(
        encoding=Encoding(name="multicodec %s HEVC Per-Title" % RUN)
    )
    hevc_cfg = api.encoding.configurations.video.h265.create(
        h265_video_configuration=H265VideoConfiguration(name="HEVC per-title template")
    )
    v_stream = _per_title_stream(encoding, http_input, input_path, hevc_cfg.id)
    _fmp4_muxing(encoding, output, HEVC_VIDEO_PATH, v_stream)

    return Job("hevc", encoding, StartEncodingRequest(
        per_title=PerTitle(h265_configuration=H265PerTitleConfiguration(
            auto_representations=AutoRepresentation()))))


def build_av1_job(http_input, input_path, output):
    encoding = api.encoding.encodings.create(
        encoding=Encoding(name="multicodec %s AV1 Per-Title" % RUN)
    )
    av1_cfg = api.encoding.configurations.video.av1.create(
        av1_video_configuration=Av1VideoConfiguration(name="AV1 per-title template")
    )
    v_stream = _per_title_stream(encoding, http_input, input_path, av1_cfg.id)
    _fmp4_muxing(encoding, output, AV1_VIDEO_PATH, v_stream)

    return Job("av1", encoding, StartEncodingRequest(
        per_title=PerTitle(av1_configuration=Av1PerTitleConfiguration(
            auto_representations=AutoRepresentation()))))


def _per_title_stream(encoding, http_input, input_path, codec_config_id):
    stream = Stream(
        input_streams=[StreamInput(input_id=http_input.id, input_path=input_path,
                                   selection_mode=StreamSelectionMode.AUTO)],
        codec_config_id=codec_config_id,
        mode=StreamMode.PER_TITLE_TEMPLATE,
    )
    return api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


def _standard_stream(encoding, http_input, input_path, codec_config_id):
    stream = Stream(
        input_streams=[StreamInput(input_id=http_input.id, input_path=input_path,
                                   selection_mode=StreamSelectionMode.AUTO)],
        codec_config_id=codec_config_id,
        mode=StreamMode.STANDARD,
    )
    return api.encoding.encodings.streams.create(encoding_id=encoding.id, stream=stream)


def _fmp4_muxing(encoding, output, output_path, stream):
    # One stream per fMP4 muxing (rulebook: muxing.fmp4.exactly_one_stream).
    muxing = Fmp4Muxing(
        segment_length=4.0,
        streams=[MuxingStream(stream_id=stream.id)],
        outputs=[_encoding_output(output, output_path)],
    )
    return api.encoding.encodings.muxings.fmp4.create(encoding_id=encoding.id, fmp4_muxing=muxing)


# ---------------------------------------------------------------------------
# Start + barrier
# ---------------------------------------------------------------------------
def start_and_wait(job):
    api.encoding.encodings.start(encoding_id=job.encoding.id, start_encoding_request=job.start_request)
    while True:
        time.sleep(5)
        task = api.encoding.encodings.status(encoding_id=job.encoding.id)
        print("[%s] %s %s%%" % (job.codec, task.status, task.progress))
        if task.status is Status.FINISHED:
            return
        if task.status in (Status.ERROR, Status.CANCELED, Status.TRANSFER_ERROR):
            _log_errors(task)
            raise RuntimeError("%s encoding %s" % (job.codec, task.status))


# ---------------------------------------------------------------------------
# Discovery (post-FINISH): enumerate the Per-Title-generated fMP4 muxings.
# ---------------------------------------------------------------------------
def discover(job):
    muxings = _list_all_fmp4(job.encoding.id)
    if job.codec == "h264":
        # Job A also holds the AAC muxing; everything else is H.264 video.
        job.video_muxings = [m for m in muxings if m.id != job.aac_muxing.id]
    else:
        job.video_muxings = muxings
    print("[%s] discovered %d video muxing(s)" % (job.codec, len(job.video_muxings)))


def _list_all_fmp4(encoding_id):
    items, offset, limit = [], 0, 100
    while True:
        page = api.encoding.encodings.muxings.fmp4.list(
            encoding_id=encoding_id,
            query_params=Fmp4MuxingListQueryParams(offset=offset, limit=limit))
        items.extend(page.items or [])
        if not page.items or len(page.items) < limit:
            return items
        offset += limit


# ---------------------------------------------------------------------------
# Combined custom DASH: one video AdaptationSet per codec + one audio AdaptationSet.
# ---------------------------------------------------------------------------
def build_dash(jobs, audio_job, output, manifest_base):
    manifest = api.encoding.manifests.dash.create(
        dash_manifest=DashManifest(name="manifest.mpd", profile=DashProfile.ON_DEMAND,
                                   outputs=[_encoding_output(output, "")]))
    period = api.encoding.manifests.dash.periods.create(manifest_id=manifest.id, period=Period())

    for job in jobs:
        vas = api.encoding.manifests.dash.periods.adaptationsets.video.create(
            manifest_id=manifest.id, period_id=period.id, video_adaptation_set=VideoAdaptationSet())
        for mx in job.video_muxings:
            api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
                manifest_id=manifest.id, period_id=period.id, adaptationset_id=vas.id,
                dash_fmp4_representation=DashFmp4Representation(
                    type_=DashRepresentationType.TEMPLATE,
                    encoding_id=job.encoding.id, muxing_id=mx.id,
                    segment_path=_rel(mx, manifest_base)))

    aas = api.encoding.manifests.dash.periods.adaptationsets.audio.create(
        manifest_id=manifest.id, period_id=period.id, audio_adaptation_set=AudioAdaptationSet(lang="en"))
    api.encoding.manifests.dash.periods.adaptationsets.representations.fmp4.create(
        manifest_id=manifest.id, period_id=period.id, adaptationset_id=aas.id,
        dash_fmp4_representation=DashFmp4Representation(
            type_=DashRepresentationType.TEMPLATE,
            encoding_id=audio_job.encoding.id, muxing_id=audio_job.aac_muxing.id,
            segment_path=_rel(audio_job.aac_muxing, manifest_base)))

    _start_manifest("dash", manifest)
    return manifest


# ---------------------------------------------------------------------------
# Combined custom HLS: one shared audio rendition group + per-codec variants.
# ---------------------------------------------------------------------------
def build_hls(jobs, audio_job, output, manifest_base):
    manifest = api.encoding.manifests.hls.create(
        hls_manifest=HlsManifest(name="master.m3u8", outputs=[_encoding_output(output, "")]))

    api.encoding.manifests.hls.media.audio.create(
        manifest_id=manifest.id,
        audio_media_info=AudioMediaInfo(
            name="English", group_id=HLS_AUDIO_GROUP, language="en", uri="audio_aac.m3u8",
            encoding_id=audio_job.encoding.id, stream_id=audio_job.aac_stream.id,
            muxing_id=audio_job.aac_muxing.id, segment_path=_rel(audio_job.aac_muxing, manifest_base)))

    for job in jobs:
        for i, mx in enumerate(job.video_muxings):
            api.encoding.manifests.hls.streams.create(
                manifest_id=manifest.id,
                stream_info=StreamInfo(
                    uri="video_%s_%d.m3u8" % (job.codec, i),
                    encoding_id=job.encoding.id, stream_id=mx.streams[0].stream_id,
                    muxing_id=mx.id, audio=HLS_AUDIO_GROUP,
                    segment_path=_rel(mx, manifest_base)))

    _start_manifest("hls", manifest)
    return manifest


def _start_manifest(kind, manifest):
    svc = api.encoding.manifests.dash if kind == "dash" else api.encoding.manifests.hls
    svc.start(manifest_id=manifest.id)
    while True:
        time.sleep(5)
        task = svc.status(manifest_id=manifest.id)
        if task.status is Status.FINISHED:
            print("%s manifest finished" % kind.upper())
            return
        if task.status in (Status.ERROR, Status.CANCELED, Status.TRANSFER_ERROR):
            _log_errors(task)
            raise RuntimeError("%s manifest %s" % (kind, task.status))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _encoding_output(output, relative_path):
    return EncodingOutput(
        output_id=output.id,
        output_path=path.join(OUTPUT_BASE, relative_path),
        acl=[AclEntry(permission=AclPermission.PUBLIC_READ)])


def _rel(muxing, manifest_base):
    # Representation segment_path is relative to the manifest location. Per-Title
    # resolves the placeholders, so read the concrete path back from the muxing.
    # Normalize a possible leading slash before comparing.
    resolved = muxing.outputs[0].output_path.lstrip("/")
    base = manifest_base.lstrip("/")
    rel = resolved[len(base):] if resolved.startswith(base) else resolved
    return rel.strip("/")


def _log_errors(task):
    if not task or not task.messages:
        return
    for m in task.messages:
        if m.type is MessageType.ERROR:
            print("ERROR:", m.text)


# ---------------------------------------------------------------------------
# Resource resolution — "bootstrap once, reference by name" (docs/SETUP.md).
# ---------------------------------------------------------------------------
def _resolve_output():
    output_id = os.environ.get("OUTPUT_ID")
    if output_id:
        return api.encoding.outputs.s3.get(output_id=output_id)
    name = os.environ.get("BITMOVIN_OUTPUT_NAME", "player-lab-output")
    offset = 0
    matches = {}
    while True:
        page = api.encoding.outputs.s3.list(
            query_params=S3OutputListQueryParams(offset=offset, limit=100, name=name))
        for out in page.items or []:
            if out.name == name:  # the name query param is a partial match; require exact
                matches[out.id] = out
        if len(matches) > 1:
            raise SystemExit(
                "multiple S3 outputs have the exact name; use a unique "
                "BITMOVIN_OUTPUT_NAME or set OUTPUT_ID explicitly")
        if not page.items or len(page.items) < 100:
            break
        offset += 100
        if offset > 20000:
            raise SystemExit("S3 output listing exceeds the 20000 offset guard; set OUTPUT_ID")
    if matches:
        output = next(iter(matches.values()))
        print("using S3 output %r (%s)" % (name, output.id))
        return output
    print("creating S3 output %r" % name)
    return create_output(api)


def _resolve_input(host):
    offset = 0
    while True:
        page = api.encoding.inputs.https.list(
            query_params=HttpsInputListQueryParams(offset=offset, limit=100))
        for inp in page.items or []:
            if inp.host == host:
                print("using HTTPS input %s (%s)" % (host, inp.id))
                return inp
        if not page.items or len(page.items) < 100:
            break
        offset += 100
    print("creating HTTPS input for %s" % host)
    return api.encoding.inputs.https.create(
        https_input=HttpsInput(host=host, name="test-streams %s" % host))


def main():
    _load_env_defaults()

    # Test source: the committed catalog (config/encoding.conf), env override wins.
    host = os.environ.get("SOURCE_VOD_MULTICODEC_PERTITLE_HOST") or os.environ.get("SOURCE_DEFAULT_HOST")
    input_path = os.environ.get("SOURCE_VOD_MULTICODEC_PERTITLE_PATH")
    if not host or not input_path:
        raise SystemExit(
            "no test source — set SOURCE_VOD_MULTICODEC_PERTITLE_HOST/_PATH in config/encoding.conf")
    manifest_base = OUTPUT_BASE + "/"

    print("plan: source=https://%s%s" % (host, input_path))
    print("      output=%r  ->  %s/{manifest.mpd,master.m3u8}"
          % (os.environ.get("BITMOVIN_OUTPUT_NAME", "player-lab-output"), OUTPUT_BASE))
    print("      BITMOVIN_API_KEY set: %s" % bool(os.environ.get("BITMOVIN_API_KEY")))
    if os.environ.get("DRY_RUN"):
        print("DRY_RUN — configuration resolved; no API calls made, nothing created.")
        return

    global api
    api = _api()
    output = _resolve_output()
    http_input = _resolve_input(host)

    # 1) Build the three jobs (H.264+AAC, HEVC, AV1).
    h264 = build_h264_job(http_input, input_path, output)
    hevc = build_hevc_job(http_input, input_path, output)
    av1 = build_av1_job(http_input, input_path, output)
    jobs = [h264, hevc, av1]

    # 2) Start all three in parallel and wait for ALL to FINISH (barrier).
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(start_and_wait, jobs))

    # 3) Discover the Per-Title-generated muxings per job.
    for job in jobs:
        discover(job)

    # 4) Build one combined custom DASH and one combined custom HLS.
    dash = build_dash(jobs, audio_job=h264, output=output, manifest_base=manifest_base)
    hls = build_hls(jobs, audio_job=h264, output=output, manifest_base=manifest_base)

    print("\nDone.")
    bucket = os.environ.get("BITMOVIN_OUTPUT_BUCKET")
    region = os.environ.get("BITMOVIN_OUTPUT_REGION")
    if bucket and region:
        base = "https://%s.s3.%s.amazonaws.com/%s" % (bucket, region, OUTPUT_BASE)
        print("  DASH:  %s/manifest.mpd" % base)
        print("  HLS :  %s/master.m3u8" % base)
    else:
        print("  DASH:  %smanifest.mpd" % manifest_base)
        print("  HLS :  %smaster.m3u8" % manifest_base)


if __name__ == "__main__":
    main()
