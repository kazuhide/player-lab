import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("public Pages media", () => {
  it("keeps all seven presets and serves every VOD feature within the public base", async () => {
    vi.stubEnv("MODE", "pages");
    vi.stubEnv("BASE_URL", "/player-lab/web/");
    vi.resetModules();
    const { SOURCES, missingSourceSettings } = await import("../src/sources");
    const source = (id: string) => SOURCES.find((source) => source.id === id)!;
    const media = "/player-lab/web/media/";
    expect(SOURCES).toHaveLength(7);
    expect(source("vod-hls").config.hls).toBe(media + "vod-baseline/master.m3u8");
    expect(source("vod-hls").config.title).toContain("Big Buck Bunny");
    expect(source("vod-dash").config.dash).toBe(media + "vod-baseline/manifest.mpd");
    expect(source("vod-sprites").config.hls).toBe(media + "vod-sprites/master.m3u8");
    expect(source("vod-sprites").config.thumbnailTrack?.url).toBe(media + "vod-sprites/thumbnails/thumbnails.vtt");
    expect(source("vod-multiaudio").config.hls).toBe(media + "vod-multiaudio/master.m3u8");
    expect(source("vod-subtitles").config.hls).toBe(media + "vod-baseline/master.m3u8");
    expect(source("vod-subtitles").config.subtitleTracks?.[0]?.url).toBe(media + "assets/sintel_en.vtt");
    expect(SOURCES.flatMap(missingSourceSettings)).toEqual([]);
  });

  it("ignores inherited account media overrides in Pages mode", async () => {
    vi.stubEnv("MODE", "pages");
    vi.stubEnv("BASE_URL", "/player-lab/web/");
    for (const name of ["VITE_LIVE_DASH_URL", "VITE_LIVE_HLS_URL", "VITE_VOD_SPRITES_HLS_URL", "VITE_VOD_SPRITES_VTT_URL", "VITE_VOD_MULTIAUDIO_HLS_URL", "VITE_VOD_SUBTITLE_VTT_URL"]) {
      vi.stubEnv(name, "https://private-canary.invalid/do-not-publish");
    }
    vi.resetModules();
    const { SOURCES } = await import("../src/sources");
    expect(JSON.stringify(SOURCES)).not.toContain("private-canary");
  });

  it("keeps explicit media overrides in ordinary development mode", async () => {
    vi.stubEnv("MODE", "development");
    vi.stubEnv("VITE_LIVE_HLS_URL", "https://media.example.test/live.m3u8");
    vi.stubEnv("VITE_VOD_SPRITES_HLS_URL", "https://media.example.test/sprites.m3u8");
    vi.resetModules();
    const { SOURCES } = await import("../src/sources");
    expect(SOURCES.find((source) => source.id === "live-hls")?.config.hls).toBe("https://media.example.test/live.m3u8");
    expect(SOURCES.find((source) => source.id === "vod-sprites")?.config.hls).toBe("https://media.example.test/sprites.m3u8");
  });
});
