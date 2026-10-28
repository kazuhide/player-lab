# Sports playback quality dashboard

Query playback quality for this sports reference app and inspect local handoff records. The interface supports English and Japanese. Its server and static web interface run independently of the Android build.

## Setup

Use Node.js 24.13 or later within the Node.js 24 release line.

```sh
cd analytics-web
cp .env.example .env
npm ci
```

Set `BITMOVIN_API_KEY` to a Bitmovin account API key with Analytics read-query permissions and `BITMOVIN_ANALYTICS_LICENSE_KEY` to this app's Analytics license. These are server settings; a Player license key is not an account API key. The optional `PORT` defaults to `9052`.

Only this directory's `.env` is loaded. Parent directories and Android configuration are not used. Keep `.env` private; the keys are never returned to the browser.

```sh
npm start
```

Open `http://127.0.0.1:9052`. Select a period, video, and media type, then choose **Refresh**. Automatic refresh is off initially. When enabled, it runs every 60 seconds while the playback-quality page is visible. Unconfigured, no data, zero, and query failure are separate states. The dashboard queries existing measurements; it does not start collection or generate playback sessions.

## Playback quality

The server fixes the platform to Android and limits queries to the seven `sports:SP-*` video IDs declared in `config.mjs`. Media-type filters select those known IDs. No custom data fields are used. Receiver comparisons remain disabled because sender measurements do not establish receiver quality.

| Metric | Query | Display |
| --- | --- | --- |
| Plays | Count `IMPRESSION_ID` with `VIDEO_STARTUPTIME > 0` | Count |
| Hours watched | Sum `PLAYED` with `PLAYED > 0` | Milliseconds divided by 3,600,000 |
| Video startup time, median | Median positive `VIDEO_STARTUPTIME` | Milliseconds divided by 1,000 |
| Video startup time, 95th percentile | Percentile 95 of positive `VIDEO_STARTUPTIME` | Milliseconds divided by 1,000 |
| Rebuffer percentage | Average `REBUFFER_PERCENTAGE` | Standard API percentage scale |
| Error percentage | Average `ERROR_PERCENTAGE` | Standard API percentage scale |

Queries explicitly disable optional context columns; the dashboard consumes only the metric result shape. Cards use whole-period queries. Hourly plots and video comparisons use their own queries. Hourly percentiles are not averaged into a period value; missing hours are not filled with zero or connected by a line. Data tables accompany the charts. The fetch timestamp is when the server received the API response, not the latest raw sample time.

Compare the same period and video IDs in Bitmovin Dashboard. Metric requests follow the [official query recipes](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1) and [Percentile API reference](https://developer.bitmovin.com/playback/reference/postanalyticsqueriespercentile).

## Handoff records

**Handoff records** reads a local JSON file in the browser. Files are not uploaded to the query server or Bitmovin. Each import replaces the previous records. Use the Android app's exported records or choose **Load fictional example**. That example is explicitly fictional: eight requests include six successes, one failure, and one pending request. Success among confirmed requests is `6 / 7 = 85.7%`; confirmed success among all requests is `6 / 8 = 75%`.

The input uses this shape:

```json
{
  "schemaVersion": 1,
  "source": "local-device-records",
  "period": { "start": "2026-10-28T00:00:00.000Z", "end": "2026-10-28T01:00:00.000Z" },
  "records": [{
    "requestId": "handoff-1",
    "requestedAt": "2026-10-28T00:30:00.000Z",
    "eventId": "SP-EVENT-A",
    "transition": "live-to-archive",
    "requested": { "videoId": "sports:SP-ARCH-EVENT", "positionMs": 90000, "playWhenReady": false },
    "confirmed": { "videoId": "sports:SP-ARCH-EVENT", "positionMs": 90000, "playWhenReady": false, "positionAdvanced": false },
    "failure": null,
    "receiverQoe": null
  }]
}
```

The example above explains the format; it is not an exported measurement. `transition` is `live-to-archive` or `cast`. `failure` is `null`, `load-failed`, `position-mismatch`, or `disconnected`. A success requires a matching video, a position within 1,000 milliseconds, and matching playback intent. An unknown requested live-edge position is `null` and remains pending; it is never replaced with zero. Confirmed positions must be actual nonnegative integers. Playing requires confirmed position advancement; paused playback requires a matching paused state. A request without that evidence remains pending unless it has an explicit failure. Receiver playback quality stays `null`.

Files are limited to 1 MiB and 200 unique requests. Unknown fields, unrelated video IDs, invalid timestamps, and estimated receiver metrics are rejected. Names, URLs, keys, and free-form diagnostic messages do not belong in these records. Handoff results remain separate from the standard Query API metrics.

## Server limits and checks

The server binds to `127.0.0.1` and validates host/origin. Only fixed static files, `GET /api/config`, and `GET /api/qoe` are served. Clients cannot choose an upstream URL, license, account key, query dimension, or platform. This unauthenticated local development server must not be exposed publicly.

Queries cover at most seven days with hourly plots, at most three concurrent upstream requests, and a ten-second whole-batch deadline. Complete results use a 15-second cache without changing their fetch timestamp. Identical requests share work; at most two batches and 16 cached selections are retained. Pages use 200 rows and `offset`, with bounded pagination and response sizes. Rate limits respect `Retry-After`, with at most one short retry within the deadline. Failed or missing values stay unavailable; demo values never replace a failed query. Earlier successful values retained after a failed refresh are labeled as such.

```sh
npm test
npm run build
```

Tests cover query contracts, platform/video filters, pagination, concurrency, caching, rate limits, deadlines, response limits, origin checks, secret-free errors, stale response rejection, chart gaps, and handoff evidence/import rules. `build` checks modules and static assets. No generated bundle or runtime dependency is required.
