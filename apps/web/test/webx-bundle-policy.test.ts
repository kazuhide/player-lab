import { describe, expect, it } from "vitest";
import { COMPACT_COMMON_HLS, isCommonFixedHls, useCompactCommonHls } from "../src/startup/webx-bundle-policy";

const base = "https://player-lab.invalid/player-lab/web/";
const fixed = { url: `${base}media/vod-baseline/comparison-360p.m3u8`, format: "hls", custom: false } as const;

describe("known-source Web X bundle policy", () => {
  it("identifies the owned fixture independently of the compact build condition", () => {
    expect(isCommonFixedHls(fixed, base)).toBe(true);
    expect(useCompactCommonHls(fixed, base)).toBe(COMPACT_COMMON_HLS);
    const local = "http://localhost:5233/player-lab/web/";
    const source = { ...fixed, url: `${local}media/vod-baseline/comparison-360p.m3u8` };
    expect(isCommonFixedHls(source, local)).toBe(true);
    expect(useCompactCommonHls(source, local)).toBe(COMPACT_COMMON_HLS);
  });

  it("keeps custom, adaptive, DASH and non-matching URLs on their full bundles", () => {
    const sources = [
      { ...fixed, custom: true },
      { ...fixed, format: "dash" as const },
      { ...fixed, url: `${base}media/vod-baseline/master.m3u8` },
      { ...fixed, url: `${fixed.url}?token=fixture` },
      { ...fixed, url: `${fixed.url}#fixture` },
      { ...fixed, url: fixed.url.replace("player-lab.invalid", "media.invalid") },
      { ...fixed, url: fixed.url.replace("/player-lab/web/", "/other/") },
      { ...fixed, url: `${base}media/custom-ts.m3u8`, custom: true },
      { ...fixed, url: `${base}media/custom-aes.m3u8`, custom: true },
    ];
    for (const source of sources) {
      expect(isCommonFixedHls(source, base)).toBe(false);
      expect(useCompactCommonHls(source, base)).toBe(false);
    }
  });

  it("does not opt into specialization when the app base is invalid", () => {
    expect(useCompactCommonHls(fixed, "invalid base")).toBe(false);
    expect(isCommonFixedHls(fixed, "invalid base")).toBe(false);
  });
});
