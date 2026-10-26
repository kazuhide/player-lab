import { expect, it } from "vitest";
import { configurationCode, uiConfigurationCode } from "../src/api/code";
import { FactoryInput } from "../src/api/types";
import { generatedCodeDiagnostics } from "./generatedCodeCompiler";
import ts from "typescript";

it("typechecks complete UI expressions against real component and localization declarations", () => {
  const prelude = 'import * as PlayerUI from "bitmovin-player-ui";\n'
    + 'import { EventDispatcher } from "bitmovin-player-ui/dist/js/framework/EventDispatcher";\n'
    + 'const uiConfig: PlayerUI.UIConfig = ';
  const input = { seekbarSnappingEnabled: true, localization: { language: "en" },
    componentConfigOverrides: { CloseButton: { target: new FactoryInput("Label", [{ text: "Close" }]) } } };
  expect(generatedCodeDiagnostics(prelude + uiConfigurationCode(input) + ";")).toEqual([]);
  expect(generatedCodeDiagnostics(prelude + uiConfigurationCode({ seekbarSnappingEnabled: "invalid" }) + ";")).not.toEqual([]);
});

it("exports nested edits that preserve unedited array entries in the user's base configuration", () => {
  const entries = [{ path: ["metadata", "markers", 2, "title"], value: "Third marker" }];
  const code = configurationCode("UIConfig", entries);
  const body = code.split("// Apply these edits to your existing base configuration.\n")[1]!;
  const config = { metadata: { markers: [{ title: "First" }, { title: "Second" }, { title: "Third" }] } };
  new Function("uiConfig", "PlayerUI", body)(config, { i18n: { setConfig() {} } });
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

it("omits an unset optional container in the exported SDK configuration", () => {
  const code = configurationCode("PlayerConfig", [{ path: ["playback"], value: undefined }]);
  const config = { playback: { autoplay: true } };
  new Function("playerConfig", code.split("// Apply these edits to your existing base configuration.\n")[1]!)(config);
  expect(config).toStrictEqual({});
});

it.each(["complete", "patch"])("configures localization before eager component constructors in the %s UI export", mode => {
  const order: string[] = [];
  let current: unknown;
  class Dispatcher { constructor() { order.push("dispatcher"); } }
  class Label { constructor() { order.push("label"); expect(current).toBeInstanceOf(Dispatcher); } }
  const PlayerUI = { Label, i18n: { setConfig(config: { events?: { onLanguageChanged?: unknown } }) {
    order.push("localization"); current = config.events?.onLanguageChanged;
  } } };
  const input = {
    componentConfigOverrides: { CloseButton: { target: new FactoryInput("Label", []) } },
    localization: { events: { onLanguageChanged: new FactoryInput("EventDispatcher", []) } },
  };
  let config: typeof input;
  if (mode === "complete") config = new Function("PlayerUI", "EventDispatcher", ts.transpile("return " + uiConfigurationCode(input)))(PlayerUI, Dispatcher);
  else {
    config = {} as typeof input;
    const code = configurationCode("UIConfig", Object.entries(input).map(([name, value]) => ({ path: [name], value })));
    new Function("uiConfig", "PlayerUI", "EventDispatcher", code.split("// Apply these edits to your existing base configuration.\n")[1]!)(config, PlayerUI, Dispatcher);
  }
  expect(order).toEqual(["dispatcher", "localization", "label"]);
  expect(config.localization.events.onLanguageChanged).toBe(current);
});
