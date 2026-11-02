import { describe, expect, it } from "vitest";
import { parseDemoSource } from "../src/startup/demo-contract";
describe("custom playback source boundary", () => {
  const base = "https://player-lab.invalid/web/comparison.html";
  const fields = { format: "hls", label: "Custom HLS", custom: true };
  it("accepts explicit HLS/DASH HTTPS resources and same-origin development HTTP", () => {
    expect(parseDemoSource({ ...fields, url: "https://media.invalid/asset?sig=private" }, base).url).toBe("https://media.invalid/asset?sig=private");
    expect(parseDemoSource({ ...fields, format: "dash", url: "https://media.invalid/manifest" }, base).format).toBe("dash");
    expect(parseDemoSource({ ...fields, url: "media/demo.m3u8" }, "http://localhost:5000/comparison.html").url).toBe("http://localhost:5000/media/demo.m3u8");
  });
  it("rejects credential-bearing, fragment, non-network and mixed-content input without echoing it", () => {
    for (const url of ["https://name:private@media.invalid/a", "https://media.invalid/a#private", "javascript:private", "data:private", "file:///private", "http://media.invalid/private"]) {
      expect(() => parseDemoSource({ ...fields, url }, base)).toThrow(/^configuration-rejected$/);
    }
    expect(() => parseDemoSource({ ...fields, url: "https://media.invalid", format: "other" }, base)).toThrow("configuration-rejected");
    expect(() => parseDemoSource({ ...fields, url: "https://media.invalid", extra: "private" }, base)).toThrow("configuration-rejected");
  });
});
