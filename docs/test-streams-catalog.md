# Test-stream catalog

These are the public reference inputs used by the apps and browser tests.
The markers below describe what to check before relying on a stream for a
feature. Public live services and their manifests can change or become
unavailable; a URL alone does not establish current playback support.

Re-verify any entry with the noted command, e.g.:

```bash
curl -s <url> | grep -E 'type="dynamic"|timeShiftBufferDepth|EXT-X-ENDLIST|EXT-X-MEDIA'
```

## Live (genuinely live + DVR window)

| Use case | URL | Source | Manifest check |
| --- | --- | --- | --- |
| Live DASH + DVR (~300s) | `https://livesim2.dashif.org/livesim2/tsbd_300/testpic_2s/Manifest.mpd` | DASH-IF livesim2 | `type="dynamic"`, `timeShiftBufferDepth="PT5M"` |
| Live DASH + DVR (~60s) | `https://livesim2.dashif.org/livesim2/testpic_2s/Manifest.mpd` | DASH-IF livesim2 | `type="dynamic"`, `timeShiftBufferDepth="PT1M"` |
| Live DASH + DVR + multi-audio (~15min) | `https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd` | BBC R&D testcard (akamai origin that `rdmedia.bbc.co.uk/testcard/simulcast/manifests/avc-full.mpd` 301s to) | `type="dynamic"`, `PT15M`, `lang` deu/eng/fra |
| Live DASH + subtitles | `https://livesim2.dashif.org/livesim2/testpic_2s/multi_subs.mpd` | DASH-IF livesim2 | `type="dynamic"`, 5 segmented-TTML text AdaptationSets |
| Live DASH + thumbnails | `https://livesim2.dashif.org/livesim2/testpic_2s/Manifest_thumbs.mpd` | DASH-IF livesim2 | `type="dynamic"`, 1 image AdaptationSet (tiles) |
| Live HLS | `https://demo.unified-streaming.com/k8s/vod2live/stable/unified-learning.isml/.m3u8` | Unified Streaming | variant playlist has **no** `EXT-X-ENDLIST` (sliding) |

## VOD

| Use case | URL | Source | Manifest check |
| --- | --- | --- | --- |
| VOD HLS (7-variant ABR) | `…/tears-of-steel/tears-of-steel.ism/.m3u8` (demo.unified-streaming.com) | Unified Streaming | 7 `EXT-X-STREAM-INF` (224×100 → 1680×750) |
| VOD DASH | `https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd` | DASH-IF | on-demand profile |

## Your provisioned feature streams

| Use case | URL | Expected fixture check |
| --- | --- | --- |
| VOD HLS + sprite scrubbing | `…/test-streams/vod-sprites/master.m3u8` (+ `…/thumbnails/thumbnails.vtt`) | `getThumbnail()` tiles resolve to a real sheet (`specs/sprites.spec.ts`) |
| VOD HLS + multi-audio (en/de) | `…/test-streams/vod-multiaudio/master.m3u8` | 2 `EXT-X-MEDIA:TYPE=AUDIO`; `setAudio()` switches (`specs/multiaudio.spec.ts`) |

## Preview images and trick play

The Live HLS master advertises `EXT-X-I-FRAME-STREAM-INF` entries for I-frame
playlists. These contain independently decodable video frames for seeking;
the manifest entries alone do not establish that an SDK uses them. Sprite
scrubbing uses the separate HLS fixture above, while the DASH thumbnail stream
provides an image AdaptationSet.

## Browser test requirements

The public-reference Playwright subset runs in CI and reaches external reference
servers. Other scenarios have the requirements in
[the browser test guide](../tests/e2e/README.md). Report the cases actually
executed and any unavailable services. Provisioned tests read
`VITE_TEST_STREAM_BASE_URL` from the runner environment; create and configure
your own output before running those cases. No account-specific output address
is provided.

For deterministic feature checks without a cloud account, generate the
[local sixty-second fixture](local-test-media.md). Its HLS and DASH outputs use
the same baseline paths, with additional audio, subtitle and sprite assets.

## Why the live defaults are public streams

The apps' live sources default to these public live streams so the demo shows real
Live DVR **without a running encoder**. A live channel created with the encoding scripts finalizes to VOD when the encoder stops — which is exactly
why it must not be the default. Point the `VITE_LIVE_*_URL` env vars (web) or the
equivalent native fields at that channel while it is running.
