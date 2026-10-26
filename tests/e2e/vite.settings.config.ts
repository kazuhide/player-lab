import { defineConfig } from "vite";
import { resolve } from "node:path";
import { createPagesBuildConfig } from "../../apps/web/src/env/pagesBuild";

const root = resolve(__dirname, "../../apps/web");
const fixture = resolve(__dirname, "src/settings-fixture.ts");
const pages = createPagesBuildConfig({});
const media = process.env.E2E_SETTINGS_MEDIA_DIR ? resolve(process.env.E2E_SETTINGS_MEDIA_DIR) : undefined;

export default defineConfig({
  root,
  base: "/",
  envDir: false,
  envPrefix: [],
  publicDir: false,
  define: pages.define ?? {},
  plugins: [{
    name: "settings-test-fixture",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (media && url.pathname.startsWith("/media/")) {
          const file = resolve(media, decodeURIComponent(url.pathname.slice(7)));
          if (!file.startsWith(media + "/")) { response.statusCode = 403; response.end(); return; }
          request.url = "/@fs/" + file + url.search;
        }
        next();
      });
      server.middlewares.use("/settings-fixture.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`<html><body><div id="config"></div><div id="explorer"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`);
      });
    },
  }],
  server: { host: "127.0.0.1", fs: { allow: [resolve(__dirname, "../.."), ...media ? [media] : []] } },
});
