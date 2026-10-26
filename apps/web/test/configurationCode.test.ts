import { describe, expect, it } from "vitest";
import { configurationCode, javascriptValue } from "../src/configurationCode";

describe("configuration code", () => {
  it("redacts copied URL credentials and sensitive string values while preserving ordinary data", () => {
    const source = { hls: "https://user:pass@example.test/master.m3u8?token=private-token&quality=hd", headers: { "X-Session": "private-header" }, title: "Ordinary source" };
    const copied = javascriptValue(source);
    for (const secret of ["user:pass", "private-token", "private-header"]) expect(copied).not.toContain(secret);
    expect(copied).toContain("quality=hd"); expect(copied).toContain("Ordinary source");
    expect(source.headers["X-Session"]).toBe("private-header");
    expect(source.hls).toContain("private-token");
    expect(javascriptValue("https://example.test/master.m3u8?quality=hd")).toBe('"https://example.test/master.m3u8?quality=hd"');
  });
  it("omits both license values even if a caller supplies an SDK config", () => {
    const code = configurationCode({
      player: { key: "DO_NOT_EXPORT_PLAYER_LICENSE", analytics: { key: "DO_NOT_EXPORT_ANALYTICS_LICENSE" }, playback: { autoplay: false } },
      source: { hls: "https://example.com/video.m3u8", title: 'A title with "quotes" and <markup>', drm: { value: "DO_NOT_EXPORT_DRM_CONFIG" }, options: { startOffset: 4, privateSetting: "DO_NOT_EXPORT_OPTION" } },
      ui: { enableSeekPreview: true }, runtime: ["player.setVolume(37);"],
    });
    expect(code).toContain("YOUR_PLAYER_KEY");
    expect(code).not.toContain("DO_NOT_EXPORT");
    expect(code).not.toContain('"analytics"');
    expect(code).toContain('"autoplay": false');
    expect(code).toContain("player.setVolume(37);");
  });

  it("preserves data strings and infinite SDK limits in the copied expression", () => {
    const original = { title: '"; throw new Error("must stay data"); //\n\\${notInterpolation}', limits: [Infinity, -Infinity, 0], nested: { omitted: undefined, value: true } };
    const readBack = Function(`"use strict"; return (${javascriptValue(original)});`)();
    expect(readBack).toEqual({ ...original, nested: { value: true } });
  });

  it("rejects invalid numeric data rather than silently exporting null", () => {
    expect(() => javascriptValue({ limit: Number.NaN })).toThrow("NaN");
  });

  it("retains sideloaded subtitle tracks from the applied source", () => {
    const code = configurationCode({ player: {}, ui: {}, runtime: [], source: {
      hls: "https://example.com/movie.m3u8",
      subtitleTracks: [{ id: "en", lang: "en", label: "English", url: "https://example.com/captions.vtt" }],
    } });
    expect(code).toContain('"subtitleTracks"');
    expect(code).toContain("https://example.com/captions.vtt");
  });
});
