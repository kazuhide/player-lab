import { describe, expect, it } from "vitest";
import { deepMerge } from "../src/configState";

describe("configuration overrides", () => {
  it("removes a cleared override without losing sibling values", () => {
    const applied = { playback: { audioLanguage: "en", autoplay: false }, tweaks: { max_retries: 4 } };
    const reset = deepMerge(applied, { playback: { audioLanguage: undefined } });
    expect(reset).toEqual({ playback: { autoplay: false }, tweaks: { max_retries: 4 } });
    expect(applied.playback.audioLanguage).toBe("en");
  });

  it("removes desktop and mobile adaptation overrides when default is selected", () => {
    const applied = { adaptation: { desktop: { logic: "v2", preload: true }, mobile: { logic: "v2" } } };
    expect(deepMerge(applied, { adaptation: { desktop: { logic: undefined }, mobile: { logic: undefined } } }))
      .toEqual({ adaptation: { desktop: { preload: true } } });
  });

  it("restores the source preset after clearing an applied source override", () => {
    const preset = { hls: "https://media.example.test/master.m3u8", title: "Preset title", options: { startOffset: -10 } };
    const applied = { title: "Edited title", options: { startOffset: -20, startOffsetTimelineReference: "end" } };
    const reset = deepMerge(applied, { title: undefined, options: { startOffset: undefined } });
    expect(deepMerge(preset, reset)).toEqual({
      hls: preset.hls, title: "Preset title", options: { startOffset: -10, startOffsetTimelineReference: "end" },
    });
  });

  it("replaces arrays and does not merge into prototype keys", () => {
    const patch = JSON.parse('{"subtitleTracks":[{"id":"new"}],"__proto__":{"polluted":true}}');
    const merged = deepMerge({ subtitleTracks: [{ id: "old" }] }, patch);
    expect(merged.subtitleTracks).toEqual([{ id: "new" }]);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });
});
