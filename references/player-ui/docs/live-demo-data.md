# Simulated live rewatching

This demo pairs an HLS clip with fictional viewing records for a live broadcast.
The audience shares a virtual broadcast clock: viewers join at different times,
rewind, watch an earlier section again, and return to the advancing live position.
The clip remains on-demand media.

## Viewing scenarios

| Scenario | Assumption | Expected graph |
| --- | --- | --- |
| Concentrated rewatching | Viewers return to the same moments | Localized peaks |
| Distributed rewatching | Viewers return to different moments | Lower peaks across a wider area |
| A small audience | A few viewing records include rewinds | Visible replay with a small sample count |

The generator creates playback records and computes their coverage with the same
[aggregation code](../src/engagement.ts) as the other synthetic examples. The
records and their identifiers are generated for this demo.
A rewind contributes only where playback before and after it overlaps.
Repeated passes by one record cannot count as additional viewers.

Rewatching is selected initially. The small previews share a 0–100% scale; the
overlay expands its highest value to make the shape visible. Changing the
scenario updates the graph while the video keeps playing.

## Prepare a local demo pack

From this application's directory, use Node.js 24.19 or later in the supported
24.x series. Adjust the duration to match the clip and save the output outside
the checkout:

```sh
node --input-type=module <<'NODE'
import { writeFile } from "node:fs/promises";
import { createLiveDemoScenarios } from "./tools/live-demo.ts";

const content = { id: "live-demo-window", revision: "demo-v1", durationMs: 60_000 };
const period = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-01-01T00:10:00.000Z",
};
const profiles = createLiveDemoScenarios(content, period)
  .map(({ id, title, snapshot }) => ({ id, title, snapshot }));
const pack = {
  schemaVersion: 1,
  kind: "synthetic-live-demo",
  source: { hls: "/__private/media/master.m3u8" },
  profiles,
};
await writeFile("/absolute/private/path/live-demo.json", JSON.stringify(pack), { mode: 0o600 });
NODE
```

Set `PLAYER_UI_PRIVATE_QUERY_FILE` to that file and configure the downloaded HLS
directory as described in [local playback](private-query-data.md#play-a-downloaded-hls-package).
Open `/?data=private`. The data badge identifies the simulated live scenario;
both graph options and the scenario selector are available.

## Inspect demo playback in Bitmovin Dashboard

Use a dedicated development Analytics license for generated playback. A separate
Player instance can collect its ordinary play, pause and seek events with:

```ts
analytics: {
  key: "<DEMO_ANALYTICS_LICENSE_KEY>",
  config: { cookiesEnabled: false },
  videoId: "player-lab-live-demo-<RUN_ID>",
  title: "Player Lab simulated live demo",
  customData1: "synthetic-live-demo",
  customData2: "live-focused",
  customData3: "<RUN_ID>",
}
```

In Dashboard, select that license and the collection time range, then filter
by the video ID or demo marker. Session details expose the collected playback
and seek records. Player Lab's custom rewatch curve is computed from those
sample intervals; the built-in Engagement graph has its own definition.

The JSON pack above is an offline fixture, not an Analytics import request.
The reference app keeps collection disabled by default. See the official
[collector configuration](https://developer.bitmovin.com/playback/docs/configuration-analytics)
and [development license setup](https://developer.bitmovin.com/playback/docs/setup-analytics).
