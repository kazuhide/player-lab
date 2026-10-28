"""Contract tests for the independently runnable fixture publisher."""
import importlib.util
from pathlib import Path
import sys
import unittest
import copy
import hashlib
import http.client
import json
import tempfile
import threading
import time
import socket
from functools import partial
from unittest.mock import patch
import xml.etree.ElementTree as ET

SPEC = importlib.util.spec_from_file_location("reference_media", Path(__file__).with_name("media.py"))
media = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = media
SPEC.loader.exec_module(media)


class PublicationTests(unittest.TestCase):
    def test_complete_segments_only_and_expired_window(self):
        parts = [(2.0, f"seg-{index}.m4s") for index in range(6)]
        first, visible = media.visible_segments(parts, elapsed=5.9, window=4)
        self.assertEqual((first, [p[1] for p in visible]), (0, ["seg-0.m4s", "seg-1.m4s"]))
        first, visible = media.visible_segments(parts, elapsed=10, window=4)
        self.assertEqual((first, [p[1] for p in visible]), (3, ["seg-3.m4s", "seg-4.m4s"]))

    def test_scheduled_live_ended_and_archive_are_independent(self):
        self.assertEqual(media.event_state(-1, 180, 6), ("scheduled", "not_ready"))
        self.assertEqual(media.event_state(179, 180, 6), ("live", "not_ready"))
        self.assertEqual(media.event_state(180, 180, 6), ("ended", "processing"))
        self.assertEqual(media.event_state(186, 180, 6), ("ended", "ready"))

    def test_no_path_traversal_or_encoded_traversal(self):
        for value in ["../.env", "%2e%2e/.env", "a/../../.env", "\\..\\.env"]:
            with self.subTest(value=value):
                self.assertIsNone(media.safe_path(Path("/tmp/public"), value))
        self.assertEqual(media.safe_path(Path("/tmp/public"), "lesson/manifest.mpd"), Path("/tmp/public/lesson/manifest.mpd").resolve())

    def test_webvtt_and_transcript_preserve_original_cue_times(self):
        cues = [{"startMs": 10000, "endMs": 15000, "text": "First line\nSecond line"}]
        output = media.webvtt(cues)
        self.assertIn("00:00:10.000 --> 00:00:15.000", output)
        self.assertIn("First line\nSecond line", output)
        with self.assertRaises(ValueError):
            media.webvtt([{"startMs": -1, "endMs": 500, "text": "Invalid"}])

    def test_hls_sequence_and_program_date_time_follow_original_offset(self):
        text = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n' + ''.join(f'#EXTINF:2.000,\nseg{i}.m4s\n' for i in range(6)) + '#EXT-X-ENDLIST\n'
        result = media.live_hls(text, elapsed=12, window=6, epoch_ms=0, finished=False)
        self.assertIn("#EXT-X-MEDIA-SEQUENCE:3", result)
        self.assertIn("1970-01-01T00:00:06.000Z", result)
        self.assertNotIn("seg0.m4s", result)
        self.assertNotIn("#EXT-X-ENDLIST", result)

    def test_range_requests_for_cloud_inputs_and_media_do_not_overread(self):
        self.assertEqual(media.byte_range(None, 10), (0, 9))
        self.assertEqual(media.byte_range("bytes=2-4", 10), (2, 4))
        self.assertEqual(media.byte_range("bytes=4-", 10), (4, 9))
        self.assertEqual(media.byte_range("bytes=-3", 10), (7, 9))
        self.assertEqual(media.byte_range("bytes=0-999", 10), (0, 9))
        for value in ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=1-2,4-5", "bytes=-"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                media.byte_range(value, 10)


DASH = f'''<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT12S"><Period start="PT0S"><AdaptationSet><Representation id="0"><SegmentTemplate timescale="10" initialization="init-stream$RepresentationID$.m4s" media="chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"><SegmentTimeline><S t="0" d="20" r="5" /></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>'''
HLS = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n' + ''.join(f'#EXTINF:2.000,\nseg-{i:05d}.m4s\n' for i in range(6)) + '#EXT-X-ENDLIST\n'


class HttpPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fixtures = Path(self.temp.name) / "fixtures"
        self.generated = self.fixtures / "generated"
        self.folder = self.generated / "ARC"
        for protocol in ['hls', 'dash']:
            (self.folder / protocol).mkdir(parents=True)
        (self.folder / 'hls/media.m3u8').write_text(HLS)
        (self.folder / 'hls/master.m3u8').write_text('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8\n')
        (self.folder / 'hls/init.mp4').write_bytes(b'initialization')
        (self.folder / 'dash/manifest.mpd').write_text(DASH)
        (self.folder / 'dash/init-stream0.m4s').write_bytes(b'initialization')
        for index in range(6):
            (self.folder / f'hls/seg-{index:05d}.m4s').write_bytes(bytes([index]) * 150_000)
            (self.folder / f'dash/chunk-stream0-{index+1:05d}.m4s').write_bytes(bytes([index]) * 150_000)
        source = self.folder / 'source.mp4'; source.write_bytes(b'prepared private source')
        receipt = {'assetId': 'ARC', 'requestedDurationMs': 12000, 'measuredDurationMs': 12011,
                   'generatedAt': '2026-10-28T00:00:00.000Z', 'renderUtcStartMs': 1_700_000_000_000, 'renderMode': 'synthetic-sports-utc-v1', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                   'streams': [{'type': 'video', 'durationMs': 12000}, {'type': 'audio', 'durationMs': 12011}], 'cloudJob': None}
        (self.folder / 'receipt.json').write_text(json.dumps(receipt))
        self.spec = {'assets': [{'id': 'ARC', 'durationMs': 12000}], 'live': [{'id': 'LIVE', 'archiveId': 'ARC', 'eventId': 'EVENT-A', 'durationMs': 12000}]}
        self.catalog = {'events': [{'id': 'EVENT-A', 'liveAssetId': 'LIVE', 'archiveAssetId': 'ARC'}], 'assets': [
            {'id': 'LIVE', 'kind': 'live', 'eventId': 'EVENT-A', 'durationMs': None, 'utcStartMs': None, 'utcMappings': []},
            {'id': 'ARC', 'kind': 'archive', 'eventId': 'EVENT-A', 'durationMs': 12000, 'utcStartMs': None, 'utcMappings': []},
        ]}
        self.state = {'spec': self.spec, 'catalog': self.catalog, 'epochMs': 1_700_000_000_000,
                      'startedMonotonic': time.monotonic() - 6.1, 'window': 6, 'archiveDelay': 0}
        self.paths = patch.multiple(media, FIXTURES=self.fixtures, GENERATED=self.generated)
        self.paths.start()
        self.server = media.FixtureServer(('127.0.0.1', 0), partial(media.Handler, state=self.state))
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)
        self.paths.stop(); self.temp.cleanup()

    def get(self, path, method='GET', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_future_live_fragments_are_not_available(self):
        for suffix in ['hls/seg-00005.m4s', 'dash/chunk-stream0-00006.m4s']:
            self.assertEqual(self.get('/LIVE/' + suffix)[0], 404)

    def test_expired_fragments_and_raw_source_cannot_bypass_live_routes(self):
        self.state['startedMonotonic'] = time.monotonic() - 100
        for suffix in ['hls/seg-00000.m4s', 'dash/chunk-stream0-00001.m4s', 'source.mp4']:
            self.assertEqual(self.get('/LIVE/' + suffix)[0], 404)
        self.assertEqual(self.get('/ARC/source.mp4')[0], 404)
        self.assertEqual(self.get('/prepared/ARC/source.mp4')[0], 200)

    def test_fixed_eof_sidecar_is_served_without_widening_subtitle_paths(self):
        folder = self.fixtures / 'subtitles'
        folder.mkdir(exist_ok=True)
        data = b'WEBVTT\n\n00:00:10.000 --> 00:00:30.000\nWatch the elapsed-time display.\n'
        (folder / 'SP-CLIP-A.eof-test.en.vtt').write_bytes(data)
        status, headers, body = self.get('/subtitles/SP-CLIP-A.eof-test.en.vtt')
        self.assertEqual(status, 200)
        self.assertEqual(body, data)
        self.assertTrue(headers['Content-Type'].startswith('text/vtt'))
        self.assertEqual(self.get('/subtitles/SP-CLIP-A.eof-test.en.vtt', method='HEAD')[2], b'')
        self.assertEqual(self.get('/subtitles/SP-CLIP-A.other-test.en.vtt')[0], 404)

    def test_symlinked_media_is_not_served_even_when_target_is_public(self):
        segment = self.folder / 'hls/seg-00001.m4s'
        segment.unlink(); segment.symlink_to(self.folder / 'source.mp4')
        self.assertEqual(self.get('/LIVE/hls/seg-00001.m4s')[0], 404)

    def test_range_and_head_stream_exact_bytes_without_leaking_other_files(self):
        status, headers, body = self.get('/LIVE/hls/seg-00001.m4s', headers={'Range': 'bytes=65530-65550'})
        self.assertEqual(status, 206); self.assertEqual(body, bytes([1]) * 21)
        self.assertEqual(headers['Content-Range'], 'bytes 65530-65550/150000')
        status, headers, body = self.get('/LIVE/hls/seg-00001.m4s', method='HEAD', headers={'Range': 'bytes=-10'})
        self.assertEqual(status, 206); self.assertEqual(headers['Content-Length'], '10'); self.assertEqual(body, b'')
        status, headers, body = self.get('/LIVE/hls/seg-00001.m4s', headers={'Range': 'bytes=150000-'})
        self.assertEqual(status, 416); self.assertEqual(headers['Content-Range'], 'bytes */150000')

    def test_dynamic_dash_clock_uses_the_same_epoch_as_publication(self):
        status, _, body = self.get('/LIVE/dash/manifest.mpd')
        self.assertEqual(status, 200)
        root = ET.fromstring(body)
        clock = root.find(media.NS + 'UTCTiming').attrib['value']
        self.assertTrue(clock.startswith('2023-11-14T22:13:2'), clock)

    def test_final_dash_does_not_restore_expired_segment_references(self):
        root = ET.fromstring(media.live_dash(DASH, 12, 6, 0, 12000, True))
        template = next(root.iter(media.NS + 'SegmentTemplate'))
        self.assertEqual(template.attrib['startNumber'], '4')
        self.assertEqual(len(template.find(media.NS + 'SegmentTimeline')), 3)
        self.assertNotIn('minimumUpdatePeriod', root.attrib)
        self.assertIsNotNone(root.find(media.NS + 'Period').get('duration'))

    def test_get_bodies_are_rejected_and_private_paths_are_unavailable(self):
        self.assertEqual(self.get('/catalog.json', headers={'Content-Length': '100'})[0], 400)
        for path in ['/.env', '/ARC/receipt.json', '/%252e%252e/.env', '/api/events/EVENT-A/extra']:
            self.assertEqual(self.get(path)[0], 404)

    def test_catalog_has_verified_actual_and_expected_durations(self):
        status, _, body = self.get('/catalog.json')
        self.assertEqual(status, 200)
        item = next(a for a in json.loads(body)['assets'] if a['id'] == 'ARC')
        self.assertEqual(item['expectedDurationMs'], 12000)
        self.assertEqual(item['durationMs'], 12000)
        self.assertEqual(item['measuredDurationMs'], 12011)


    def test_missing_or_changed_receipt_never_invents_actual_duration_or_utc_mapping(self):
        receipt = json.loads((self.folder / 'receipt.json').read_text())
        receipt['sha256'] = 'not-the-prepared-file'
        (self.folder / 'receipt.json').write_text(json.dumps(receipt))
        _, _, body = self.get('/catalog.json')
        assets = json.loads(body)['assets']
        for asset in assets:
            self.assertIsNone(asset['durationMs'])
            self.assertIsNone(asset['utcStartMs'])
        self.state['startedMonotonic'] = time.monotonic() - 100
        _, _, body = self.get('/api/events/EVENT-A')
        self.assertIsNone(json.loads(body)['archiveMapping'])
        self.assertEqual(json.loads(body)['archiveStatus'], 'not_ready')

    def test_status_uses_actual_manifest_bounds_and_stops_offering_live_bounds_after_end(self):
        status, _, body = self.get('/api/events/EVENT-A')
        value = json.loads(body)
        self.assertEqual(status, 200); self.assertEqual(value['status'], 'live')
        self.assertEqual(value['seekableUtcStartMs'], self.state['epochMs'])
        self.assertEqual(value['seekableUtcEndMs'], self.state['epochMs'] + 6000)
        self.assertIsNone(value['archiveMapping'])
        self.state['startedMonotonic'] = time.monotonic() - 100
        value = json.loads(self.get('/api/events/EVENT-A')[2])
        self.assertIsNone(value['seekableUtcStartMs']); self.assertIsNone(value['seekableUtcEndMs'])
        self.assertEqual(value['archiveMapping']['durationMs'], 12000)
        self.catalog['assets'][1]['eventId'] = 'OTHER-EVENT'
        value = json.loads(self.get('/api/events/EVENT-A')[2])
        self.assertIsNone(value['archiveMapping'])


    def test_missing_rendered_utc_base_does_not_fall_back_to_global_now(self):
        receipt = json.loads((self.folder / 'receipt.json').read_text())
        receipt.pop('renderUtcStartMs'); receipt.pop('renderMode')
        (self.folder / 'receipt.json').write_text(json.dumps(receipt))
        value = json.loads(self.get('/api/events/EVENT-A')[2])
        self.assertIsNone(value['utcStartMs']); self.assertIsNone(value['mediaUtcNow'])
        self.assertIsNone(value['seekableUtcStartMs']); self.assertIsNone(value['clockType'])
        self.assertEqual(self.get('/LIVE/dash/manifest.mpd')[0], 503)
        self.state['startedMonotonic'] = time.monotonic() - 100
        value = json.loads(self.get('/api/events/EVENT-A')[2])
        self.assertEqual(value['archiveStatus'], 'ready')
        self.assertIsNone(value['archiveMapping'])

    def test_each_event_uses_its_backing_receipt_clock_and_observation_is_real_request_time(self):
        import shutil
        other = self.generated / 'ARC-B'; shutil.copytree(self.folder, other)
        receipt = json.loads((other / 'receipt.json').read_text())
        receipt.update(assetId='ARC-B', renderUtcStartMs=1_800_000_000_000)
        (other / 'receipt.json').write_text(json.dumps(receipt))
        self.spec['assets'].append({'id':'ARC-B','durationMs':12000})
        self.spec['live'].append({'id':'LIVE-B','archiveId':'ARC-B','eventId':'EVENT-B','durationMs':12000})
        self.catalog['assets'].extend([{'id':'ARC-B','kind':'archive','eventId':'EVENT-B'}, {'id':'LIVE-B','kind':'live','eventId':'EVENT-B'}])
        self.catalog['events'].append({'id':'EVENT-B','liveAssetId':'LIVE-B','archiveAssetId':'ARC-B'})
        self.state['epochMs'] = 1_600_000_000_000
        a = json.loads(self.get('/api/events/EVENT-A')[2]); b = json.loads(self.get('/api/events/EVENT-B')[2])
        self.assertEqual(a['utcStartMs'], 1_700_000_000_000); self.assertEqual(b['utcStartMs'], 1_800_000_000_000)
        self.assertEqual(b['seekableUtcEndMs']-a['seekableUtcEndMs'],100_000_000_000)
        observed = media.datetime.fromisoformat(a['observedAt'].replace('Z','+00:00')).timestamp()
        self.assertLess(abs(observed-time.time()),2)
        mpd=ET.fromstring(self.get('/LIVE-B/dash/manifest.mpd')[2])
        self.assertEqual(mpd.get('availabilityStartTime'),media.utc(1_800_000_000_000))
        self.assertEqual(a['clockType'],'synthetic-fixture-clock')

    def test_hls_removed_segment_has_a_bounded_reader_grace_period(self):
        self.state['startedMonotonic'] = time.monotonic() - 8.1
        self.assertEqual(self.get('/LIVE/hls/seg-00000.m4s')[0], 200)
        self.state['startedMonotonic'] = time.monotonic() - 40
        self.assertEqual(self.get('/LIVE/hls/seg-00000.m4s')[0], 404)

    def test_connection_admission_is_bounded_and_recovers_after_clients_close(self):
        held = []
        try:
            for _ in range(8):
                client = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=1)
                client.sendall(b'GET /catalog.json HTTP/1.0\r\nX-Hold:')
                held.append(client)
            time.sleep(.05)
            with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=1) as client:
                client.sendall(b'GET /catalog.json HTTP/1.0\r\n\r\n')
                try:
                    data = client.recv(4096)
                except ConnectionResetError:
                    data = b''
                self.assertEqual(data, b'')
        finally:
            for client in held:
                client.close()
        for _ in range(100):
            try:
                if self.get('/catalog.json')[0] == 200:
                    break
            except (http.client.RemoteDisconnected, ConnectionResetError):
                time.sleep(.01)
        else:
            self.fail('Connection admission did not recover')

    def test_edited_utc_mapping_requires_matching_frame_checks_and_event_scope(self):
        target = self.generated / 'EDIT'; target.mkdir()
        data = b'prepared edited fixture'; (target / 'source.mp4').write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        source_digest = hashlib.sha256((self.folder / 'source.mp4').read_bytes()).hexdigest()
        receipt = {'assetId': 'EDIT', 'sha256': digest, 'measuredDurationMs': 8011, 'streams': [{'type': 'video', 'durationMs': 8005}]}
        (target / 'receipt.json').write_text(json.dumps(receipt))
        self.spec['assets'].append({'id': 'EDIT', 'source': 'ARC', 'durationMs': 8000, 'intervals': [[2000, 6000], [8000, 12000]]})
        self.catalog['assets'].append({'id': 'EDIT', 'kind': 'archive', 'eventId': 'EVENT-A', 'durationMs': 8000})
        checks = [{'sourcePositionMs': a, 'archivePositionMs': b, 'sourceFrameSha256': 'a'*64, 'archiveFrameSha256': 'a'*64, 'matches': True} for a,b in [(2000,0),(5960,3960),(8000,4000),(11960,7960)]]
        validation = {'schemaVersion': 1, 'assets': [{'assetId': 'EDIT', 'sourceAssetId': 'ARC', 'sourceSha256': source_digest, 'sha256': digest, 'intervals': [[2000,6000],[8000,12000]], 'boundaryChecks': checks}]}
        (self.fixtures / 'mapping-validation.json').write_text(json.dumps(validation))
        result = media.runtime_catalog(self.state, 100)
        edited = next(a for a in result['assets'] if a['id'] == 'EDIT')
        self.assertIsNone(edited['utcStartMs'])
        self.assertEqual(edited['durationMs'], 8005)
        self.assertEqual(edited['utcMappings'], [{'utcStartMs': self.state['epochMs']+2000,'utcEndMs':self.state['epochMs']+6000,'archiveStartMs':0}, {'utcStartMs':self.state['epochMs']+8000,'utcEndMs':self.state['epochMs']+12000,'archiveStartMs':4000}])
        validation['assets'][0]['boundaryChecks'][0]['sourcePositionMs'] = 0
        (self.fixtures / 'mapping-validation.json').write_text(json.dumps(validation))
        self.assertEqual(next(a for a in media.runtime_catalog(self.state,100)['assets'] if a['id']=='EDIT')['utcMappings'], [])
        validation['assets'][0]['boundaryChecks'][0]['sourcePositionMs'] = 2000
        (self.fixtures / 'mapping-validation.json').write_text(json.dumps(validation))
        self.state['timings']['ARC']['renderUtcStartMs'] = None
        self.assertEqual(next(a for a in media.runtime_catalog(self.state,100)['assets'] if a['id']=='EDIT')['utcMappings'], [])


