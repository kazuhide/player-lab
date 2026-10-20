import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(resolve("scripts/write-runtime-config.cjs"));
const fs = require("node:fs") as typeof import("node:fs");
const { writeRuntimeConfig } = require("../scripts/write-runtime-config.cjs") as {
  writeRuntimeConfig: (destination: string, environment: Record<string, string>, withoutCredentials?: boolean) => void;
};
const directories: string[] = [];
function destination(): string {
  const directory = mkdtempSync(join(tmpdir(), "player-lab-vega-config-"));
  directories.push(directory);
  return join(directory, "runtime.local.json");
}
afterEach(() => {
  vi.restoreAllMocks();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

it("writes only selected runtime keys atomically with private file permissions", () => {
  const path = destination();
  writeRuntimeConfig(path, {
    BITMOVIN_PLAYER_LICENSE_KEY: "SYNTHETIC_PLAYER_KEY",
    BITMOVIN_ANALYTICS_LICENSE_KEY: "SYNTHETIC_ANALYTICS_KEY",
    UNRELATED_SECRET: "SYNTHETIC_UNRELATED_VALUE",
  });
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ playerKey: "SYNTHETIC_PLAYER_KEY", analyticsKey: "SYNTHETIC_ANALYTICS_KEY" });
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(directories[0]!)).toEqual(["runtime.local.json"]);
  writeRuntimeConfig(path, {}, true);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ playerKey: "", analyticsKey: "" });
});

it("does not overwrite or remove an existing temporary file", () => {
  const path = destination();
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, "existing");
  expect(() => writeRuntimeConfig(path, {}, true)).toThrow();
  expect(readFileSync(temporary, "utf8")).toBe("existing");
});

it("removes its own temporary file after a partial write failure and preserves the applied configuration", () => {
  const path = destination();
  writeFileSync(path, "previous configuration");
  const originalWrite = fs.writeFileSync;
  vi.spyOn(fs, "writeFileSync").mockImplementationOnce((file, _contents, options) => {
    originalWrite(file, "SYNTHETIC_PARTIAL_KEY", options);
    throw Object.assign(new Error("Injected write failure"), { code: "ENOSPC" });
  });
  expect(() => writeRuntimeConfig(path, { BITMOVIN_PLAYER_LICENSE_KEY: "SYNTHETIC_PLAYER_KEY" })).toThrow("Injected write failure");
  expect(readFileSync(path, "utf8")).toBe("previous configuration");
  expect(readdirSync(directories[0]!)).toEqual(["runtime.local.json"]);
});

it("sets runtime keys before evaluating the existing App and registers its component", () => {
  const App = () => null;
  const registrations: [string, () => unknown][] = [];
  const context: Record<string, unknown> = {};
  context.require = (name: string) => {
    if (name === "./runtime.local.json") return { playerKey: "SYNTHETIC_PLAYER_KEY", analyticsKey: "" };
    if (name === "react-native") return { AppRegistry: { registerComponent: (name: string, component: () => unknown) => registrations.push([name, component]) } };
    if (name === "./app.json") return { name: "com.showcase.dvr.vega.main" };
    if (name === "./src/App") {
      expect(context.BITMOVIN_PLAYER_LICENSE_KEY).toBe("SYNTHETIC_PLAYER_KEY");
      expect(context.BITMOVIN_ANALYTICS_LICENSE_KEY).toBe("");
      return { App };
    }
    throw new Error("Unexpected entry import");
  };
  runInNewContext(readFileSync(resolve("index.js"), "utf8"), context);
  expect(registrations[0]?.[0]).toBe("com.showcase.dvr.vega.main");
  expect(registrations[0]?.[1]()).toBe(App);
});
