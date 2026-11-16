# Rewatching from Observability playback records

This demo stages an audience that joins at different positions, rewinds and resumes
playback. Bitmovin Player and its Analytics collector produce the records. The
records are retrieved through the Observability APIs and aggregated before the
page loads. The media is an on-demand HLS clip; live-style viewing is the demo
scenario.

## Why the scenarios are separate

The selector changes saved playback records and their precomputed snapshots.
It does not choose a different aggregation formula or definition of rewatching.
The examples compare how to read results when viewing behavior or record count changes for the same video.

| Scenario | Playback pattern | What to compare |
| --- | --- | --- |
| Concentrated rewatching | Records include returns to the same moments | Rewatching shared by records at particular moments |
| Distributed rewatching | Records include returns to different moments | The result when rewatch positions do not line up |
| A small audience | A few records include returns to earlier moments | A high percentage can still come from few records |

A curve can be drawn from few records, but a high percentage alone does not establish a pattern shared by a broad audience.
Records are Analytics impressions, meaning playback sessions, not unique people.
These are authored demo patterns, not an automatic classifier of real viewers.

Rewatching is selected initially. Changing the scenario updates the graph while the video keeps playing.
Open **Scenarios and calculation** below the demo for the explanation and guide link.

## One aggregation method for every scenario

[observed-replay.ts](../src/observed-replay.ts) receives playback records, content identity, a reporting period and interval width.
It does not receive the scenario name or ID as a calculation condition.
`chooseProfile` in [main.ts](../src/main.ts) selects a precomputed snapshot, not another formula.
These are Player Lab metrics; they do not reproduce the Dashboard's Engagement formula.

1. Check sequence receipts and remove identical retries, then sort by sequence.
   Missing sequences or conflicting retries reject the record rather than silently lowering its contribution.
2. Accept valid content ranges with `state: "playing"`, `played > 0` and `seeked = 0`.
   Seek jumps and ambiguous ranges immediately before a seek do not become watched coverage.
3. Separate passes at backward seeks and merge overlapping fragments within each pass.
   Watched coverage is the union of positions played at least once; replay coverage covers positions played in at least two distinct passes.
4. Intersect each record's watched and replayed ranges with each graph interval and sum their lengths.

Let `L` be the interval length and `N` the total number of records containing an accepted played range.
Ordinary intervals are 2,000 ms; use the actual shorter length for a final partial interval.

```text
Watched coverage = sum of each record's watched milliseconds inside the interval / (L × N)
Replay coverage = sum of each record's replayed milliseconds inside the interval / (L × N)
```

`N` includes eligible records that never reached the selected interval. Startup-only records are excluded.
When `N = 0`, coverage remains `null` rather than dividing by zero.
`support` counts records reaching that interval; it is not the denominator `N`.
Repeated rewatches in one record contribute at most once per content position.
Lengths come from video positions, so slow playback alone does not increase coverage.
Observed positions with no rewatch have `0`; an interval without observations retains `null`.

### Worked examples with different behavior and counts

Each example uses a two-second interval. The denominator changes with the record count even if the total replayed length stays the same.

| Example | N | Total replayed milliseconds inside the interval | Calculation |
| --- | --- | --- | --- |
| Concentrated | 8 | 12,000 ms | `12,000 / (2,000 × 8) = 75%` |
| One interval in distributed viewing | 8 | 2,000 ms | `2,000 / (2,000 × 8) = 12.5%` |
| Small audience | 4 | 6,000 ms | `6,000 / (2,000 × 4) = 75%` |

Distributed viewing can contribute less to any one interval because the records revisit different positions.
The small-audience 75% is not supported by as many records as the eight-record 75%.
Neither percentage is a probability that a moment was interesting or a statistical confidence score.

Partial rewatches contribute only their covered length. If two of eight records rewatch 1,618 ms and 1,616 ms of a two-second interval,
and the others contribute zero, coverage is `3,234 / (2,000 × 8) = 20.2125%`.
Counting two records as `2 / 8 = 25%` would be a different metric.
Select an interval in the app to inspect the contributions and formula for the actual input.

### Aggregation values and drawing

