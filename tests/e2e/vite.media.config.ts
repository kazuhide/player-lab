import { defineConfig } from "vite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Serve generated fixtures only. Do not expose the repository or personal files.
export default defineConfig({
  appType: "mpa",
  cacheDir: mkdtempSync(join(tmpdir(), "player-lab-media-vite-")),
  server: {
    host: "127.0.0.1",
    cors: { origin: /^http:\/\/localhost:\d+$/ },
    fs: { strict: true, allow: ["."] },
  },
});
