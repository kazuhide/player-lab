# Learning playback quality dashboard

Query playback quality for this reference app. The interface supports English and Japanese. The dashboard and its server run independently of the Android build.

## Setup

Use Node.js 24.13 or later within the Node.js 24 release line.

```sh
cd analytics-dashboard
cp .env.example .env
npm ci
```

Edit this directory's `.env`:

| Variable | Value |
| --- | --- |
| `BITMOVIN_API_KEY` | A Bitmovin account API key with the permissions needed for Analytics read queries. This is different from the Player license key. |
| `BITMOVIN_ANALYTICS_LICENSE_KEY` | The Analytics license used by this reference app. |
| `PORT` | Optional local port; default `9051`. |

The server reads `.env` only from this dashboard directory. An Android configuration file or a parent directory's `.env` is not loaded. Keep this file private. Neither key is returned to the browser.

```sh
npm start
```

Open `http://127.0.0.1:9051`. Select a period and lesson, then choose **Refresh**. Automatic refresh is off initially; when enabled, it runs every 60 seconds while the page is visible. Missing configuration, no data, a value of zero, and query failures have separate states. Playback collection and this read-only query server are separate: starting the dashboard does not create playback sessions.

## Available data

Only Android data for `EDU-FX-01`, `EDU-FX-02`, and `EDU-FX-03` is queried. Playback entry filtering uses the app's `customData1`: `catalog` for selection or resume, and `playlist` for lesson transitions. Bookmark event collection and bookmark analysis are not part of this initial dashboard.

| Metric | Query | Display |
| --- | --- | --- |
| Plays | Count `IMPRESSION_ID` with `VIDEO_STARTUPTIME > 0` | Count |
| Hours watched | Sum `PLAYED` with `PLAYED > 0` | Milliseconds divided by 3,600,000 |
| Video startup time, median | Median `VIDEO_STARTUPTIME` with positive values | Milliseconds divided by 1,000 |
| Video startup time, 95th percentile | Percentile 95 of the same positive values | Milliseconds divided by 1,000 |
| Rebuffer percentage | Average `REBUFFER_PERCENTAGE` | Standard API percentage scale |
| Error percentage | Average `ERROR_PERCENTAGE` | Standard API percentage scale |

Queries explicitly disable optional context columns; the dashboard consumes only the documented metric result shape. Cards query the whole period. Hourly plots and per-video comparisons use separate queries; hourly percentiles are never averaged into a period value. Missing hours are not filled with zero, and line plots do not connect across missing hours. Each chart also has a data table.

The displayed fetch time is when the server received the API response. These aggregate queries do not establish the latest raw sample time. Compare matching periods and video IDs in Bitmovin Dashboard. See the [official metric query recipes](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1) and [Percentile API reference](https://developer.bitmovin.com/playback/reference/postanalyticsqueriespercentile).

## Local server limits

The server binds to `127.0.0.1` and accepts only its localhost host/origin. It serves fixed static files and `GET /api/config` and `GET /api/qoe`; it is not an arbitrary API proxy. Client parameters cannot change the upstream URL, account key, Analytics license, dimensions, or platform.

Queries cover at most seven days with hourly plots, at most three simultaneous upstream requests, and a ten-second deadline for the whole batch. Complete results are cached for 15 seconds; cache hits retain the original fetch time. Equal requests share work, at most two batches can be active, and the cache holds at most 16 selections. Each upstream page is limited to 200 rows and fetched using `offset`; incomplete pagination is reported as an error. Response sizes are bounded. Rate limits follow `Retry-After`, with at most one short retry within the deadline. A failed metric does not replace its value with zero or with demo data. If a refresh fails for the same selection, an earlier successful result is labeled as such.

The browser cannot select receiver data: Android sender data does not establish receiver playback quality. This local development server has no authentication and must not be exposed on a public interface.

## Checks

```sh
npm test
npm run build
```

The tests cover query contracts, filtering, pagination, concurrency, caching, rate limits, deadlines, response bounds, origin checks, secret-free errors, stale browser responses, and missing chart values. `build` checks the JavaScript modules and static assets; there is no generated bundle or runtime dependency.
