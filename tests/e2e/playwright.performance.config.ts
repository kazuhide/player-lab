import { defineConfig } from "@playwright/test";

// Keep performance runs separate from the functional suite: timing samples need
// an otherwise idle machine, while correctness tests can run in parallel jobs.
const PORT = 5184;

export default defineConfig({
  testDir: "./performance",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "off",
    video: "off",
  },
  webServer: {
    command: `pnpm --filter @showcase/ui-shared run build && pnpm --filter @showcase/web exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BITMOVIN_PLAYER_LICENSE_KEY: "",
      VITE_BITMOVIN_PLAYER_LICENSE_KEY: "",
      BITMOVIN_API_KEY: "",
      BITMOVIN_ANALYTICS_API_KEY: "",
      BITMOVIN_ANALYTICS_LICENSE_KEY: "",
      VITE_BITMOVIN_ANALYTICS_LICENSE_KEY: "",
    },
  },
});
