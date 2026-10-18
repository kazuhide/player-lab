import { defineConfig } from "vite";

// Serves index.html (which loads the player harness) for Playwright.
export default defineConfig({
  server: { port: 5174, strictPort: true },
});
