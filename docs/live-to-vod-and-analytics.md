# Live-to-VOD transitions and playback measurements

Two concerns that span every app: handling a live event that finalizes into
video on demand (VOD), and surfacing playback quality of experience (QoE).

## Live → VOD

When a live event ends and the manifest finalizes, the stream becomes VOD. Every
app classifies this the same way, from one shared rule implemented per language:

> `isLiveStream(snapshot)` → a **finite, positive** duration means VOD; `Infinity`,
> `0`, or `NaN` means live. `detectLiveToVod(prev, next)` fires once, on the
> transition.

This is unit-tested in all five DVR modules (`apps/web` & `apps/vega` `src/dvr`,
`apps/react-native` `src/dvr`, iOS `DvrKit`, Android `:dvr`). What differs is only
the **trigger** that re-evaluates the snapshot:

| App | Trigger | Note |
| --- | --- | --- |
| Web | `DurationChanged` (≥ v8.19.0) | duration starts `Infinity`; don't trust `isLive()` alone |
| Vega | `DurationChanged` (modular web player) | same as web — `DvrController` re-evaluates |
| iOS / tvOS | poll on `TimeChanged` | `DurationChanged` can be missing on AVPlayer |
| Android | `SourceEvent.DurationChanged` (or poll) | event exists on v3 |
| React Native | poll on `onTimeChanged` | **no `onDurationChanged` event** at all |

So three apps get an event and two (iOS, RN) poll — but all feed the same
`detectLiveToVod`, and on the transition the UI swaps from live mode (DVR seek bar,
"behind live" label) to VOD mode (plain seek bar).

### Run a controlled Web finalization check

Generate the [local 60-second media](../encoding/test-streams/README.md), then run:

```sh
E2E_FINALIZATION_MEDIA_DIR="$PWD/.cache/test-streams/vod-baseline" \
  pnpm --filter @showcase/e2e e2e:finalization
```

The check uses the existing app, a real Player instance, and real media bytes.
A loopback server first advertises the clip as live, then finalizes the same
manifest URL. It adds HLS's [end-of-playlist signal](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.3.4)
or changes DASH from a dynamic to a finite static presentation, following the
[DASH-IF live-to-VOD guidance](https://dashif.org/DASH-IF-IOP/live2vod/).
This isolates manifest finalization without starting a live encoder or using
account credentials. It does not test a production ingest pipeline.

Both cases exercise the DVR setting's player recreation, rewind, the finite
duration and VOD UI after finalization, and seeking within the finished clip.
They also check that finalization keeps the same Player and source without a
new `SourceLoaded` event. The optional suite is separate from public-reference
tests and requires the local fixture directory. Its server uses port 5192;
override `E2E_FINALIZATION_PORT` if that port is in use.

An event carrying wall-clock timestamps can retain those timestamps after its
duration becomes finite. The SDK's [`getCurrentTime`](https://cdn.bitmovin.com/player/web/8/docs/interfaces/core.playerapi.html)
defaults to absolute time. Compare a VOD seek position on the explicitly relative
timeline; a Unix timestamp and an offset within the clip are different values.
The app already displays both timelines separately, and this check compares
relative positions while using the finite duration to classify the finished event.

## Analytics / QoE

Two layers, so the demo both *shows* the signals and *reports* them:

1. **In-demo readout** — `apps/web/src/analytics/metrics.ts` is a pure, unit-tested
   reducer over the player's event stream that computes **startup time**,
   **rebuffering %** (+ count), **error count**, **seek time**, and **live
   latency**. It's wired in `main.ts` (`wireMetrics`) and rendered in the control
   panel. Rebuffering excludes pre-first-frame buffering (that's startup), and
   metrics reset per source.

   Here, startup runs from the SDK's `SourceLoaded` event to its first `Playing`
   event. Work before `SourceLoaded` is outside this local measurement.

   The local rebuffering percentage is stall time divided by playing time plus
   stall time, after the first frame. Paused time and startup buffering are
   excluded. A snapshot includes elapsed time in the current phase without
   changing the stored totals, so repeatedly refreshing it does not count time
   twice. Playback finishing freezes the final totals; unloading clears them
   before the next source. These local measurements are not the same aggregation
   or session definition as the Analytics dashboard.

2. **Bitmovin Analytics** — every app enables its bundled analytics collector
   when `BITMOVIN_ANALYTICS_LICENSE_KEY` (repo-root `.env`, docs/SETUP.md) is
   set: web/Vega via `config.analytics = { key }`, iOS via
   `PlayerFactory.createPlayer(playerConfig:analytics:.enabled(...))`, Android via
   `AnalyticsPlayerConfig.Enabled(AnalyticsConfig(licenseKey))`, RN via
   `analyticsConfig: { licenseKey }`. This reports the same class of signals —
   video startup time, rebuffer %, error %, seek time, live latency, plus bitrate
   and player startup — to the Bitmovin Analytics dashboard. Empty key = collector
   stays off everywhere.

A real-time monitoring view with threshold alerts is available as a reference app:
`bitmovin/analytics-live-monitoring-dashboard` (enter an API key → live metrics).

## Analytics query errors

The query panel calls the local development server at `POST /api/analytics/query`.
Its body must be a JSON object; `null`, arrays, primitive values, and malformed
JSON return HTTP 400 before an upstream request is made. Missing server
configuration returns 503, connection failures return 502, and unexpected server
errors return a controlled 500 response. Upstream 401/403 statuses remain visible
to help identify rejected credentials. Error responses omit raw exception and
upstream bodies because those can contain server credentials.

The proxy is a development-server integration. A static build needs its own
server route before the query panel can contact Analytics. The server-side API
key must never be put in a `VITE_*` variable or sent to the browser.

## What CI verifies

The metrics reducer is unit-tested (`apps/web/test/metrics.test.ts`), and the
`AnalyticsConfig` wiring plus all the event names type-check against the real
`bitmovin-player` types in the `build` job. The dashboard view and the analytics
backend itself need a real analytics key and live traffic; verify those separately
with your own key and traffic. The proxy's HTTP tests listen only on a temporary
loopback port and mock upstream fetches. Their success does not establish that
an account query or Analytics collection worked.
