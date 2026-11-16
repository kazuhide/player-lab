# Calculate the graph from Analytics data

[English](analytics-data.md) · [日本語](analytics-data.ja.md) · [Run the reference](../README.md)

The graph uses Player Lab's definitions of **Watched sections** (`reach`) and
**Rewatched sections** (`replay`). These are calculated from playback intervals;
they are not built-in Analytics metrics or a reproduction of Dashboard Engagement.
The default reference reads synthetic snapshots and makes no Analytics requests.
An optional [private local view](private-query-data.md) reads aggregate Query
counts from an external file and displays a separately labelled incidence metric.

| Data source | Watched sections | Rewatched sections |
| --- | --- | --- |
| Raw Export | Calculate the current length-weighted metric | Calculate the current metric from repeated passes |
| Query plus Impression Details | Apply the same calculation if complete raw samples are available | Apply the same calculation if pass boundaries are available |
| Aggregate Query alone | Count records touching each interval; a different metric | A count or played-time sum alone cannot establish repeated passes |

## What the values mean

A record is an Analytics impression, meaning a playback session, not a person.
For a content interval `B`, let `N` be all eligible records in the reporting
scope, including records that never reached `B`. Each eligible record has observed
content playback, excluding ads and non-playing states.

For each record, merge overlapping fragments within the same playback pass.
A backward seek starts another pass; the skipped distance is not playback.
The union of all passes gives its watched range. Positions covered by at least
two passes give its rewatched range. Count those positions only once per record,
even if they were replayed many times. Using content-position length avoids
inflating coverage merely because playback was slower. See [the calculation](../src/engagement.ts).

```text
watched(B)   = sum(length of each record's watched range inside B) / (length(B) × N)
rewatched(B) = sum(length of each record's rewatched range inside B) / (length(B) × N)
```

For the two-second interval from 20 to 22 seconds:

| Record | Observed playback | Watched length inside the interval | Rewatched length inside the interval |
| --- | --- | --- | --- |
| A | 20–22 s, then back to 21 s and play 21–22 s | 2 s | 1 s |
| B | 20–21 s | 1 s | 0 s |
| C | 0–10 s only | 0 s | 0 s |

Here `N = 3`, so watched coverage is `3 / (2 × 3) = 50%` and rewatched
coverage is `1 / (2 × 3) ≈ 16.7%`. Counting records that touched the interval
instead gives `2 / 3 ≈ 66.7%`. The difference is partial viewing: record B
contributes half an interval to the current metric, but one full record to a count.
`support` is the number of records with observed playback in the interval: two
in this example. The denominator still uses all three eligible records.

The card previews share a 0–100% scale. The video overlay rescales the selected
distribution to its own maximum. Neither display measures how exciting a scene is.
An observed interval with no repeat has replay value `0`; an unobserved interval
has `null` values. Retrieval failure must not become a measured zero.

## Use a raw Export

1. Select a stable video identity and revision, Analytics license and UTC reporting
   window. Use the same scope for both metrics and every interval.
2. Create an export with `POST /v1/analytics/exports/`. The
   [request template](examples/export-task.json) uses Parquet and an existing
   Analytics storage output. Wait for `FINISHED` and collect all output files.
3. Map the actual file schema to the fields below. Check units, state values,
   missing fields and ordering before aggregating.
4. Deduplicate by impression and sequence, reconstruct passes, then apply the
   formulas above. Conflicting duplicates or unmarked backward clocks need
   investigation rather than an invented repeat.
5. Save only validated aggregate values to the CMS. Publish a completed batch
   atomically; keep individual histories and account API keys on the server.

