import { expect, it } from "vitest";
import { configurationCode } from "../src/api/code";

it("exports nested edits that preserve unedited array entries in the user's base configuration", () => {
  const entries = [{ path: ["metadata", "markers", 2, "title"], value: "Third marker" }];
  const code = configurationCode("UIConfig", entries);
  const body = code.split("// Apply these edits to your existing base configuration.\n")[1]!;
  const config = { metadata: { markers: [{ title: "First" }, { title: "Second" }, { title: "Third" }] } };
  new Function("uiConfig", body)(config);
  expect(config.metadata.markers.map(marker => marker.title)).toEqual(["First", "Second", "Third marker"]);
});

it("exports missing nested containers and keeps false, zero and redacted credential values", () => {
  const code = configurationCode("PlayerConfig", [
    { path: ["playback", "autoplay"], value: false }, { path: ["playback", "volume"], value: 0 },
    { path: ["key"], value: "never-export-this-value" },
  ]);
  const config: Record<string, unknown> = {};
  new Function("playerConfig", code.split("// Apply these edits to your existing base configuration.\n")[1]!)(config);
  expect(config).toEqual({ playback: { autoplay: false, volume: 0 }, key: "YOUR_VALUE" });
  expect(code).not.toContain("never-export-this-value");
});

it("exports a containing object edit without discarding unedited base fields", () => {
  const code = configurationCode("PlayerConfig", [{ path: ["playback"], value: { autoplay: false, preferredTech: [{ player: "html5", streaming: "hls" }] } }]);
  const config = { playback: { muted: true, autoplay: true, preferredTech: [{ player: "native", streaming: "hls" }] } };
  new Function("playerConfig", code.split("// Apply these edits to your existing base configuration.\n")[1]!)(config);
  expect(config).toEqual({ playback: { muted: true, autoplay: false, preferredTech: [{ player: "html5", streaming: "hls" }] } });
});
