import { describe, expect, it } from "vitest";
import { SOURCES, missingSourceSettings, nextPlaylistSource, type ShowcaseSource } from "../src/sources";

const feature = (id: string): ShowcaseSource => structuredClone(SOURCES.find((source) => source.id === id)!);
const playlist = ["vod-hls", "vod-dash", "vod-multiaudio", "vod-subtitles"];

describe("optional demo assets", () => {
  it("keeps all seven presets and identifies the exact missing sprite settings", () => {
    expect(SOURCES).toHaveLength(7);
    const source = feature("vod-sprites");
    source.config.hls = "";
    source.config.thumbnailTrack = { url: "" };
    expect(missingSourceSettings(source)).toEqual(["VITE_VOD_SPRITES_HLS_URL", "VITE_VOD_SPRITES_VTT_URL"]);
    source.config.hls = "https://media.example.test/master.m3u8";
    expect(missingSourceSettings(source)).toEqual(["VITE_VOD_SPRITES_VTT_URL"]);
    source.config.thumbnailTrack.url = "https://media.example.test/thumbnails.vtt";
    expect(missingSourceSettings(source)).toEqual([]);
  });
  it("requires subtitle media even though the public video URL exists", () => {
    const source = feature("vod-subtitles");
    source.config.subtitleTracks = [{ id: "sub-en", lang: "en", label: "English", kind: "subtitle", url: "" }];
    expect(missingSourceSettings(source)).toEqual(["VITE_VOD_SUBTITLE_VTT_URL"]);
    source.config.subtitleTracks![0]!.url = "https://media.example.test/subtitles.vtt";
    expect(missingSourceSettings(source)).toEqual([]);
  });
  it("wraps between configured references rather than loading an empty optional episode", () => {
    const sources = SOURCES.map((source) => structuredClone(source));
    const multi = sources.find((source) => source.id === "vod-multiaudio")!;
    multi.config.hls = "";
    sources.find((source) => source.id === "vod-subtitles")!.config.subtitleTracks![0]!.url = "";
    expect(nextPlaylistSource(sources, playlist, "vod-dash")?.id).toBe("vod-hls");
    multi.config.hls = "https://media.example.test/multi.m3u8";
    expect(nextPlaylistSource(sources, playlist, "vod-dash")?.id).toBe("vod-multiaudio");
  });
  it("does not return an unavailable or unknown episode", () => {
    const multi = feature("vod-multiaudio");
    multi.config.hls = "";
    expect(nextPlaylistSource([multi], [multi.id, "missing"], "elsewhere")).toBeUndefined();
    expect(nextPlaylistSource(SOURCES, [], "vod-hls")).toBeUndefined();
  });
});
