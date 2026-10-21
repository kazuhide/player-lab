import { defineConfig } from "@playwright/test";
import pages from "./playwright.pages.config";

// Playwright WebKit is an engine build, not the installed Safari browser.
export default defineConfig({
  ...pages,
  testMatch: ["pages.spec.ts", "user-guide.spec.ts", "browser-regression.spec.ts"],
  use: { ...pages.use, channel: undefined, headless: process.env.E2E_HEADED !== "1", launchOptions: { timeout: 30_000 } },
  projects: [
    { name: "firefox", use: { browserName: "firefox", launchOptions: {
      timeout: 30_000,
      // The browser-owned hover button can cover application settings menus.
      // The application's own Picture-in-Picture control remains available.
      firefoxUserPrefs: { "media.videocontrols.picture-in-picture.video-toggle.enabled": false },
    } } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
