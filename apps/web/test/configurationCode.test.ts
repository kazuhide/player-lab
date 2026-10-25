import { describe, expect, it } from "vitest";
import { configurationCode, javascriptValue } from "../src/configurationCode";
import { generatedCodeDiagnostics } from "./generatedCodeCompiler";

describe("configuration code", () => {
  it("typechecks the exact emitted module and rejects invalid settings against the pinned SDK", () => {
    const snapshot = { player: { playback: { autoplay: false, muted: true }, logs: { level: "warn" },
      tweaks: { log_level: "error" }, network: { requestApi: "xhr" },
      adaptation: { desktop: { logic: "v3", rttEstimationMethod: "weightedaverage" }, mobile: { logic: "wish", rttEstimationMethod: "median" } } }, source: {
      progressive: "https://example.com/movie.mp4", options: { startOffset: 3, startOffsetTimelineReference: "start" },
      subtitleTracks: [{ id: "en", lang: "en", label: "English", url: "https://example.com/captions.vtt", kind: "subtitle" }],
    }, ui: { seekbarSnappingEnabled: true }, runtime: ["player.setVolume(37);", "player.setPlaybackSpeed(1.25);", "player.mute();"] };
    const code = configurationCode(snapshot);
    expect(generatedCodeDiagnostics(code)).toEqual([]);
    expect(generatedCodeDiagnostics(configurationCode({ ...snapshot, player: { playback: { autoplay: "invalid" } } }))).not.toEqual([]);
    expect(generatedCodeDiagnostics(configurationCode({ ...snapshot, source: { subtitleTracks: [{ url: 42 }] } }))).not.toEqual([]);
    expect(generatedCodeDiagnostics(configurationCode({ ...snapshot, ui: { seekbarSnappingEnabled: "invalid" } }))).not.toEqual([]);
    expect(generatedCodeDiagnostics(configurationCode({ ...snapshot, runtime: ['player.setPlaybackSpeed("invalid");'] }))).not.toEqual([]);
    expect(code).not.toMatch(/\bas (?:PlayerConfig|SourceConfig|UIConfig)\b/);
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
