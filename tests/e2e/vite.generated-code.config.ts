import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { defineConfig, transformWithEsbuild } from "vite";

const repository = resolve(__dirname, "../..");
const directory = resolve(process.env.GENERATED_CODE_DIR ?? "node_modules/.cache/generated-code");
const uiRequire = createRequire(resolve(repository, "packages/ui-shared/package.json"));
const mediaDirectory = process.env.E2E_GENERATED_CODE_MEDIA_DIR;
if (!mediaDirectory) throw new Error("Set E2E_GENERATED_CODE_MEDIA_DIR to the generated public media fixture.");
const media = resolve(mediaDirectory);

/** Compile recorded GUI output as a real module; never read environment files. */
export default defineConfig({
  root: resolve(repository, "apps/web"), envDir: false, envPrefix: [], publicDir: false,
  resolve: { alias: [{ find: /^bitmovin-player-ui$/, replacement: uiRequire.resolve("bitmovin-player-ui") }] },
  define: {
    "import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY": '""',
    "import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY": '""',
    "import.meta.env.VITE_VOD_SUBTITLE_VTT_URL": JSON.stringify(`http://localhost:${process.env.E2E_GENERATED_CODE_PORT ?? 5233}/generated-captions.vtt`),
  },
  plugins: [{
    name: "recorded-configuration-code",
    resolveId(id) {
      const match = /^\/generated-code\.ts\?case=([0-9a-f]{64})$/.exec(id);
      return match ? `\0recorded-code:${match[1]}.ts` : undefined;
    },
    async load(id) {
      const match = /^\0recorded-code:([0-9a-f]{64})\.ts$/.exec(id);
      return match ? transformWithEsbuild(readFileSync(resolve(directory, `${match[1]}.ts`), "utf8"), id,
        { loader: "ts", target: "es2022", tsconfigRaw: {} }) : undefined;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/media/assets/sintel_en.vtt") {
          response.setHeader("Content-Type", "text/vtt");
          response.end("WEBVTT\n\n00:00.000 --> 10:00.000\nGenerated subtitle fixture\n");
          return;
        }
        if (url.pathname.startsWith("/media/")) {
          const file = resolve(media, decodeURIComponent(url.pathname.slice(7)));
          if (!file.startsWith(media + "/")) { response.statusCode = 403; response.end(); return; }
          request.url = "/@fs/" + file + url.search;
          next();
          return;
        }
        const id = url.searchParams.get("case");
        if (url.pathname !== "/__generated__/index.html") return next();
        if (!id || !/^[0-9a-f]{64}$/.test(id)) { response.statusCode = 400; response.end(); return; }
        response.setHeader("Content-Type", "text/html");
        response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Generated code replay</title></head><body><div id="player" style="width:640px;height:360px"></div><script type="module" src="/generated-code.ts?case=${id}"></script></body></html>`);
      });
    },
  }],
  server: { host: "localhost", fs: { strict: true, allow: [repository, media] } },
});
