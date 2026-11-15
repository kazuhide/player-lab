import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  timeout: 30_000,
  globalTimeout: 240_000,
  forbidOnly: true,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:17199",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-en", use: { locale: "en-US", viewport: { width: 1280, height: 900 } } },
    { name: "mobile-ja", use: { ...devices["Pixel 7"], locale: "ja-JP", viewport: { width: 320, height: 820 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: "npm run dev -- --port 17199",
    url: "http://localhost:17199",
    reuseExistingServer: false,
    timeout: 20_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 2000 },
  },
});