class FixtureIntegrityTests(unittest.TestCase):
    def test_eof_sidecar_changes_only_the_existing_cue_end(self):
        canonical = (media.FIXTURES / 'subtitles/SP-CLIP-A.en.vtt').read_bytes()
        overrun = (media.FIXTURES / 'subtitles/SP-CLIP-A.eof-test.en.vtt').read_bytes()
        self.assertEqual(canonical.count(b'00:00:14.000'), 1)
        self.assertEqual(overrun, canonical.replace(b'00:00:14.000', b'00:00:30.000'))

    def test_canonical_transcript_and_language_outputs_agree(self):
        for path in (media.FIXTURES / 'subtitles').glob('*.vtt'):
            if path.name in ['overlap.en.vtt', 'malformed.vtt', 'SP-CLIP-A.eof-test.en.vtt']:
                continue
            language = path.name.split('.')[-2]
            identifier = path.name.split('.')[0]
            canonical = media.read_json(media.FIXTURES / 'transcripts' / (identifier + '.json'))['cues']
            cues = [cue for cue in canonical if cue.get('language') == language]
            self.assertEqual(path.read_text(), media.webvtt(cues), path.name)
            self.assertEqual(media.read_json(media.FIXTURES / 'transcripts' / (identifier + '.' + language + '.json'))['cues'], cues)

    def test_cue_text_cannot_inject_a_new_webvtt_block_or_markup(self):
        for value in ['text\n\n00:00:20.000 --> 00:00:21.000\ninjected', 'text\r\n\r\nNOTE hidden', '<script>bad</script>']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                media.webvtt([{'startMs': 0, 'endMs': 1000, 'text': value}])


