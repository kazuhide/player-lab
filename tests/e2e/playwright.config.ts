import { defineConfig } from "@playwright/test";

const PORT = 5174; // harness page (tests/e2e) — most specs use the ui:false harness
const APP_PORT = 5175; // the real apps/web app — for the UI / theme-selector spec

// The app now DEFAULTS to a reliable live source (the BBC R&D testcard — see
// apps/web/src/sources.ts), so the app webServer needs no override and the app-ui
// tests exercise the REAL default the user sees (the previous override masked the
// fact that the old default, livesim2, returns HTTP 429 under load). The harness
// live-dvr spec still references DASH-IF livesim2 (REFERENCE.liveDashDvr300), which
// rate-limits, so point IT at the same testcard via E2E_LIVE_DASH_URL (read in Node;
// type=dynamic, 15-min window satisfies its assertions).
const E2E_LIVE_DASH_URL = "https://vs-dash-ww-rd-live.akamaized.net/pl/testcard2020/avc-full.mpd";
process.env.E2E_LIVE_DASH_URL ??= E2E_LIVE_DASH_URL;

// Uses the system Chrome (channel: "chrome") so no Playwright browser download is
// needed. The player needs a license keyed to the origin — localhost is allowed by
// default — injected into the dev servers via the VITE_*_LICENSE_KEY vars.
export default defineConfig({
  testDir: "./specs",
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
    channel: "chrome",
    headless: true,
  },
  webServer: [
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
      },
    },
  ],
});
