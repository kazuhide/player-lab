import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { resolveClientLicenseKey } from "./src/env/clientLicense";
import { createPagesBuildConfig } from "./src/env/pagesBuild";
import type { AnalyticsProxyConfig } from "./src/server/analyticsProxy";
import { createAnalyticsMiddleware } from "./src/server/analyticsMiddleware";

// Dev-server middleware that mounts the Bitmovin Analytics proxy at POST /api/analytics/query.
// It holds the SECRET api key server-side (read via loadEnv from a non-VITE_ var, so it is NEVER
// injected into the client bundle) and forwards queries to Bitmovin. In production this same
// `handleAnalyticsQuery` logic belongs in a serverless function / backend route; the middleware
// here makes it work under `vite` (dev + the E2E server) without a separate process.
function analyticsProxyPlugin(cfg: AnalyticsProxyConfig): Plugin {
  return {
    name: "bitmovin-analytics-proxy",
    apply: "serve", // dev-server only; static builds need their own server route
    configureServer(server) {
      server.middlewares.use("/api/analytics/query", createAnalyticsMiddleware(cfg));
    },
  };
}

// The Bitmovin Player license key is read from VITE_BITMOVIN_PLAYER_LICENSE_KEY (see .env.example).
// Allow-list this app's domain (e.g. localhost) on the license.
export default defineConfig(({ mode }) => {
  if (mode === "pages") {
    const pages = createPagesBuildConfig(process.env);
    return {
      ...pages,
      build: {
        ...pages.build,
        target: "es2021",
        chunkSizeWarningLimit: 3000,
        rollupOptions: {
          input: {
            main: fileURLToPath(new URL("./index.html", import.meta.url)),
            guide: fileURLToPath(new URL("./guide.html", import.meta.url)),
          },
        },
      },
    };
  }

  // Read env from the repo root (where the canonical .env lives — see the root .env.example) AND
  // apps/web, plus process.env (empty prefix → loadEnv includes all of process.env, so a
  // shell-exported BITMOVIN_API_KEY works in CI just like the player license does). Only VITE_
  // vars are exposed to the client bundle, so these secrets stay server-side.
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const env = { ...loadEnv(mode, repoRoot, ""), ...loadEnv(mode, process.cwd(), "") };

  // Canonical license names (repo-root .env, docs/SETUP.md) → the client-side VITE_ vars,
  // so ONE .env feeds every target. License keys are domain-locked, not secret, so
  // client-bundling them is fine. Precedence lives in resolveClientLicenseKey (unit-tested):
  // explicit VITE_ override > canonical name > "" — and process.env wins over the files,
  // so the E2E pins keep working.
  process.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY = resolveClientLicenseKey(
    env.VITE_BITMOVIN_PLAYER_LICENSE_KEY, env.BITMOVIN_PLAYER_LICENSE_KEY);
  process.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY = resolveClientLicenseKey(
    env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY, env.BITMOVIN_ANALYTICS_LICENSE_KEY);

  const analyticsCfg: AnalyticsProxyConfig = {
    // BITMOVIN_API_KEY is the repo's canonical account API key (used by the encoding scripts +
    // CLI; it's also what the Analytics Query API authenticates with). A dedicated
    // BITMOVIN_ANALYTICS_API_KEY can be set instead for a least-privilege, analytics-scoped key.
    // Deliberately NO VITE_ fallback for the secret — a VITE_ var would be bundled client-side.
    apiKey: env.BITMOVIN_ANALYTICS_API_KEY || env.BITMOVIN_API_KEY || "",
    // The license is domain-locked (not secret), so a VITE_ fallback is fine here.
    licenseKey: env.BITMOVIN_ANALYTICS_LICENSE_KEY || env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY || "",
    // Canonical org id (BITMOVIN_TENANT_ORG_ID → the X-Tenant-Org-Id header); the
    // pre-rename BITMOVIN_ANALYTICS_ORG_ID is still accepted.
    orgId: env.BITMOVIN_TENANT_ORG_ID || env.BITMOVIN_ANALYTICS_ORG_ID || "",
  };
  return {
    plugins: [analyticsProxyPlugin(analyticsCfg)],
    // The Bitmovin player is a large single dependency; raise the warning limit
    // rather than code-split a demo.
    build: {
      target: "es2021",
      chunkSizeWarningLimit: 3000,
      // Multi-page: the Web app (index) + a standalone customization guide.
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          guide: fileURLToPath(new URL("./guide.html", import.meta.url)),
        },
      },
    },
  };
});
