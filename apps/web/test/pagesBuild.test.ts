import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPagesBuildConfig } from "../src/env/pagesBuild";
import viteConfig from "../vite.config";

const loadEnv = vi.hoisted(() => vi.fn<() => Record<string, string>>(() => {
  throw new Error("The Pages profile must not load environment files.");
}));

vi.mock("vite", () => ({
  defineConfig: (config: unknown) => config,
  loadEnv,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  loadEnv.mockClear();
  loadEnv.mockImplementation(() => {
    throw new Error("The Pages profile must not load environment files.");
  });
});

describe("isolated Pages build", () => {
  it("disables automatic environment exposure and unrelated public files", () => {
    const config = createPagesBuildConfig({});

    expect(config.base).toBe("/player-lab/web/");
    expect(config.envDir).toBe(false);
    expect(config.envPrefix).toEqual([]);
    expect(config.publicDir).toBe(false);
    expect(config.plugins).toEqual([]);
    expect(config.build?.sourcemap).toBe(false);
  });

  it("exposes only the explicitly selected public Player and Analytics licenses", () => {
    const config = createPagesBuildConfig({
      PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY: "fake-public-player-key",
      PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY: "fake-public-analytics-key",
      BITMOVIN_PLAYER_LICENSE_KEY: "fake-canonical-player-canary",
      BITMOVIN_ANALYTICS_LICENSE_KEY: "fake-canonical-analytics-canary",
      BITMOVIN_API_KEY: "fake-account-api-canary",
      VITE_BITMOVIN_PLAYER_LICENSE_KEY: "fake-vite-player-canary",
      VITE_BITMOVIN_ANALYTICS_LICENSE_KEY: "fake-vite-analytics-canary",
      VITE_LIVE_HLS_URL: "https://example.invalid/unselected-live-canary.m3u8",
      VITE_UNEXPECTED_VALUE: "fake-unexpected-vite-canary",
    });

    expect(config.define).toEqual({
      "import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY": JSON.stringify("fake-public-player-key"),
      "import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY": JSON.stringify("fake-public-analytics-key"),
    });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("canary");
  });

  it("does not fall back to canonical names or inherited VITE values", () => {
    const config = createPagesBuildConfig({
      BITMOVIN_PLAYER_LICENSE_KEY: "fake-canonical-player-canary",
      BITMOVIN_ANALYTICS_LICENSE_KEY: "fake-canonical-analytics-canary",
      VITE_BITMOVIN_PLAYER_LICENSE_KEY: "fake-vite-player-canary",
      VITE_BITMOVIN_ANALYTICS_LICENSE_KEY: "fake-vite-analytics-canary",
    });

    expect(config.define).toEqual({
      "import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY": JSON.stringify(""),
      "import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY": JSON.stringify(""),
    });
  });

  it.each([
    ["PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY", "VITE_BITMOVIN_PLAYER_LICENSE_KEY"],
    ["PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY", "VITE_BITMOVIN_ANALYTICS_LICENSE_KEY"],
  ])("keeps an explicitly empty %s empty", (publicName, clientName) => {
    const config = createPagesBuildConfig({
      [publicName]: "",
      BITMOVIN_PLAYER_LICENSE_KEY: "fake-canonical-player-canary",
      BITMOVIN_ANALYTICS_LICENSE_KEY: "fake-canonical-analytics-canary",
    });

    expect(config.define?.[`import.meta.env.${clientName}`]).toBe(JSON.stringify(""));
  });

  it.each([
    ["PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY", "VITE_BITMOVIN_PLAYER_LICENSE_KEY"],
    ["PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY", "VITE_BITMOVIN_ANALYTICS_LICENSE_KEY"],
  ])("encodes %s as a string replacement", (publicName, clientName) => {
    const value = 'fake-public-"quoted"-value\nnot-a-real-key';
    const config = createPagesBuildConfig({ [publicName]: value });

    expect(JSON.parse(config.define?.[`import.meta.env.${clientName}`])).toBe(value);
  });

  it("selects Pages before loadEnv without rewriting inherited client values", async () => {
    vi.stubEnv("PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY", "fake-explicit-public-key");
    vi.stubEnv("PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY", "fake-explicit-analytics-key");
    vi.stubEnv("BITMOVIN_PLAYER_LICENSE_KEY", "fake-canonical-player-canary");
    vi.stubEnv("VITE_BITMOVIN_PLAYER_LICENSE_KEY", "fake-vite-player-canary");
    vi.stubEnv("VITE_BITMOVIN_ANALYTICS_LICENSE_KEY", "fake-vite-analytics-canary");

    const config = await viteConfig({ command: "build", mode: "pages" });

    expect(loadEnv).not.toHaveBeenCalled();
    expect(config.define?.["import.meta.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY"])
      .toBe(JSON.stringify("fake-explicit-public-key"));
    expect(config.define?.["import.meta.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY"])
      .toBe(JSON.stringify("fake-explicit-analytics-key"));
    expect(process.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY).toBe("fake-vite-player-canary");
    expect(process.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY).toBe("fake-vite-analytics-canary");
  });

  it("retains the application and guide entries and existing build target", async () => {
    vi.stubEnv("PLAYER_LAB_PUBLIC_PLAYER_LICENSE_KEY", "");
    vi.stubEnv("PLAYER_LAB_PUBLIC_ANALYTICS_LICENSE_KEY", "");

    const config = await viteConfig({ command: "build", mode: "pages" });

    expect(config.build).toMatchObject({
      target: "es2021",
      chunkSizeWarningLimit: 3000,
      sourcemap: false,
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("../index.html", import.meta.url)),
          guide: fileURLToPath(new URL("../guide.html", import.meta.url)),
        },
      },
    });
    expect(config.plugins).toEqual([
      expect.objectContaining({ name: "player-lab-product-build", transformIndexHtml: expect.any(Function) }),
    ]);
  });

  it("preserves canonical license mapping and the proxy outside Pages mode", async () => {
    vi.stubEnv("VITE_BITMOVIN_PLAYER_LICENSE_KEY", "fake-prior-player-value");
    vi.stubEnv("VITE_BITMOVIN_ANALYTICS_LICENSE_KEY", "fake-prior-analytics-value");
    loadEnv.mockReturnValue({
      BITMOVIN_PLAYER_LICENSE_KEY: "fake-normal-player-key",
      BITMOVIN_ANALYTICS_LICENSE_KEY: "fake-normal-analytics-key",
    });

    const config = await viteConfig({ command: "serve", mode: "development" });

    expect(loadEnv).toHaveBeenCalledTimes(2);
    expect(process.env.VITE_BITMOVIN_PLAYER_LICENSE_KEY).toBe("fake-normal-player-key");
    expect(process.env.VITE_BITMOVIN_ANALYTICS_LICENSE_KEY).toBe("fake-normal-analytics-key");
    expect(config.base).toBeUndefined();
    expect(config.envDir).toBeUndefined();
    expect(config.define).toBeUndefined();
    expect(config.plugins).toEqual([
      expect.objectContaining({ name: "player-lab-product-build", transformIndexHtml: expect.any(Function) }),
      expect.objectContaining({ name: "bitmovin-analytics-proxy", apply: "serve" }),
    ]);
  });
});
