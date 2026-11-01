import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { SDK_VERSIONS } from "../src/startup/contract";

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("startup SDK versions", () => {
  it.each([
    ["@bitmovin/player-web-x", SDK_VERSIONS["web-x"]],
    ["hls.js", SDK_VERSIONS.hls],
    ["shaka-player", SDK_VERSIONS.shaka],
  ])("pins and resolves %s to the recorded comparison version", (name, version) => {
    expect(manifest.dependencies[name]).toBe(version);
    const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as {
      version: string;
    };
    expect(installed.version).toBe(version);
  });
});
