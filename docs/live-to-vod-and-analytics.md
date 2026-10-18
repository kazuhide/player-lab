# Live-to-VOD transitions and playback measurements

Two concerns that span every app: handling a live event that finalizes into VOD, and surfacing playback QoE signals.

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

## Analytics / QoE

Two layers, so the demo both *shows* the signals and *reports* them:

1. **In-demo readout** — `apps/web/src/analytics/metrics.ts` is a pure, unit-tested
   reducer over the player's event stream that computes **startup time**,
   **rebuffering %** (+ count), **error count**, **seek time**, and **live
   latency**. It's wired in `main.ts` (`wireMetrics`) and rendered in the control
   panel. Rebuffering excludes pre-first-frame buffering (that's startup), and
   metrics reset per source.

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

## What CI verifies

The metrics reducer is unit-tested (`apps/web/test/metrics.test.ts`), and the
`AnalyticsConfig` wiring plus all the event names type-check against the real
`bitmovin-player` types in the `build` job. The dashboard view and the analytics
backend itself need a real analytics key and live traffic — verified separately with your own key and traffic.
