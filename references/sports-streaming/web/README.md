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

Choose an event and open its live source, a prepared clip, or a ready archive. **Sports** controls provide 15-second jumps and a DVR slider. Returning from a clip offers the latest live point and, when a source-bound UTC position was available, the saved DVR position. The player rechecks the DVR window on the new live source before seeking. A clip that finishes while the event is live returns to the live edge.

Event and archive status are separate. Ending an event leaves its live/DVR source in place. Once an archive is ready, use **Continue in archive** to map the current media UTC to a relative offset. The continuous archive uses the current event's mapping. An edited archive uses its validated retained intervals. An unknown time, removed interval or archive end requires a separate choice. **Automatically continue in the archive** opts in to a mapped handoff to the event's main archive when the event ends. The handoff checks the loaded archive's seekable range and retains the current play/pause intent. After automatic retries stop, **Refresh status** requests another update.

Switching controls preserves the SDK player, source, caption renderer and Analytics session. The custom controls offer fullscreen where the browser supports it and an AirPlay picker when the SDK reports availability. Diagnostics list up to 30 local SDK events with asset IDs and numeric error codes.

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
