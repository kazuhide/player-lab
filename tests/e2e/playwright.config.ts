import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

function testPort(name: string, fallback: number): number {
  const port = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer port between 1024 and 65535.`);
  }
  return port;
}

const PORT = testPort("E2E_HARNESS_PORT", 5174);
const APP_PORT = testPort("E2E_APP_PORT", 5175);
if (PORT === APP_PORT) throw new Error("The harness and application need distinct ports.");

const MEDIA_PORT = testPort("E2E_MEDIA_PORT", 5180);
const repositoryRoot = resolve(__dirname, "../..");
const mediaDirectory = process.env.E2E_MEDIA_DIR
  ? resolve(repositoryRoot, process.env.E2E_MEDIA_DIR) : undefined;
if (mediaDirectory && [PORT, APP_PORT].includes(MEDIA_PORT)) {
  throw new Error("The media server needs a separate port.");
}
const localBase = `http://localhost:${MEDIA_PORT}`;
if (mediaDirectory) process.env.VITE_TEST_STREAM_BASE_URL = localBase;
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

// The harness live-DVR spec needs a real moving rewind window. The app keeps
// its own public VOD default, so GUI checks exercise its normal initial source.
const E2E_LIVE_DASH_URL = "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd";
process.env.E2E_LIVE_DASH_URL ??= E2E_LIVE_DASH_URL;

// Local runs use installed Chrome. CI selects its pinned Playwright Chromium.
// The Web player needs no key at localhost; other origins need an allowed license.
export default defineConfig({
  testDir: "./specs",
  testIgnore: ["pages.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // These specs hit public third-party live streams (BBC R&D testcard, Unified Streaming), which
  // occasionally fail to start within a poll window — a transient environmental flake, not an app
  // bug (a real regression fails all attempts). Retry to keep the suite stable; the first attempt
  // usually passes, so there's no cost in the common case.
  retries: 2,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  },
  webServer: [
    ...(mediaDirectory ? [{
      command: `pnpm exec vite ${quote(mediaDirectory)} --config ${quote(resolve(__dirname, "vite.media.config.ts"))} --port ${MEDIA_PORT} --strictPort`,
      url: `${localBase}/fixture-report.json`,
      reuseExistingServer: false,
      timeout: 60_000,
    }] : []),
    {
      command: `pnpm exec vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_E2E_PLAYER_LICENSE_KEY: process.env.BITMOVIN_PLAYER_LICENSE_KEY ?? "" },
    },
    {
      // The real app (apps/web). Build the shared UI first (what `dev`'s predev step
      // does), then run vite directly: `run dev -- --port` leaks an extra `--` to vite,
      // which then ignores the flag and binds the default 5173 — hanging this webServer
      // forever on ${APP_PORT}. (The harness server above already uses `exec vite`.)
      command: `pnpm --filter @showcase/ui-shared run build && pnpm --filter @showcase/web exec vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      // This budget now covers the ui-shared build (tsup + sass) plus vite boot, since
      // they're chained in one command — keep it generous for a cold first run.
      timeout: 120_000,
      // No VITE_LIVE_DASH_URL override — the app's own default is reliable now, so the
      // app-ui specs test what the user actually loads.
      // Force the Analytics query proxy UNCONFIGURED (empty overrides any shell/.env value, since
      // Vite's loadEnv lets process.env win) so the analytics spec deterministically tests the
      // "not configured" UX — the success path needs a real key + network the CI can't guarantee.
      env: {
        VITE_BITMOVIN_PLAYER_LICENSE_KEY: process.env.BITMOVIN_PLAYER_LICENSE_KEY ?? "",
        BITMOVIN_API_KEY: "",
        BITMOVIN_ANALYTICS_API_KEY: "",
        // Also pin the analytics COLLECTOR off (canonical + VITE_ names — vite.config maps
        // the canonical name into the client), so E2E runs don't report to the dashboard.
        BITMOVIN_ANALYTICS_LICENSE_KEY: "",
        VITE_BITMOVIN_ANALYTICS_LICENSE_KEY: "",
        ...(mediaDirectory ? {
          VITE_VOD_SPRITES_HLS_URL: `${localBase}/vod-sprites/master.m3u8`,
          VITE_VOD_SPRITES_VTT_URL: `${localBase}/vod-sprites/thumbnails/thumbnails.vtt`,
          VITE_VOD_MULTIAUDIO_HLS_URL: `${localBase}/vod-multiaudio/master.m3u8`,
          VITE_VOD_SUBTITLE_VTT_URL: `${localBase}/assets/sintel_en.vtt`,
        } : {}),
      },
    },
  ],
});
