import { defineConfig } from "@playwright/test";
import existing from "./playwright.config";

const mediaPort = Number(process.env.E2E_FINALIZATION_PORT ?? 5192);
if (!Number.isInteger(mediaPort) || mediaPort < 1024 || mediaPort > 65535) {
  throw new Error("E2E_FINALIZATION_PORT must be an integer from 1024 to 65535.");
}
const servers = Array.isArray(existing.webServer) ? existing.webServer : [];
const origin = `http://localhost:${mediaPort}`;
const appOrigin = `http://localhost:${process.env.E2E_APP_PORT ?? 5175}`;

export default defineConfig({
  ...existing,
  testDir: "./finalization",
  testMatch: "live-finalization.spec.ts",
  retries: 0,
  webServer: servers.map((server) => server.url === appOrigin ? {
    ...server,
    env: {
      ...server.env,
      VITE_LIVE_HLS_URL: `${origin}/master.m3u8`,
      VITE_LIVE_DASH_URL: `${origin}/manifest.mpd`,
    },
  } : server),
});
