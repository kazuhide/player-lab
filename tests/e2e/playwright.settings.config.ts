import { defineConfig } from "@playwright/test";

if (!process.env.E2E_SETTINGS_MEDIA_DIR) {
  throw new Error("Set E2E_SETTINGS_MEDIA_DIR to the generated public Pages media fixture.");
}

export default defineConfig({
  testDir: "./specs",
  testMatch: ["settings-state.spec.ts", "api-explorer.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5231",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
  },
  webServer: {
    command: "pnpm exec vite --config vite.settings.config.ts --mode pages --port 5231 --strictPort",
    url: "http://127.0.0.1:5231/settings-fixture.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
