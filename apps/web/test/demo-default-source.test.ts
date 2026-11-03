import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDemoSource } from "../src/startup/demo-default-source";
import { parseDemoSource } from "../src/startup/demo-contract";

afterEach(() => vi.unstubAllGlobals());

describe("shared default comparison source", () => {
  it("uses the fixed 360p HLS fixture for startup and seeking under the deployed app base", () => {
    expect(defaultDemoSource("https://player-lab.invalid/player-lab/web/", false)).toEqual({
      url: "https://player-lab.invalid/player-lab/web/media/vod-baseline/comparison-360p.m3u8",
      format: "hls", custom: false, label: "Big Buck Bunny",
    });
  });

  it("uses the adaptive master only for the network scenario", () => {
    const base = "https://player-lab.invalid/player-lab/web/";
    const startup = defaultDemoSource(base, false);
    const network = defaultDemoSource(base, true);
    expect(network.url).toBe("https://player-lab.invalid/player-lab/web/media/vod-baseline/master.m3u8");
    expect({ ...network, url: startup.url }).toEqual(startup);
    expect(defaultDemoSource(base, false)).toEqual(startup);
  });

  it.each(["http://localhost:5173/", "http://localhost:5233/player-lab/web/"])(
    "keeps development origins and app subpaths for %s", (base) => {
      for (const network of [false, true]) {
        const source = defaultDemoSource(base, network);
        const playlist = network ? "master.m3u8" : "comparison-360p.m3u8";
        expect(source.url).toBe(`${base}media/vod-baseline/${playlist}`);
        expect(parseDemoSource(source, base)).toEqual(source);
      }
    },
  );

  it("selects the source synchronously without fetching or preloading either playlist", () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected preload"); });
    vi.stubGlobal("fetch", fetch);
    const base = "https://player-lab.invalid/player-lab/web/";
    expect(defaultDemoSource(base, false).url).toContain("comparison-360p.m3u8");
    expect(defaultDemoSource(base, true).url).toContain("master.m3u8");
    expect(fetch).not.toHaveBeenCalled();
  });
});
