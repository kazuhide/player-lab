import type { UserConfig } from "vite";

/** Build public client values without reading local configuration or VITE overrides. */
export function createPagesBuildConfig(env: Readonly<Record<string, string | undefined>>): UserConfig {
  return {
    base: "/player-lab/web/",
    // https://vite.dev/config/shared-options.html#envdir
    envDir: false,
    envPrefix: [],
    publicDir: false,
    plugins: [],
    // Explicit replacements are the complete public environment allowlist.
    // https://vite.dev/config/shared-options.html#envprefix
    define: {
      "import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY": JSON.stringify(env.PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY ?? ""),
      "import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY": JSON.stringify(env.PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY ?? ""),
    },
    build: { sourcemap: false },
  };
}
