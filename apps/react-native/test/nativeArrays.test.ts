import { describe, expect, it, vi } from "vitest";
vi.mock("bitmovin-player-react-native", () => ({
  SubtitleFormat: { CEA: "cea", TTML: "ttml", VTT: "vtt", SRT: "srt" },
  AdSourceType: { BITMOVIN: "bitmovin", IMA: "ima", UNKNOWN: "unknown", PROGRESSIVE: "progressive" },
}));
import { AdSourceType, SubtitleFormat } from "bitmovin-player-react-native";
import { parseAdItems, parseSubtitleTracks } from "../src/nativeArrays";

describe("typed native arrays", () => {
  it("preserves editable ad waterfall order, position and preload values", () => {
    expect(parseAdItems([{ position: "25%", preloadOffset: "1.25", sources: [
      { tag: "https://example.com/primary", type: AdSourceType.IMA },
      { tag: "https://example.com/fallback", type: AdSourceType.IMA },
    ] }])).toEqual([{ position: "25%", preloadOffset: 1.25, sources: [
      { tag: "https://example.com/primary", type: AdSourceType.IMA },
      { tag: "https://example.com/fallback", type: AdSourceType.IMA },
    ] }]);
    expect(() => parseAdItems([{ position: "pre", preloadOffset: "NaN", sources: [{ tag: "url", type: AdSourceType.IMA }] }])).toThrow("finite number");
    expect(() => parseAdItems([{ position: "pre", preloadOffset: "", sources: [] }])).toThrow("at least one");
  });

  it("rejects duplicate subtitle identities and roles missing their required scheme", () => {
    const track = { url: "https://example.com/sub.vtt", label: "English", language: "en-us", format: SubtitleFormat.VTT, identifier: "english" };
    expect(parseSubtitleTracks([track])[0]?.language).toBe("en-US");
    expect(() => parseSubtitleTracks([track, track])).toThrow("unique");
    expect(() => parseSubtitleTracks([{ ...track, roles: [{ schemeIdUri: "" }] }])).toThrow("schemeIdUri");
  });
});
