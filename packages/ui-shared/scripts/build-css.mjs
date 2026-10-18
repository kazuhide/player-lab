// Build dist/bitmovinplayer-ui.css = the base bitmovin-player-ui CSS followed by
// our DVR additions, so WebView apps can load a single stylesheet.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as sass from "sass";

const require = createRequire(import.meta.url);
const basePath = require.resolve("bitmovin-player-ui/dist/css/bitmovinplayer-ui.css");
// Strip the upstream `sourceMappingURL` comment — we don't ship the .map, and the
// dangling reference makes Vite log a noisy "failed to load source map" error.
const base = readFileSync(basePath, "utf8").replace(/\/\*#\s*sourceMappingURL=[^*]*\*\//g, "");
const custom = sass.compile("src/styles/ui-shared.scss", { style: "compressed" }).css;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/bitmovinplayer-ui.css", `${base}\n${custom}\n`);
console.log("Wrote dist/bitmovinplayer-ui.css");
