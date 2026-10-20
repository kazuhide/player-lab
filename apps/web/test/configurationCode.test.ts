import { describe, expect, it } from "vitest";
import { configurationCode, javascriptValue } from "../src/configurationCode";

describe("configuration code", () => {
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
});