The Export API supports CSV and Parquet and splits the result into hourly files.
The example leaves `columns` unset so it does not accidentally omit sequence or
state information. See [Exporting your Data](https://developer.bitmovin.com/playback/docs/exporting-your-data).

| Required information | Normalized demo field | Why it is needed |
| --- | --- | --- |
| Video identity and duration | `videoId`, `videoDuration` | Match the exact content revision and timeline |
| Playback record and packet order | `impressionId`, `sequenceNumber`, `time` | Reconstruct and deduplicate each record |
| Content positions | `videotimeStart`, `videotimeEnd` | Clip playback to each interval in milliseconds |
| Played duration and state | `played`, `state` | Exclude pauses, buffering and seeks; retain seek evidence |
| Advertising flag | `ad` | Exclude client-side and server-side ads |

These are normalized field names, not a promise about CSV column spelling.
The public [Analytics fields](https://developer.bitmovin.com/playback/docs/analytics-api-fields)
and [impression sample model](https://bitmovin.github.io/bitmovin-api-sdk-php/classes/BitmovinApiSdk_Models_AnalyticsImpressionSample.html)
describe the underlying data. A real-file adapter must verify its input schema.
The demo's `DemoExport` is a synthetic fixture wrapper, not an Export response.

## Use Query and raw impression details

This avoids creating an Export task. Query selects the playback records; raw
details supply their intervals. The aggregation still runs on your server.

1. Send the [ID query](examples/query-impression-ids.json) to
   `POST /v1/analytics/queries/count`. It groups by `IMPRESSION_ID` and orders IDs
   ascending within the same eligible population used above.
2. Page with `limit: 200` and increasing `offset` until a short or empty page.
   Collect and deduplicate IDs; do not add the per-ID count values as a substitute
   for collecting IDs. Read row positions from `columnLabels`.
3. For each ID, call `POST /v1/analytics/impressions/{impression_id}` with the
   [license body](examples/impression-details.json). Normalize the returned raw
   samples and verify that sequence, state and content positions are present.
4. Restrict samples to the agreed reporting scope and run the same pass/interval
   calculation as for Export. Recompute `N` from records with valid content playback;
   the ID query selects candidates and does not replace raw-data validation.
   Use the same population and completeness rules.

The [Count reference](https://developer.bitmovin.com/playback/reference/postanalyticsqueriescount)
documents `limit` and `offset`; the
[Impression Details reference](https://developer.bitmovin.com/playback/reference/showimpressiondetails)
documents the raw-detail REST route. Use that REST route rather than assuming a
detail convenience method exists in every API SDK version.

Keep paused, seeking and ad samples during retrieval, even though they do not
contribute watched length. Filtering raw samples to `PLAYED > 0` too early can
remove the evidence needed to separate passes. The ID query's filter only selects
the eligible record population; it is not a filter for the later raw sample set.

## Use aggregate Query alone

For a lightweight watched-distribution alternative, use
`POST /v1/analytics/queries/count` with `dimension: "IMPRESSION_ID"`:

- [Population query](examples/query-population.json): eligible records for the
  whole content, with `VIDEO_ID`, `PLAYED > 0` and `AD = 0` filters.
- [Interval query](examples/query-watched-overlap.json): the same request with
  overlap conditions for `[20000, 22000)` milliseconds:

```json
[
  { "name": "VIDEOTIME_START", "operator": "LT", "value": 22000 },
  { "name": "VIDEOTIME_END", "operator": "GT", "value": 20000 }
]
```

Divide the interval count by the common population count. Label the result
**share of playback records touching the interval**, not length-weighted watched
coverage. Requiring both sample endpoints to fall inside the interval would miss
samples crossing its boundaries. Query's `interval: "MINUTE"` groups collection
time; it does not create content-position buckets. See the
[Query model](https://github.com/bitmovin/bitmovin-api-sdk-javascript/blob/f7a36bc3e7b399bed003fe9374a8f865d556cd07/src/models/AnalyticsQueryRequest.ts).

Use the impression count without rendition grouping. A record that changes
quality may appear in several rendition groups, so adding their counts can count
it more than once. `SUM(PLAYED)` measures played time, including repeats, and does
not implement per-record interval unions or the repeat cap. Official examples
distinguish [impression counts and played time](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1).

### Why not calculate replay from Query counts?

Two overlapping sample packets may be fragments of one pass, not a repeat.
A repeat count therefore needs ordered passes, not just sample counts, total
played time or the number of impressions reaching a position.

Fetching ordered tuples through Query was also considered. In authenticated
schema checks on 2026-11-16, Query rejected grouping by `SEQUENCE_NUMBER` and
`STATE`. Even `SEQUENCE_NUMBER` appearing in the public
[attribute enum](https://github.com/bitmovin/bitmovin-api-sdk-javascript/blob/f7a36bc3e7b399bed003fe9374a8f865d556cd07/src/models/AnalyticsAttribute.ts)
does not establish that it is accepted for grouping. This route is not a working
replacement for raw Export or impression details. `SEEKED` is a seek duration,
not a pass identifier or a substitute for the original state sequence.

Do not fill the missing replay metric with zero. The synthetic snapshot validator
requires both metrics for observed intervals and accepts only the demo metric
version. The [private Query view](private-query-data.md) uses a separate validator
and `watched-impression-incidence-v1` contract, with replay explicitly unavailable.

## Operate the batch safely

Run these requests from a backend or batch job with `X-Api-Key`; the request
body's `licenseKey` is the Analytics license, not the account API key. The JSON
files contain placeholders. Replace them in a private copy outside the repository.

Use a fixed reporting window, deterministic ordering and bounded concurrency.
Process one complete impression at a time, cache by content revision and period,
and reuse the published CMS snapshot during playback. This avoids a raw-detail
request for every viewer and bounds memory. Export is preferable for bulk history;
Query plus details is useful for smaller, filtered or incremental batches.

The required event detail is retained for 30 or 90 days depending on the plan.
A compressed session summary cannot reconstruct repeat passes. Check
[data retention](https://developer.bitmovin.com/playback/docs/data-aging-in-bitmovin-analytics)
before choosing the window. Missing pages, aged-out samples or a clipped session
must remain incomplete; do not publish them as a complete no-rewatch result.

The synthetic processor deliberately rejects real data. Do not mark an account
export as `synthetic: true` to bypass that guard. The private view validates only
precomputed aggregate Query counts; it does not normalize raw Export files or
Impression Details. Those adapters and production data delivery still need to be
implemented for your application. See [precomputing and CMS integration](../README.md#prepare-data-before-playback).