Aggregation is shared, but [drawing](../src/timeline-geometry.ts) varies smoothing strength with record count.
This is a display heuristic, not a calculation of statistical confidence in sparse data.
For a raw value `r` and its weighted local average `a`, the drawing value `d` is:

```text
alpha = 1 / (1 + sqrt(max(1, N)))
d = (1 - alpha) × r + alpha × a
```

With observed neighbors on both sides, `a = (left + 2 × r + right) / 4`.
At an edge, only available neighbors are used; averaging never crosses an unobserved gap.
For four records, `alpha` is about 0.333; for eight it is about 0.261. Fewer records therefore move the drawing a little closer to neighboring values.

Card previews share a 0–100% scale. The video overlay expands its own smoothed maximum to the graph height.
Curves whose raw maxima are 12.5% and 75% can therefore have equally tall overlay peaks.
Use **Underlying values** or **API response and calculation** to compare original percentages across scenarios.
Those numbers precede smoothing; drawing never changes the snapshot.
See [metric definitions](analytics-data.md#what-the-values-mean) for the difference from record-count incidence.

## Inspect the API values and calculation in the app

Open **API response and calculation** beside the graph controls, then choose a
playback record and graph interval. The table shows one returned sample per row,
in its original order: `sequence_number`, `state`, `videotime_start`,
`videotime_end`, `played`, `seeked` and its treatment in the calculation.
Select a sequence to see the reason. Rows contributing to the selected interval
are marked and connected to the calculation below.

![API sample rows contributing to the selected interval](screenshots/api-evidence-raw-en.png)

The calculation follows the sample sequences and playback passes into watched
and rewatched ranges within that interval, then into the selected record's
contributing milliseconds. The formula below uses the totals across all records.
These are content-timeline lengths, not elapsed wall-clock `played` durations.

![From samples to watched and rewatched ranges and the interval formula](screenshots/api-evidence-calculation-en.png)

Expand the details for the per-record breakdown or original response JSON. The
JSON is a field-selected excerpt that preserves original names, values, order and
identical retries; authentication and user metadata are excluded. Record selectors
use local display IDs, not returned impression IDs. Changing the record, interval
or language keeps playback running.

The calculation and snapshot use the same aggregation implementation.
Neither exclusions nor a terminal-duration adjustment change the original API values.

## Collect records and find them in Dashboard

Use a dedicated demo Analytics license. A collection Player can use the following
metadata to keep demo records identifiable. Replace the placeholders consistently
in the collector and the queries:

```ts
analytics: {
  key: "<DEMO_ANALYTICS_LICENSE_KEY>",
  config: { cookiesEnabled: false },
  videoId: "player-lab-live-demo-<RUN_ID>-<SCENARIO>",
  title: "Player Lab rewatching demo",
  customData1: "player-lab-observability-demo",
  customData2: "<SCENARIO>",
  customData3: "<RUN_ID>",
}
```

In Bitmovin Dashboard, select that license and the collection time range. Filter
by the video ID, `customData1` demo marker or `customData3` run marker, then open
an impression's details to inspect playback intervals and seeks. See the official
[collector configuration](https://developer.bitmovin.com/playback/docs/configuration-analytics)
for metadata and filter settings.

When automating playback, wait for `PlayerEvent.Seeked` and confirm that the
Player's current position has reached the target before continuing. Accelerated
playback shortens data collection; its startup and seek timings are not playback
quality or performance benchmarks. The reference page itself keeps Analytics
collection disabled.

## Retrieve records on the server

The pipeline is Query API discovery → Impression Details → interval aggregation
→ saved snapshot → browser. Keep the account API key on the server. The examples
below describe requests to adapt in a server-side script; this app does not ship
a general-purpose Analytics fetch command.

Discover the demo impressions with `POST https://api.bitmovin.com/v1/analytics/queries/count`,
an `X-Api-Key: <SERVER_API_KEY>` header and this JSON body:

```json
{
  "licenseKey": "<DEMO_ANALYTICS_LICENSE_KEY>",
  "start": "2026-01-01T00:00:00.000Z",
  "end": "2026-01-01T00:10:00.000Z",
  "dimension": "IMPRESSION_ID",
  "groupBy": ["IMPRESSION_ID", "VIDEO_ID"],
  "filters": [
    { "name": "VIDEO_ID", "operator": "CONTAINS", "value": "player-lab-live-demo-<RUN_ID>-" },
    { "name": "CUSTOM_DATA_3", "operator": "EQ", "value": "<RUN_ID>" },
    { "name": "AD", "operator": "EQ", "value": 0 }
  ],
  "limit": 100,
  "offset": 0
}
```

Use the actual collection time range. Resolve result columns by their
`columnLabels` keys, and paginate with `offset` if more rows exist. Check all
expected impression IDs and video IDs; a successful count query alone does not
prove that every playback sample has arrived. The official
[Query request model](https://bitmovin.github.io/bitmovin-api-sdk-javascript/classes/AnalyticsQueryRequest.html)
documents the pagination fields and maximum page size.

For each selected impression, request
`POST https://api.bitmovin.com/v1/analytics/impressions/<IMPRESSION_ID>` with the
same API-key header and `{"licenseKey":"<DEMO_ANALYTICS_LICENSE_KEY>"}` as the JSON
body. Require a successful response and its `data.result` sample array. Check
`impression_id`, `video_id`, demo markers, source URL and `ad` against the expected
collection scope before projecting samples.

The raw response uses snake-case names. Map only these fields into
[`ObservedSample`](../src/observed-replay.ts):

| Raw API field | Aggregation field | Meaning |
| --- | --- | --- |
| `sequence_number` | `sequenceNumber` | Zero-based sample sequence |
| `client_time` | `clientTime` | Client timestamp in milliseconds |
| `state` | `state` | Collected playback state |
| `ad` | `ad` | `0` for content playback |
| `played` | `played` | Playback time in milliseconds |
| `seeked` | `seeked` | Time spent seeking in milliseconds |
| `videotime_start` | `videotimeStart` | Start position in the content, in milliseconds |
| `videotime_end` | `videotimeEnd` | End position in the content, in milliseconds |
| `video_duration` | `videoDuration` | Content duration in milliseconds |
| `video_id` | `videoId` | Collected video identifier |
| `m3u8_url` | `sourceUrl` | Collected HLS source URL |

`seeked` is seek latency, not the distance moved or the number of rewinds. The
[official sample field reference](https://bitmovin.github.io/bitmovin-api-sdk-php/classes/BitmovinApiSdk_Models_AnalyticsImpressionSample.html)
defines the time fields. Do not copy user, network or license metadata into the
aggregation input or the browser snapshot.

## Aggregate once and save the graph

Run the aggregation outside the browser using Node.js 24.x, version 24.19 or
later. In this example, `rawSamples` is the validated Impression Details array;
`capturedFinalSequence` is the last sequence number recorded when collection
closed. Capture that boundary separately: taking the maximum sequence returned
by the API cannot detect a missing tail.

```js
import { computeObservedReplay } from "../src/observed-replay.ts";
import { validatePrivateData } from "../src/private-data.ts";

const projectSample = row => ({
  sequenceNumber: row.sequence_number, clientTime: row.client_time,
  state: row.state, ad: row.ad, played: row.played, seeked: row.seeked,
  videotimeStart: row.videotime_start, videotimeEnd: row.videotime_end,
  videoDuration: row.video_duration, videoId: row.video_id,
  sourceUrl: row.m3u8_url,
});
const snapshot = computeObservedReplay({
  content: { id: "demo-clip", revision: "demo-v1", durationMs: 60_000 },
  period: {
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-01T00:10:00.000Z",
  },
  videoId: "player-lab-live-demo-<RUN_ID>-<SCENARIO>",
  sourceUrl: "/__private/media/master.m3u8",
  sessions: [{
    id: "demo-record-1",
    expectedLastSequence: capturedFinalSequence,
    samples: rawSamples.map(projectSample),
  }],
}, 2_000);

const pack = {
  schemaVersion: 1,
  kind: "observability-replay-demo",
  source: { hls: "/__private/media/master.m3u8" },
  profiles: [{
    id: "focused",
    title: { en: "Concentrated rewatching", ja: "見返しが集中する" },
    snapshot,
  }],
};
validatePrivateData(pack);
```

Set the duration, source, video identity and period to match the collected clip.
Group complete records by scenario and aggregate each group to add profiles;
profiles must share the content revision, duration, period and generation time.
The validator rejects missing sequence numbers, conflicting retries, mismatched
content and ambiguous backwards movements without a seek.

The tested clip produced a sample ending 5 ms past the API's `video_duration`.
An independent check also found that the final `HTMLMediaElement.duration`
exceeded the SDK's reported duration.
The following narrow rule covers that observed difference.
Optional `mediaDurationMs` is an independently measured duration rounded down to
integer milliseconds. It must be between the declared duration and 5 ms beyond
it. Only the expected final sequence in `playing` state, with positive `played`,
zero `seeked` and a start before the declared end, may reach that measured limit.
Coverage is intersected with the declared timeline; raw values remain unchanged.
Without that evidence, the declared duration is a strict bound.
See [`computeObservedReplay`](../src/observed-replay.ts) for the exact checks.

Save `JSON.stringify(pack)` outside the checkout with private file permissions.
Set `PLAYER_UI_PRIVATE_QUERY_FILE` to that file and configure the HLS directory
using [local playback](private-query-data.md#play-a-downloaded-hls-package).
Open `/?data=private`; the badge reads “Demo viewing data · Observability API”.
Both graph options and the scenario selector are enabled.

A production integration can store the aggregate in a content management system
(CMS), keyed by content revision, and serve it with the video. The browser needs
the snapshot, not an account API key or a new Analytics query for every play.
The observed snapshot has `metricVersion: "observed-replay-coverage-v1"` and
`synthetic: false`; [`validatePrivateData`](../src/private-data.ts) preserves that
origin.

### Include the API excerpt for inspection

To make the values inspectable, add an optional `evidence` field to an observed
profile. Keep the original API samples before converting their property names.
`apiFetchedAt` below is the UTC timestamp recorded when the API response arrived;
`capturedFinalSequence` still comes from the separate collection receipt.

```js
const apiFields = [
  "sequence_number", "client_time", "state", "ad", "played", "seeked",
  "videotime_start", "videotime_end", "video_duration", "video_id", "m3u8_url",
];
const evidence = {
  schemaVersion: 1,
  videoId: "player-lab-live-demo-<RUN_ID>-<SCENARIO>",
  sourceUrl: "/__private/media/master.m3u8",
  sessions: [{
    id: "demo-record-1",
    expectedLastSequence: capturedFinalSequence,
    fetchedAt: apiFetchedAt,
    response: {
      status: "SUCCESS",
      data: { result: rawSamples.map(row =>
        Object.fromEntries(apiFields.map(field => [field, row[field]]))) },
    },
  }],
};
pack.profiles[0].evidence = evidence;
validatePrivateData(pack);
```

For multiple records, include every record used by that profile's snapshot. If
aggregation used `mediaDurationMs`, include the same independently measured value
in `evidence`. Validation recomputes the graph from the excerpt and rejects a
mismatched snapshot. Do not recreate API samples from the already normalized
aggregation input. See [the evidence contract](../src/observed-evidence.ts).

The evidence stays in the external local JSON file, subject to the existing
512 KiB response limit. Graph-only integrations can continue to send the compact
snapshot without this inspection data. Opening the inspector makes no account API request.

## What the graph means

Repeated replays by one record contribute at most one record's coverage at each
position. Missing observations stay `null`; observed intervals with no replay
have replay `0`. A small sample can draw a curve, but does not establish what the
wider audience prefers.

This is a Player Lab metric. Bitmovin Dashboard's built-in Engagement graph uses
a different definition. Query API counts alone cannot reconstruct overlap within
a record; the [Query-only mode](private-query-data.md) therefore leaves replay
unavailable.

For an entirely offline fixture, [`createLiveDemoScenarios`](../tools/live-demo.ts)
authors viewing records without contacting Analytics. That separate path uses
`kind: "synthetic-live-demo"` and `synthetic: true`, and is labeled as simulated
data in the UI.
