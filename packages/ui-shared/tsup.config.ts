import { defineConfig } from "tsup";

export default defineConfig([
  // ESM for the web app (M3); the app provides the player and UI library.
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2021",
    external: ["bitmovin-player", "bitmovin-player-ui"],
  },
  // Self-contained WebView bundle (M4–M6): bundles bitmovin-player-ui, leaves the
  // player to the host page, and emits dist/bitmovinplayer-ui.js. Intentionally no
  // `dts` — this bundle is consumed by name in a host page, not imported as a module.
  {
    entry: { "bitmovinplayer-ui": "src/global.ts" },
    format: ["iife"],
    globalName: "ShowcaseDvrUI",
    sourcemap: true,
    target: "es2021",
    external: ["bitmovin-player"],
    noExternal: ["bitmovin-player-ui"],
    outExtension() {
      return { js: ".js" };
    },
  },
]);
