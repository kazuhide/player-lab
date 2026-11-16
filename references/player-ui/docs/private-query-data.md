# Display a private Query batch

[English](private-query-data.md) · [日本語](private-query-data.ja.md) · [Calculation](analytics-data.md)

The local development server can display precomputed aggregate Query results
alongside their matching HLS video. It reads one explicitly selected file outside
the repository. The browser and development server do not call the Analytics API.
The ordinary demo continues to use the supplied synthetic data.

## Prepare the counts

Use the [population and interval queries](analytics-data.md#use-aggregate-query-alone)
with the same video revision, license, reporting window and eligibility filters.
Count each impression once, without rendition grouping. For every interval, count
records with `VIDEOTIME_START < endMs` and `VIDEOTIME_END > startMs`.
Keep the account API key in the batch environment.

The graph divides each interval count by `sessionCount`. This measures the share
of playback records touching the interval, not the fraction of its duration
watched. Replay is unavailable: these counts cannot identify repeated passes.
The separate metric version is `watched-impression-incidence-v1`.

Prepare every interval before setting `complete: true`. A failed request is not
a count of zero. Use a fixed reporting window and bounded request concurrency;
replace the last usable file only after the full batch validates.

The following example describes a four-second video. Its URL and counts are
placeholders. Replace the source, content identity, duration, period and every
count with a consistent batch for your video.

```json
{
  "schemaVersion": 1,
  "metricVersion": "watched-impression-incidence-v1",
  "complete": true,
  "content": { "id": "example-video", "revision": "v1", "durationMs": 4000 },
  "source": { "hls": "https://example.com/video/master.m3u8" },
  "period": {
    "start": "2026-01-01T00:00:00.000Z",
    "end": "2026-01-02T00:00:00.000Z"
  },
  "generatedAt": "2026-01-02T00:00:00.000Z",
  "sessionCount": 10,
  "bucketWidthMs": 2000,
  "buckets": [
    { "startMs": 0, "endMs": 2000, "impressions": 10 },
    { "startMs": 2000, "endMs": 4000, "impressions": 4 }
  ]
}
```

All positions and durations use milliseconds; timestamps use UTC. Buckets must
cover the complete timeline in order, including a shorter final bucket when
needed. Counts are integers from zero to one billion, and an interval count
cannot exceed the population. With a nonzero population, a completed zero count
is `0%`; with no eligible records, ratios are unavailable.
Across the complete timeline, the sum of interval counts must be at least the
population: each eligible record must touch an interval. That sum can exceed the
population because one record can reach several intervals.

The [validator](../src/query-incidence.ts) rejects missing or extra fields,
credentials in URL user information, incomplete batches and inconsistent counts.
The file is limited to 512 KiB and 2,000 intervals. Use an HTTPS HLS URL that the
browser can play, or the fixed local path described below. A signed media URL may
expire; reading it from an old Analytics record does not extend its validity.

## Open the private view

Save the completed file outside every public checkout and make it readable only
by its owner. From the reference directory, start the loopback development server:

```sh
chmod 600 /absolute/private/path/query-data.json
PLAYER_UI_PRIVATE_QUERY_FILE=/absolute/private/path/query-data.json npm run dev
```

Open `http://localhost:5199/?data=private`. Add `&lang=ja` for Japanese.
The page labels the batch **Query API**, selects the watched distribution and
disables the replay metric. Its JSON link downloads the local batch, not raw
impression histories. The integration example uses a generic endpoint and does
not print the private source URL. Refresh the page after replacing the batch.

The Player compares the loaded video's duration with the supplied duration.
A mismatch hides the graph. Duration alone cannot prove that two edits are the
same: the batch producer must match the content revision and source as well.

Only `GET` and `HEAD` on the fixed `/__private/query-data` route are supported.
The route rejects cross-site requests, forwarded requests, files within this
checkout and files with group or other access. Responses are not cached. No
upstream URL, file path or API credential can be supplied through this route.

This is a local development view. Do not expose its port through a tunnel or
proxy, or publish its data, downloaded JSON or screenshots. The source URL and
aggregate values are visible to the local browser by design.

## Play a downloaded HLS package

Save media you are authorized to use in a private directory outside the checkout.
Include every referenced rendition, audio playlist, initialization segment and
media file. Name the entry playlist `master.m3u8` and rewrite all playlist URI
references to flat filenames such as `video-1080.m3u8` and `video-1080.mp4`.
Preserve segment timing and byte-range attributes; do not change the video edit.

Local filenames may contain ASCII letters, digits, hyphens and underscores, with
one of these extensions: `.m3u8`, `.ts`, `.m4s`, `.mp4`, `.aac` or `.vtt`.
Subdirectories, remote URLs, absolute paths, query parameters and playlist
variables are rejected. Each media file is limited to 512 MiB; each playlist to
1 MiB. Media files stream from disk, including byte-range requests.

In a copy of the matching private Query file, change only its source:

```json
"source": { "hls": "/__private/media/master.m3u8" }
```

Start the development server with both private paths:

```sh
chmod 700 /absolute/private/path/media
chmod 600 /absolute/private/path/media/* /absolute/private/path/query-data-local.json
PLAYER_UI_PRIVATE_QUERY_FILE=/absolute/private/path/query-data-local.json \
PLAYER_UI_PRIVATE_MEDIA_DIRECTORY=/absolute/private/path/media npm run dev
```

Open the same private view. The browser now reads the video from the local
server. Player license checks still require network access. The directory and
files must belong to the current user and have no group or other access;
symlinks are refused. Neither media files nor Query data belong in public history.

## Build the public demo

Stop the private server and remove `PLAYER_UI_PRIVATE_QUERY_FILE` and
`PLAYER_UI_PRIVATE_MEDIA_DIRECTORY` from the build environment. `npm run build`
refuses to run while either variable is set. Private files are never copied into
`dist/`, and private endpoints are absent from the built site. A production CMS
integration needs its own authorized data delivery.