class TimingAndGenerationTests(unittest.TestCase):

    def test_renderers_use_tick_centers_and_a_pts_based_synthetic_sports_clock(self):
        learning = '\n'.join(media.video_filters({'id':'EDU-FX-01','subject':'learning'}))
        for x in [40,320,600]:
            self.assertIn('x='+str(x)+'-tw/2:y=245', learning)
        self.assertNotIn('Self-authored fixture /', learning)
        sports='\n'.join(media.video_filters({'id':'SP-ARCH-S','subject':'sports','renderUtcStartMs':1_700_000_000_000}))
        self.assertIn('Home 1 - 0 Away',sports);self.assertIn('gmtime',sports)
        self.assertIn('1700000000.000',sports);self.assertNotIn('Number line',sports)
        self.assertIn("text='BASEBALL'",sports)
        with self.assertRaises(ValueError):media.video_filters({'id':'SP-ARCH-S','subject':'sports'})

    def test_cpu_selection_scales_down_without_exceeding_two_encoders(self):
        for cores, workers, threads in [(None, 1, 1), (1, 1, 1), (2, 1, 2), (4, 2, 2), (64, 2, 2)]:
            with patch.object(media.os, 'cpu_count', return_value=cores):
                self.assertEqual(media.encoder_workers(4), workers)
                self.assertEqual(media.encoder_threads(), threads)
                self.assertEqual(media.encoder_workers(1), 1)
                self.assertEqual(media.encoder_workers(0), 0)

    def test_selected_dependency_is_generated_once_in_topological_order(self):
        spec = {'assets': [{'id': 'BASE', 'durationMs': 12000}, {'id': 'CLIP', 'source': 'BASE', 'durationMs': 4000, 'startMs': 2000}]}
        self.assertEqual([[a['id'] for a in layer] for layer in media.generation_layers(spec, ['BASE', 'CLIP'], set())], [['BASE'], ['CLIP']])
        self.assertEqual([[a['id'] for a in layer] for layer in media.generation_layers(spec, ['CLIP'], {'BASE'})], [['CLIP']])
        with self.assertRaises(ValueError):
            media.generation_layers(spec, ['UNKNOWN'], set())

    def test_cycles_are_rejected_even_when_a_dependency_was_prepared_before(self):
        spec = {'assets': [{'id': 'A', 'source': 'B', 'durationMs': 1000}, {'id': 'B', 'source': 'A', 'durationMs': 1000}]}
        with self.assertRaises(ValueError):
            media.generation_layers(spec, ['A'], {'B'})

    def test_private_source_paths_languages_and_invalid_intervals_are_rejected(self):
        for asset in [
            {'id': '../PRIVATE', 'durationMs': 1000},
            {'id': 'A', 'durationMs': -1},
            {'id': 'A', 'durationMs': True},
            {'id': 'A', 'durationMs': 1000, 'subtitles': ['../../.env']},
            {'id': 'A', 'durationMs': 1000, 'source': '../PRIVATE'},
        ]:
            with self.subTest(asset=asset), self.assertRaises(ValueError):
                media.validate_spec({'assets': [asset]})
        spec = {'assets': [{'id': 'BASE', 'durationMs': 12000}, {'id': 'EDIT', 'durationMs': 10000, 'source': 'BASE', 'intervals': [[0, 8000], [7000, 9000]]}]}
        with self.assertRaises(ValueError):
            media.validate_spec(spec)

    def test_dash_uses_each_track_timeline_and_presentation_offset(self):
        text = DASH.replace('timescale="10"', 'timescale="10" presentationTimeOffset="100"').replace('startNumber="1"', 'startNumber="7"').replace('t="0"', 't="100"')
        root = ET.fromstring(media.live_dash(text, 5.9, 6, 0, 5900, False))
        template = next(root.iter(media.NS + 'SegmentTemplate'))
        self.assertEqual(template.attrib['startNumber'], '7')
        self.assertEqual([entry.attrib['t'] for entry in template.find(media.NS + 'SegmentTimeline')], ['100', '120'])
        audio = DASH.replace('timescale="10"', 'timescale="48000"').replace('d="20" r="5"', 'd="96256" r="5"')
        root = ET.fromstring(media.live_dash(audio, 6, 6, 0, 6000, False))
        timeline = next(root.iter(media.NS + 'SegmentTimeline'))
        self.assertEqual(len(timeline), 2)  # 3 AAC segments end after six seconds.

    def test_dash_rejects_unbounded_repeats_invalid_scales_and_oversized_timing(self):
        for text in [DASH.replace('r="5"', 'r="-1"'), DASH.replace('r="5"', 'r="10001"'), DASH.replace('timescale="10"', 'timescale="0"'), DASH.replace('d="20"', 'd="0"'), DASH.replace('t="0"', 't="999999999999999999999999999999999999999"')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                media.live_dash(text, 6, 6, 0, 6000, False)

    def test_hls_keeps_three_target_durations_and_waits_for_the_actual_last_segment(self):
        result = media.live_hls(HLS, 10, 2, 0, False)
        self.assertGreaterEqual(len(media.hls_parts(result)[1]), 3)
        padded = HLS.replace('#EXTINF:2.000,\nseg-00005', '#EXTINF:2.011,\nseg-00005')
        self.assertNotIn('#EXT-X-ENDLIST', media.live_hls(padded, 12, 6, 0, True))
        self.assertIn('#EXT-X-ENDLIST', media.live_hls(padded, 12.011, 6, 0, True))

    def test_finished_dash_waits_for_audio_tail_and_then_stops_updating(self):
        padded = DASH.replace('d="20" r="5"', 'd="20" r="4" /><S d="21"')
        first = ET.fromstring(media.live_dash(padded, 12, 6, 0, 12000, True))
        self.assertEqual(first.attrib['type'], 'dynamic')
        a = media.live_dash(padded, 12.1, 6, 0, 12100, True)
        b = media.live_dash(padded, 100, 6, 0, 100000, True)
        self.assertEqual(a, b)
        self.assertEqual(ET.fromstring(a).find(media.NS + 'Period').get('duration'), 'PT12.100000S')

    def test_unknown_probe_durations_do_not_turn_into_zero(self):
        for value in [None, 'N/A', 'nan', 'inf', '-1']:
            self.assertIsNone(media.duration_ms(value))
        self.assertEqual(media.duration_ms('20.010667'), 20011)
        self.assertEqual(media.duration_ms('0'), 0)


if __name__ == "__main__":
    unittest.main()
