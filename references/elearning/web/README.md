# Learning playback for Web

[English](README.md) · [日本語](README.ja.md) · [Reference setup](../README.md)

This player uses Bitmovin Player Web 8.284.0 and UI 4.23.1. It reads the same catalog, stable video IDs and media as the native reference. English and Japanese follow the browser language.

## Run locally

Generate the media and start this reference's publisher as described in the [reference setup](../README.md). Its default catalog is at `http://127.0.0.1:8621/catalog.json`. In this directory, use Node.js 24.19 or newer:

```sh
npm ci
cp .env.example .env.local
```

Set `VITE_PUBLIC_PLAYER_LICENSE_KEY` to a Player license that allows `localhost`. Set `VITE_MEDIA_BASE_URL` to the publisher directory if it differs from the default. To collect playback quality data, set `VITE_PUBLIC_ANALYTICS_LICENSE_KEY` to a demo collector license. These values are visible to the browser. Account API keys belong in the separate Analytics dashboard server.

```sh
npm run dev
```

Open `http://localhost:5181`. Restart the server after editing the environment. For static hosting, run `npm run build` and serve `dist/` on an allowed hostname. Build with a publisher URL reachable by your viewers. HTTPS pages require an HTTPS media origin with CORS enabled.

## Playback

If the catalog contains multiple courses, choose a course. Switching learners restores that learner’s last course in the current page session. Reloading the page selects the first course. Its lesson order applies to both manual navigation and automatic continuation. Choose learner A or B, a delivery format, and whether to play subsequent lessons automatically. Opening a saved lesson offers **Resume** and **Start over**. Resume checks the saved position against the loaded media duration before seeking. The browser stores checkpoints, speed, caption selection, UI mode and the sequencing setting locally under a learner/lesson key. Your choice of automatic continuation when you start or resume the lesson applies to this run. Hiding the page during loading cancels automatic playback. Each save has a fresh local revision. Closing an older paused tab or finishing a lesson in the background preserves another tab’s newer save, even at the same position. Pressing Play, Resume or Start over claims the bookmark at that action, including while media is buffering. An IndexedDB transaction serializes updates across tabs. Existing local bookmarks remain readable. If the browser blocks storage, playback continues with a notice that progress cannot be saved. Switching learner ends playback and clears the in-memory preferences and diagnostic list.

Choose **Learning** to use the external controls, including 10-second jumps. The course and searchable English/Japanese transcript remain available in either mode. Selecting a cue seeks to the original cue start even with captions off. **Follow current line** scrolls the transcript as the active line changes. A search suspends automatic scrolling. Browsing the results with touch, a scroll wheel or the keyboard turns following off until you select it again. HLS can use the catalog's manifest subtitles or external tracks. DASH uses external tracks. Use **Return to course** to change delivery or sequencing.

Switching controls preserves the SDK player, source, caption renderer and Analytics session. The custom controls offer picture in picture where supported by the SDK, fullscreen where the browser supports it and an AirPlay picker when the SDK reports availability. Diagnostics list up to 30 local SDK events with asset IDs and numeric error codes.

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
