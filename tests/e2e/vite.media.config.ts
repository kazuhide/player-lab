import { defineConfig } from "vite";

// Serve generated fixtures only. Do not expose the repository or personal files.
export default defineConfig({
  appType: "mpa",
  server: {
    host: "127.0.0.1",
    cors: { origin: /^http:\/\/localhost:\d+$/ },
    fs: { strict: true, allow: ["."] },
  },
});
