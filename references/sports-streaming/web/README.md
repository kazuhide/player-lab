# Sports playback for Web

[English](README.md) · [日本語](README.ja.md) · [Reference setup](../README.md)

This player uses Bitmovin Player Web 8.284.0 and UI 4.23.1. It reads the same catalog, stable video IDs and media as the native reference. English and Japanese follow the browser language.

## Run locally

Generate the media and start this reference's publisher as described in the [reference setup](../README.md). Its default catalog is at `http://127.0.0.1:8622/catalog.json`. In this directory, use Node.js 24.19 or newer:

```sh
npm ci
cp .env.example .env.local
```

Set `VITE_PUBLIC_PLAYER_LICENSE_KEY` to a Player license that allows `localhost`. Set `VITE_MEDIA_BASE_URL` to the publisher directory if it differs from the default. To collect playback quality data, set `VITE_PUBLIC_ANALYTICS_LICENSE_KEY` to a demo collector license. These values are visible to the browser. Account API keys belong in the separate Analytics dashboard server.

```sh
npm run dev
```

Open `http://localhost:5182`. Restart the server after editing the environment. For static hosting, run `npm run build` and serve `dist/` on an allowed hostname. Build with a publisher URL reachable by your viewers. HTTPS pages require an HTTPS media origin with CORS enabled.

## Playback

The fixture status response includes `publisherStartedAtUs`, the publisher process start time in Unix microseconds. After a publisher restart, refresh uses the new run and discards the previous DVR checkpoint. Older publishers are ordered by `observedAt`.

Choose an event and open its live source, a prepared clip, or a ready archive. **Sports** controls provide 15-second jumps and a DVR slider. Returning from a clip offers the latest live point and, when a source-bound UTC position was available, the saved DVR position. The saved-position action appears only while the most recent publisher update includes that point in the DVR window. Before leaving the clip, the app refreshes the window again. Overlapping status reads use the publisher’s observation times and DVR bounds to determine which window is current. The new live source then checks its SDK seek window before seeking. A clip that finishes while the event is live returns to the live edge.

Changing HLS/DASH on an open video reloads that asset at the VOD offset or verified live UTC and preserves play/pause intent. For the fixture's single, zero-based DASH period, the app anchors the decoded segment timestamp to the matching MPD and catalog UTC origin. If the asset or browser does not support the requested format, the current source stays open. After an event ends, the SDK’s segment timeline identifies the retained media. Native HLS uses the active video element’s program date and seekable ranges. If the target position cannot be verified, playback waits for an explicit choice. A finished archive opens paused for replay when switching formats.

Event and archive status are separate. Ending an event leaves its live/DVR source in place. Once an archive is ready, use **Continue in archive** to map the current media UTC to a relative offset. The continuous archive uses the current event's mapping. An edited archive uses its validated retained intervals. An unknown time, removed interval or archive end requires a separate choice. **Automatically continue in the archive** opts in to a mapped handoff to the selected archive when the event ends. The event's main archive is selected initially. The handoff checks the loaded archive's seekable range and retains the current play/pause intent. After automatic retries stop, **Refresh status** requests another update.

Switching controls preserves the SDK player, source, caption renderer and Analytics session. The custom controls offer fullscreen where the browser supports it and an AirPlay picker when the SDK reports availability. Picture in picture is available when supported by the SDK. Diagnostics list up to 30 local SDK events with asset IDs and numeric error codes.

**Diagnostics → Download handoff records** exports the last 200 local live-to-archive requests using the same local JSON format as the Android and Apple apps. A paused handoff needs a decoded frame at the requested target. A playing handoff also needs a later clock reading showing playback advanced. A manual seek or a change of playback route ends observation. Unobserved outcomes remain unconfirmed. After the archive seek succeeds, Retry restores the latest observed archive position and play/pause state, even while handoff confirmation is pending. These records stay in memory until you download them or close the page. They contain no playback URLs, receiver QoE measurements or Analytics custom data.

## Verify

```sh
npm test
npm run build
```

With Google Chrome installed, generated media available and the licensed app running locally, run the browser tests:

```sh
FORMAT=hls npm run test:browser
FORMAT=dash npm run test:browser
```

To exercise native HLS on macOS, install the Playwright WebKit browser (`npx playwright install webkit`) and run `BROWSER=webkit FORMAT=hls npm run test:browser`. Set `APP_URL` when testing another local Web app port.

For the paused DVR return and automatic archive continuation test, start a fresh
short event, let at least 10 seconds accumulate, then run
`RUN_LIVE=1 FORMAT=hls npm run test:browser`. The test waits for the event to
end and its main archive to become ready. The long-event test also checks a round trip between HLS and DASH and an unverified DASH clock. During a return to a saved live point
the app briefly decodes muted behind its loading screen to read the new SDK
clock. To verify delivery changes, handoff evidence and decoder-error recovery after the short event has ended, run `RUN_FINALIZED=1 npm run test:browser` against the fixture with its default 60-second DVR window. Run the same check with `BROWSER=webkit RUN_FINALIZED=1` to exercise native HLS positioning. On a live return, the player pauses, checks the requested offset, and verifies the resulting
media time before restoring the original play/pause intent.
