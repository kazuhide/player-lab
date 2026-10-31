# From lesson playback to Analytics

[English](analytics.md) · [日本語](analytics.ja.md)

Use this sequence to find a lesson's playback data in Bitmovin Dashboard and in
this reference's local quality dashboard. The Android collector sends playback
events; the local server queries the collected data. For a preview without an
account or Android build, open the [key-free demo](../analytics-dashboard/README.md#demo-data).

## Configure Android

Follow [Configure and run Android](../README.md#configure-and-run-android) to
prepare the media, create `android/.env`, build and install the application.
Configure the keys according to their purpose:

| Setting | Where it is used | Purpose |
| --- | --- | --- |
| `BITMOVIN_PLAYER_LICENSE_KEY` | `android/.env` | Authorizes Player playback for `com.playerlab.elearning`. |
| `BITMOVIN_ANALYTICS_LICENSE_KEY` | `android/.env` and `analytics-dashboard/.env` | Enables Android data collection and selects the same license's data for local queries. |
| `BITMOVIN_API_KEY` | `analytics-dashboard/.env` only | Authorizes server-side Analytics queries in the account that owns that Analytics license. |

Allow `com.playerlab.elearning` on the Player license and the Analytics license.
Analytics licenses are under **Observability → Licenses** in Bitmovin Dashboard;
see the [official license setup](https://developer.bitmovin.com/playback/docs/setup-analytics).
Use licenses intended for this sample. Android packages its Player and Analytics
licenses in the application; account API keys belong only on the local server.

The two `.env` files are independent. The Android build does not load the
analytics server's file, and the server does not load Android's file. Rebuild and
reinstall Android after changing its keys; restart the local server after
changing its settings. Android can play without Analytics, so successful
playback alone does not establish that collection is enabled.

Android resolves each setting in this order: Gradle property, `android/local.properties`,
process environment, `android/.env`, then its default. The Gradle/local-property
names are `bitmovinLicenseKey` for `BITMOVIN_PLAYER_LICENSE_KEY` and
`bitmovinAnalyticsLicenseKey` for `BITMOVIN_ANALYTICS_LICENSE_KEY`. For the Node server, inherited
`BITMOVIN_API_KEY` and `BITMOVIN_ANALYTICS_LICENSE_KEY` take precedence over
`analytics-dashboard/.env`. If editing a file has no effect, remove or align the
higher-priority setting before rebuilding or restarting. Restarting the server
alone does not clear an exported value. Check where overrides are set without
printing their values.

## Play a known lesson

Open the course and choose **Number-line basics**, then confirm that video frames
and the playback position advance before pausing. Note when you played it.
Browsing the course alone does not start a playback session.

<img src="screenshots/learning-ui-en.png" width="300" alt="Number-line lesson playing with the learning controls and transcript">

The bundled [catalog](../fixtures/catalog.json) and
[dashboard configuration](../analytics-dashboard/config.mjs) use these identities:

| Lesson | Analytics `VIDEO_ID` |
| --- | --- |
| Number-line basics | `EDU-FX-01` |
| Number-line exercises | `EDU-FX-02` |
| Summary | `EDU-FX-03` |

HLS and DASH share each lesson's ID. The playback-entry field is separate:
opening or resuming a lesson uses `CUSTOM_DATA_1 = catalog`; next/previous lesson
navigation, including automatic advancement, uses `playlist`. It does not
identify learner A or B. The local dashboard's entry filter selects this field.

## Find the playback in Bitmovin Dashboard

1. Open [Bitmovin Dashboard](https://dashboard.bitmovin.com/analytics) with access
   to the account that owns your Analytics license.
2. Select the same Analytics license configured in Android. Choose a period that
   includes the playback you noted.
3. Filter to Android and Video ID `EDU-FX-01`. Inspect plays, startup time and
   rebuffering for that selection.

Keep the time zone in mind when comparing screens. The local dashboard displays
and accepts custom times in coordinated universal time (UTC). For example,
12:00 in Japan is 03:00 UTC. The local **Last 24 hours** preset ends at the start
of the current minute. Newly collected events may take time to appear; a fetch
time is when a response arrived, not the latest playback event's time.

The [official metric definitions](https://developer.bitmovin.com/playback/docs/analytics-dashboard-metrics-reference)
explain what Dashboard measures. The local dashboard documents its
[query definitions](../analytics-dashboard/README.md#available-data), so compare
matching metrics, licenses, periods and filters.

## Fetch the same data locally

Follow the dashboard's [measured-data setup](../analytics-dashboard/README.md#measured-data)
to create `analytics-dashboard/.env`, set the account API key and the same
Analytics license, and start the server. The file and startup commands are
listed there. The account API key needs permission to query Analytics.

On the development computer, open `http://127.0.0.1:9051/#measured`. Select
**Last 24 hours**, **Number line basics**, and **All** playback entries, then
select **Fetch data**. Opening the screen or changing a filter does not query
Analytics. Select **Fetch data** again to retrieve new results.

The server restricts measured queries to Android and the lesson IDs in its
configuration. It does not query all videos in the account or create playback
events. The **Demo data** screen uses fictional sessions and does not contribute
to your account's measurements. For the first comparison, keep the entry filter
at **All**, then narrow it to the way you opened the lesson.

## When results are missing

| What you see | What to check |
| --- | --- |
| Android cannot play | Confirm the Player key, the package allowlist and media reachability using the [Android setup](../README.md#configure-and-run-android). Rebuild and reinstall after configuration changes. |
| Playback works, but Dashboard has no data | Confirm that Android's Analytics key is set and its license allows this package. Check that the device can reach the collection service, then inspect the app's [diagnostics](../README.md#try-the-learning-flow). |
| Dashboard has data, but local fetch is unavailable | Check `analytics-dashboard/.env`, its account API key and Analytics key, then restart that server. Android's `.env` does not configure it. |
| Local fetch succeeds but shows no data | Match the Analytics license, period and Video ID. Start with **All** playback entries. Custom lesson IDs outside the dashboard configuration are excluded. |
| Only recent playback is missing | Wait for ingestion and for the selected period to include that playback, then fetch again. The server does not turn uncollected data into zero. |
| Fetch fails or only some results arrive | Read the displayed query status. Check API access and connectivity. For partial results or a timeout, try a shorter period and fetch again; if rate limited, wait until the displayed retry time. A retained successful result is marked as an earlier result. |

A valid zero, missing data and a failed query are different states. The
[dashboard guide](../analytics-dashboard/README.md) describes their display and
the server's query limits.
